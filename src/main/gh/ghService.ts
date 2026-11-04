import type { GhOffReason, GhRunsSnapshot, GhSnapshot } from '@shared/gh';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import type { GitService } from '../git/gitService';
import {
  parsePrKey,
  prKeyToString,
  type PrDetail,
  type PrKey,
  type PrListParams,
  type PrListResult,
  type PrListState,
  type PrSnapshot,
  type PrWriteParams,
  type PrWriteResult,
  type RepoMergeOptions,
} from '@shared/pr';
import {
  classifyGhExit,
  parseHeadOnly,
  parseMergeOptions,
  parsePrDetail,
  parsePrList,
  parsePrView,
  parseRunList,
  pickBranchPr,
  PR_DETAIL_FIELDS,
  PR_FIELDS,
  PR_LIST_FIELDS,
  RUN_FIELDS,
} from './ghParse';
import { assertBody, buildPrWriteArgs } from './prWriteArgs';

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

// `tolerateOverflow`: si la salida pasa del buffer del runner, devuelve lo leido con salida 0 en vez de
// fallar (solo `pr diff`, que se corta igualmente a PR_DIFF_MAX_BYTES).
export type GhRunner = (
  bin: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv; readonly tolerateOverflow?: boolean },
) => Promise<GhRunResult>;

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
  // Panel de PR (F5.5): por `PrKey`, siempre con `-R host/owner/repo`.
  listPrs(params: PrListParams): Promise<PrListResult>;
  prDetail(cwd: string, accountDir: string, key: PrKey): Promise<PrDetail>;
  prDiff(cwd: string, accountDir: string, key: PrKey): Promise<{ readonly patch: string; readonly truncated: boolean }>;
  writePr(params: PrWriteParams): Promise<PrWriteResult>;
}

// Dos pestañas sobre la misma rama, o la barra y el sondeo a la vez: dentro de esta ventana se devuelve la
// misma promesa. El sondeo va a 60 s como poco, asi que nunca se come una lectura suya.
const PR_FRESH_MS = 10_000;
const RUN_LIST_LIMIT = '10';
const GITHUB_HOST = 'github.com';
const PR_LIST_MAX_LIMIT = 100;
const MERGE_OPTIONS_FRESH_MS = 5 * 60_000;
export const PR_DIFF_MAX_BYTES = 2 * 1024 * 1024;
const MERGE_OPTIONS_FIELDS = 'mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed';
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PR_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

// Una PR validada: su clave normalizada, la serializada y el `-R` de `gh`.
interface PrTarget {
  readonly key: PrKey;
  readonly keyStr: string;
  readonly repoRef: string;
}

type Gate = { readonly gh: string; readonly owner: string; readonly branch: string } | { readonly off: GhOffReason };

export function createGhService(deps: GhServiceDeps): GhService {
  return new CachedGhService(deps);
}

