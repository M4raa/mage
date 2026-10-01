import type { GhOffReason, GhRunsSnapshot, GhSnapshot } from '@shared/gh';
import type { GitService } from '../git/gitService';
import { classifyGhExit, parsePrView, parseRunList, pickBranchPr, PR_FIELDS, RUN_FIELDS } from './ghParse';

// PR, checks y runs de la rama de una conversacion con el GitHub CLI. Todo inyectado (binario, runner,
// git) para testear sin procesos.
//
// Invariantes: argumentos en array y sin shell (lo garantiza el runner); `gh` solo corre donde git ya
// puede correr (repo, git y confianza: `gh` ejecuta git por dentro, mismo riesgo de hooks, D28) y solo con
// un remoto de github.com (el host lo decide Mage, no el stderr de `gh`); NUNCA `gh auth token` ni
// `--show-token`; stderr no se lee ni se registra. «Sin sesion» y los fallos no se cachean: al iniciar
// sesion o volver la red se ve en el siguiente evento.

export interface GhRunResult {
  readonly code: number; // salida del proceso; -1 si no llego a salir (timeout, ENOENT)
  readonly stdout: string;
}

export type GhRunner = (bin: string, args: readonly string[], options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv }) => Promise<GhRunResult>;

export interface GhServiceDeps {
  readonly findBin: () => string | null;
  readonly run: GhRunner;
  readonly git: Pick<GitService, 'status' | 'remote'>;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly now: () => number;
}

export interface GhService {
  branchPr(cwd: string, accountDir: string): Promise<GhSnapshot>;
  prByNumber(cwd: string, accountDir: string, number: number): Promise<GhSnapshot>;
  runs(cwd: string, accountDir: string, branch: string): Promise<GhRunsSnapshot>;
  runAction(cwd: string, accountDir: string, runId: number, action: 'rerun' | 'cancel'): Promise<void>;
  setAutoMerge(cwd: string, accountDir: string, number: number, enabled: boolean): Promise<void>;
}

// Dos pestañas sobre la misma rama, o la barra y el sondeo a la vez: dentro de esta ventana se devuelve la
// misma promesa. El sondeo va a 60 s como poco, asi que nunca se come una lectura suya.
const PR_FRESH_MS = 10_000;
const RUN_LIST_LIMIT = '10';
const GITHUB_HOST = 'github.com';

type Gate = { readonly gh: string; readonly owner: string; readonly branch: string } | { readonly off: GhOffReason };

export function createGhService(deps: GhServiceDeps): GhService {
  return new CachedGhService(deps);
}

class CachedGhService implements GhService {
  private readonly cache = new Map<string, { readonly at: number; readonly promise: Promise<GhSnapshot> }>();
  // Ids que main acaba de leer por carpeta: relanzar o cancelar solo vale con uno de ellos.
  private readonly knownRuns = new Map<string, ReadonlySet<number>>();
  private readonly knownPrs = new Map<string, Set<number>>();
  private readonly env: NodeJS.ProcessEnv;
  private bin: string | null = null;

