import { dirname, join } from 'node:path';
import type { GitRepoState, GitSnapshot } from '@shared/git';
import { parseBranches, parseNumstat, parseStatusV2, switchTargetError } from './gitParse';

// Git de la carpeta de una conversacion (P-026 3.5, fase A): estado, ramas y cambio de rama. Todo
// inyectado (binario, runner, confianza, deteccion del repo) para poder testear sin procesos.
//
// Seguridad: argumentos SIEMPRE en array y sin shell (lo garantiza el runner). En las lecturas,
// `core.fsmonitor=false` (el fsmonitor de un repo es un comando que git ejecutaria) y sin textconv ni
// diff externo; en el entorno, `GIT_OPTIONAL_LOCKS=0` para no quitarle el `index.lock` al agente que
// trabaja en esa misma carpeta, y `GIT_TERMINAL_PROMPT=0` para que nada se quede esperando en un tty.

export type GitRunner = (bin: string, args: readonly string[], options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv }) => Promise<string>;

export interface GitServiceDeps {
  readonly findBin: () => string | null;
  readonly run: GitRunner;
  readonly isTrusted: (cwd: string, accountDir: string) => boolean;
  readonly findRepoRoot: (cwd: string) => string | null;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly now: () => number;
}

export interface GitService {
  status(cwd: string, accountDir: string): Promise<GitSnapshot>;
  branches(cwd: string, accountDir: string): Promise<readonly string[]>;
  switchBranch(cwd: string, accountDir: string, name: string): Promise<void>;
}

const READ_FLAGS = ['-c', 'core.fsmonitor=false'] as const;
const HEAD_SHORT_CHARS = 7;
// Dos pestañas en split sobre el mismo repo piden a la vez: dentro de esta ventana se devuelve la
// MISMA promesa (en vuelo o recien resuelta). El refresco va por eventos, asi que no hace falta mas.
const STATUS_FRESH_MS = 1_500;

type Gate = { readonly git: string } | Exclude<GitSnapshot, GitRepoState>;

export function createGitService(deps: GitServiceDeps): GitService {
  return new CachedGitService(deps);
}

class CachedGitService implements GitService {
  private readonly cache = new Map<string, { readonly at: number; readonly promise: Promise<GitSnapshot> }>();
  private readonly env: NodeJS.ProcessEnv;
  private bin: string | null | undefined;

  constructor(private readonly deps: GitServiceDeps) {
    this.env = { ...deps.baseEnv, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  }

  status(cwd: string, accountDir: string): Promise<GitSnapshot> {
    const hit = this.cache.get(cwd);
    if (hit !== undefined && this.deps.now() - hit.at < STATUS_FRESH_MS) return hit.promise;
    const promise = this.readStatus(cwd, accountDir);
    this.cache.set(cwd, { at: this.deps.now(), promise });
    // Solo se queda en cache un repo leido: un fallo se reintenta en el siguiente evento, y «sin
    // confianza» tiene que cambiar EN CUANTO el usuario la concede (no ejecuta nada, no cuesta).
    const forget = (): void => void this.cache.delete(cwd);
    promise.then((snapshot) => (snapshot.kind === 'repo' ? undefined : forget()), forget);
    return promise;
  }

  async branches(cwd: string, accountDir: string): Promise<readonly string[]> {
    const gated = this.gate(cwd, accountDir);
    return 'git' in gated ? this.listBranches(gated.git, cwd) : [];
  }

  async switchBranch(cwd: string, accountDir: string, name: string): Promise<void> {
    const gated = this.gate(cwd, accountDir);
    if (!('git' in gated)) throw new Error(`Git no disponible en ${cwd}: ${gated.kind}`);
    // Se revalida TODO aqui: el renderer ya lo comprobo, pero main no se fia (D26 y el nombre).
    const rejected = switchTargetError(name, await this.listBranches(gated.git, cwd));
    if (rejected !== null) throw new Error(`No se cambia de rama: ${rejected}`);
    const current = await this.readStatus(cwd, accountDir);
    if (current.kind === 'repo' && current.dirty) throw new Error(`No se cambia de rama con cambios sin confirmar en ${cwd}`);
    this.cache.delete(cwd);
    await this.deps.run(gated.git, ['switch', name], { cwd, env: this.env });
    this.cache.delete(cwd);
  }

  // Precondiciones comunes: hay git, hay repo y la carpeta es de confianza. Si falta algo, el motivo.
  private gate(cwd: string, accountDir: string): Gate {
    if (this.bin === undefined) this.bin = this.deps.findBin();
    if (this.bin === null) return { kind: 'unavailable' };
    const repoRoot = this.deps.findRepoRoot(cwd);
    if (repoRoot === null) return { kind: 'no-repo' };
    if (!this.deps.isTrusted(cwd, accountDir)) return { kind: 'untrusted', repoRoot };
    return { git: this.bin };
  }

  private read(git: string, cwd: string, args: readonly string[]): Promise<string> {
    return this.deps.run(git, [...READ_FLAGS, ...args], { cwd, env: this.env });
  }

  private async listBranches(git: string, cwd: string): Promise<readonly string[]> {
    return parseBranches(await this.read(git, cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']));
  }

  private async readStatus(cwd: string, accountDir: string): Promise<GitSnapshot> {
    const gated = this.gate(cwd, accountDir);
    if (!('git' in gated)) return gated;
    const status = parseStatusV2(await this.read(gated.git, cwd, ['status', '--porcelain=v2', '--branch', '-z']));
    // Sin commits no hay HEAD contra la que comparar: solo cuentan los ficheros.
    const diff = status.oid === null ? null : parseNumstat(await this.read(gated.git, cwd, ['diff', '--numstat', '-z', '--no-textconv', '--no-ext-diff', 'HEAD']));
    return {
      kind: 'repo',
      branch: status.branch,
      detached: status.detached,
      headShort: status.oid === null ? null : status.oid.slice(0, HEAD_SHORT_CHARS),
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      dirty: status.changed + status.untracked > 0,
      added: diff?.added ?? 0,
      removed: diff?.removed ?? 0,
      changedFiles: status.changed,
      untracked: status.untracked,
    };
  }
}

// Raiz del repo sin ejecutar nada: sube por los padres buscando `.git` (directorio, o fichero en un
// worktree o submodulo). Es lo que permite decir «hay repo, pero no es de confianza» sin lanzar git.
export function findRepoRootWith(cwd: string, exists: (path: string) => boolean): string | null {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (exists(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}