class CachedGhService implements GhService {
  // `prKey`: la PR que resolvio la lectura (para que una escritura invalide solo la suya).
  private readonly cache = new Map<string, { readonly at: number; readonly promise: Promise<GhSnapshot>; prKey: string | null }>();
  // Claves de PR que main ha LEIDO en esta ejecucion: escribir solo vale sobre una de ellas.
  private readonly knownKeys = new Set<string>();
  private readonly mergeOptionsCache = new Map<string, { readonly at: number; readonly options: RepoMergeOptions }>();
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
    const entry = { at: this.deps.now(), promise, prKey: null as string | null };
    this.cache.set(key, entry);
    const forget = (): void => void this.cache.delete(key);
    promise.then((snapshot) => {
      if (snapshot.kind === 'off') forget();
      else if (snapshot.kind === 'pr') entry.prKey = prKeyOfUrl(snapshot.pr.url);
    }, forget);
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
    if (!this.knownRuns.get(cwd)?.has(runId)) throw new UserFacingError(localized('errors.gh.runNotListed', { runId: String(runId), cwd }));
    const gated = await this.gate(cwd, accountDir);
    if ('off' in gated) throw new UserFacingError(localized('errors.gh.unavailable', { cwd, reason: gated.off }));
    const args = action === 'rerun' ? ['run', 'rerun', String(runId), '--failed'] : ['run', 'cancel', String(runId)];
    const result = await this.gh(gated.gh, cwd, args);
    if (result.code !== 0) throw new UserFacingError(localized('errors.gh.runActionFailed', { action, runId: String(runId), code: String(result.code) }));
  }

  // Auto-merge NATIVO de GitHub, en squash (DN-2): GitHub fusiona solo cuando pasan los checks obligatorios.
  async setAutoMerge(cwd: string, accountDir: string, number: number, enabled: boolean): Promise<void> {
    assertPositiveInt(number, 'numero de PR');
    if (!this.knownPrs.get(cwd)?.has(number)) throw new Error(`El PR #${number} no es uno leido en ${cwd}`);
    const gated = await this.gate(cwd, accountDir);
    if ('off' in gated) throw new UserFacingError(localized('errors.gh.unavailable', { cwd, reason: gated.off }));
    const args = ['pr', 'merge', String(number), ...(enabled ? ['--auto', '--squash'] : ['--disable-auto'])];
    const result = await this.gh(gated.gh, cwd, args);
    if (result.code !== 0) throw new UserFacingError(localized('errors.gh.autoMergeRejected', { number: String(number), code: String(result.code) }));
    this.cache.clear();
  }

  async listPrs(params: PrListParams): Promise<PrListResult> {
    const { cwd, accountDir, repo, state, limit } = params;
    if (!Number.isInteger(limit) || limit < 1 || limit > PR_LIST_MAX_LIMIT) throw new Error(`limite de PR no valido: ${String(limit)} (1..${PR_LIST_MAX_LIMIT})`);
    const target = targetOf({ ...repo, number: 1 }, false);
    const gated = await this.gate(cwd, accountDir);
    if ('off' in gated) return { kind: 'off', reason: gated.off };
    if (target.key.host !== GITHUB_HOST) return { kind: 'off', reason: 'not-github' };
    const args = ['pr', 'list', '-R', target.repoRef, '--state', ghStateOf(state), '--limit', String(limit), '--json', PR_LIST_FIELDS];
    const result = await this.gh(gated.gh, cwd, args);
    const off = offReason(result.code);
    if (off !== null) return { kind: 'off', reason: off };
    const merge = await this.mergeOptionsOf(gated.gh, cwd, target.repoRef);
    if ('code' in merge) return { kind: 'off', reason: offReason(merge.code) ?? 'error' };
    const prs = parsePrList(result.stdout, target.key).filter((pr) => matchesState(pr, state));
    for (const pr of prs) this.knownKeys.add(prKeyToString(pr.key));
    return { kind: 'list', prs, mergeOptions: merge.options };
  }

  async prDetail(cwd: string, accountDir: string, key: PrKey): Promise<PrDetail> {
    const target = targetOf(key);
    const gh = await this.requireGh(cwd, accountDir);
    const result = await this.gh(gh, cwd, ['pr', 'view', String(key.number), '-R', target.repoRef, '--json', PR_DETAIL_FIELDS]);
    if (result.code !== 0) throw prFailure(cwd, 'view', target.keyStr, result.code);
    const detail = parsePrDetail(result.stdout, target.key);
    this.knownKeys.add(target.keyStr);
    return detail;
  }

  async prDiff(cwd: string, accountDir: string, key: PrKey): Promise<{ readonly patch: string; readonly truncated: boolean }> {
    const target = targetOf(key);
    const gh = await this.requireGh(cwd, accountDir);
    const args = ['pr', 'diff', String(key.number), '-R', target.repoRef, '--patch'];
    const result = await this.deps.run(gh, args, { cwd, env: this.env, tolerateOverflow: true });
    if (result.code !== 0) throw prFailure(cwd, 'diff', target.keyStr, result.code);
    return capDiff(result.stdout);
  }

  // Toda escritura va atada al head que el usuario VIO: el merge lo exige a GitHub (`--match-head-commit`) y el
  // resto lo compara justo antes de actuar. Si cambio, `conflict` y no se escribe nada.
  async writePr(params: PrWriteParams): Promise<PrWriteResult> {
    const { cwd, accountDir, key, expectedHeadSha, action } = params;
    const target = targetOf(key);
    if (!SHA_PATTERN.test(expectedHeadSha)) throw new Error(`expectedHeadSha no valido: ${JSON.stringify(expectedHeadSha)}`);
    if (!this.knownKeys.has(target.keyStr)) throw new Error(`La PR ${target.keyStr} no es una leida en esta ejecucion`);
    assertBody(action);
    const gh = await this.requireGh(cwd, accountDir);
    const head = await this.gh(gh, cwd, ['pr', 'view', String(key.number), '-R', target.repoRef, '--json', 'headRefOid,state']);
    if (head.code !== 0) throw prFailure(cwd, 'head', target.keyStr, head.code);
    const currentHeadSha = parseHeadOnly(head.stdout).headSha;
    if (currentHeadSha !== expectedHeadSha) return { kind: 'conflict', currentHeadSha };
    if (action.kind === 'merge' || (action.kind === 'autoMerge' && action.enabled)) await this.assertStrategyAllowed(gh, cwd, target, action.strategy);
    const result = await this.gh(gh, cwd, buildPrWriteArgs(action, key.number, target.repoRef, expectedHeadSha));
    if (result.code !== 0) throw prFailure(cwd, action.kind, target.keyStr, result.code);
    this.forgetPr(target.keyStr);
    return { kind: 'ok' };
  }

  private async assertStrategyAllowed(gh: string, cwd: string, target: PrTarget, strategy: keyof RepoMergeOptions): Promise<void> {
    const merge = await this.mergeOptionsOf(gh, cwd, target.repoRef);
    if ('code' in merge) throw prFailure(cwd, 'repoView', target.keyStr, merge.code);
    if (!merge.options[strategy]) throw new UserFacingError(localized('errors.gh.strategyNotAllowed', { key: target.keyStr, strategy }));
  }

  // Opciones de fusion del repo, con cache de 5 min por repo. Un fallo no se cachea.
  private async mergeOptionsOf(gh: string, cwd: string, repoRef: string): Promise<{ readonly options: RepoMergeOptions } | { readonly code: number }> {
    const hit = this.mergeOptionsCache.get(repoRef);
    if (hit !== undefined && this.deps.now() - hit.at < MERGE_OPTIONS_FRESH_MS) return { options: hit.options };
    const result = await this.gh(gh, cwd, ['repo', 'view', repoRef, '--json', MERGE_OPTIONS_FIELDS]);
    if (result.code !== 0) return { code: result.code };
    const options = parseMergeOptions(result.stdout);
    this.mergeOptionsCache.set(repoRef, { at: this.deps.now(), options });
    return { options };
  }

  // Tras escribir, olvida las lecturas por rama de ESA PR (y las que aun no se sabe de cual son).
  private forgetPr(keyStr: string): void {
    for (const [cacheKey, entry] of this.cache) {
      if (entry.prKey === null || entry.prKey === keyStr) this.cache.delete(cacheKey);
    }
  }

  private async requireGh(cwd: string, accountDir: string): Promise<string> {
    const gated = await this.gate(cwd, accountDir);
    if ('off' in gated) throw new UserFacingError(localized('errors.gh.unavailable', { cwd, reason: gated.off }));
    return gated.gh;
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

// Valida la clave (formato) y la normaliza; con `requireGithub`, tambien que sea de github.com. `-R` siempre explicito.
function targetOf(key: PrKey, requireGithub = true): PrTarget {
  const keyStr = prKeyToString(key);
  const parsed = parsePrKey(keyStr);
  if (parsed === null || parsed.number !== key.number) throw new Error(`Clave de PR no valida: ${JSON.stringify(key)}`);
  if (requireGithub && parsed.host !== GITHUB_HOST) throw new Error(`Solo se gestionan PR de ${GITHUB_HOST}: ${keyStr}`);
  return { key: parsed, keyStr, repoRef: `${parsed.host}/${parsed.owner}/${parsed.repo}` };
}

function prKeyOfUrl(url: string): string | null {
  const match = PR_URL_PATTERN.exec(url);
  if (match === null) return null;
  const key = parsePrKey(`${GITHUB_HOST}/${match[1]}/${match[2]}#${match[3]}`);
  return key === null ? null : prKeyToString(key);
}

// `draft` pide `open` a gh y se separa aqui por `isDraft`; `open` incluye borradores, como GitHub.
function ghStateOf(state: PrListState): string {
  return state === 'draft' ? 'open' : state;
}

function matchesState(pr: PrSnapshot, state: PrListState): boolean {
  if (state === 'draft') return pr.isDraft;
  return true;
}

function prFailure(cwd: string, action: string, keyStr: string, code: number): UserFacingError {
  if (classifyGhExit(code) === 'no-auth') return new UserFacingError(localized('errors.gh.unavailable', { cwd, reason: 'no-auth' }));
  return new UserFacingError(localized('errors.gh.prActionFailed', { action, key: keyStr, code: String(code) }));
}

// Corta el parche a PR_DIFF_MAX_BYTES (en bytes UTF-8, no en caracteres).
function capDiff(stdout: string): { readonly patch: string; readonly truncated: boolean } {
  const bytes = Buffer.from(stdout, 'utf8');
  if (bytes.length <= PR_DIFF_MAX_BYTES) return { patch: stdout, truncated: false };
  return { patch: bytes.subarray(0, PR_DIFF_MAX_BYTES).toString('utf8'), truncated: true };
}

function assertPositiveInt(value: number, what: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${what} no valido: ${String(value)}`);
}