  constructor(private readonly deps: GhServiceDeps) {
    this.env = { ...deps.baseEnv, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  }

  async branchPr(cwd: string, accountDir: string): Promise<GhSnapshot> {
    const gated = await this.gate(cwd, accountDir);
    if ('off' in gated) return { kind: 'off', reason: gated.off };
    const key = `${cwd}\u0000${gated.branch}`;
    const hit = this.cache.get(key);
    if (hit !== undefined && this.deps.now() - hit.at < PR_FRESH_MS) return hit.promise;
    const promise = this.readBranchPr(cwd, gated);
    this.cache.set(key, { at: this.deps.now(), promise });
    const forget = (): void => void this.cache.delete(key);
    promise.then((snapshot) => (snapshot.kind === 'off' ? forget() : undefined), forget);
    return promise;
  }

  async prByNumber(cwd: string, accountDir: string, number: number): Promise<GhSnapshot> {
    assertPositiveInt(number, 'numero de PR');
    const gated = await this.gate(cwd, accountDir);
    if ('off' in gated) return { kind: 'off', reason: gated.off };
    const result = await this.gh(gated.gh, cwd, ['pr', 'view', String(number), '--json', PR_FIELDS]);
    const off = offReason(result.code);
    if (off !== null) return { kind: 'off', reason: off };
    return { kind: 'pr', pr: this.remember(cwd, parsePrView(result.stdout)) };
  }

  async runs(cwd: string, accountDir: string, branch: string): Promise<GhRunsSnapshot> {
    if (branch.length === 0 || branch.startsWith('-')) throw new Error(`Rama no valida para gh run list: "${branch}"`);
    const gated = await this.gate(cwd, accountDir);
    if ('off' in gated) return { kind: 'off', reason: gated.off };
    const result = await this.gh(gated.gh, cwd, ['run', 'list', `--branch=${branch}`, '--limit', RUN_LIST_LIMIT, '--json', RUN_FIELDS]);
    const off = offReason(result.code);
    if (off !== null) return { kind: 'off', reason: off };
    const runs = parseRunList(result.stdout);
    this.knownRuns.set(cwd, new Set(runs.map((run) => run.id)));
    return { kind: 'runs', runs };
  }

  async runAction(cwd: string, accountDir: string, runId: number, action: 'rerun' | 'cancel'): Promise<void> {
    assertPositiveInt(runId, 'id de run');
    if (!this.knownRuns.get(cwd)?.has(runId)) throw new Error(`El run ${runId} no esta en la ultima lista leida de ${cwd}`);
    const gated = await this.gate(cwd, accountDir);
    if ('off' in gated) throw new Error(`gh no disponible en ${cwd}: ${gated.off}`);
    const args = action === 'rerun' ? ['run', 'rerun', String(runId), '--failed'] : ['run', 'cancel', String(runId)];
    const result = await this.gh(gated.gh, cwd, args);
    if (result.code !== 0) throw new Error(`gh run ${action} ${runId} fallo (salida ${result.code})`);
  }

  // Auto-merge NATIVO de GitHub, en squash (DN-2): GitHub fusiona solo cuando pasan los checks obligatorios.
  async setAutoMerge(cwd: string, accountDir: string, number: number, enabled: boolean): Promise<void> {
    assertPositiveInt(number, 'numero de PR');
    if (!this.knownPrs.get(cwd)?.has(number)) throw new Error(`El PR #${number} no es uno leido en ${cwd}`);
    const gated = await this.gate(cwd, accountDir);
    if ('off' in gated) throw new Error(`gh no disponible en ${cwd}: ${gated.off}`);
    const args = ['pr', 'merge', String(number), ...(enabled ? ['--auto', '--squash'] : ['--disable-auto'])];
    const result = await this.gh(gated.gh, cwd, args);
    if (result.code !== 0) throw new Error(`GitHub no acepto el auto-merge del PR #${number} (salida ${result.code}): el repositorio tiene que permitirlo en sus ajustes («Allow auto-merge»)`);
    this.cache.clear();
  }

  private async readBranchPr(cwd: string, gated: Exclude<Gate, { off: GhOffReason }>): Promise<GhSnapshot> {
    // `pr list --head` sale con 0 y `[]` sin PR (medido); `pr view` sin numero saldria con 1, como un fallo.
    const result = await this.gh(gated.gh, cwd, ['pr', 'list', `--head=${gated.branch}`, '--state', 'all', '--limit', RUN_LIST_LIMIT, '--json', PR_FIELDS]);
    const off = offReason(result.code);
    if (off !== null) return { kind: 'off', reason: off };
    const pr = pickBranchPr(result.stdout, gated.owner);
    return pr === null ? { kind: 'no-pr', branch: gated.branch } : { kind: 'pr', pr: this.remember(cwd, pr) };
  }

  private remember<T extends { readonly number: number }>(cwd: string, pr: T): T {
    const known = this.knownPrs.get(cwd) ?? new Set<number>();
    known.add(pr.number);
    this.knownPrs.set(cwd, known);
    return pr;
  }

  // Primero el repo y el remoto (git, sin gh): «instala gh» solo tiene sentido en un repo de GitHub.
  private async gate(cwd: string, accountDir: string): Promise<Gate> {
    const status = await this.deps.git.status(cwd, accountDir);
    if (status.kind !== 'repo' || status.branch === null) return { off: 'no-repo' };
    const remote = await this.deps.git.remote(cwd, accountDir);
    if (remote === null || remote.host !== GITHUB_HOST) return { off: 'not-github' };
    // Sin gh se vuelve a buscar en cada lectura (no se cachea el «no esta»): quien lo instala con Mage
    // abierta lo ve en el siguiente evento, sin reiniciar.
    this.bin ??= this.deps.findBin();
    if (this.bin === null) return { off: 'no-gh' };
    return { gh: this.bin, owner: remote.owner, branch: status.branch };
  }

  private gh(bin: string, cwd: string, args: readonly string[]): Promise<GhRunResult> {
    return this.deps.run(bin, args, { cwd, env: this.env });
  }
}

function offReason(code: number): GhOffReason | null {
  const exit = classifyGhExit(code);
  if (exit === 'ok') return null;
  return exit === 'no-auth' ? 'no-auth' : 'error';
}

function assertPositiveInt(value: number, what: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${what} no valido: ${String(value)}`);
}
