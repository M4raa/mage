import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { worktreeOfCwd, type WorktreeRef, type WorktreeRemoveResult } from '@shared/worktree';
import type { GitRunner } from './gitService';
import { parseBranches, parseWorktreeList, switchTargetError, worktreeSlug } from './gitParse';

// Worktrees de Mage (grupo D, bloque 3, como Claude Desktop). Medido con git 2.55 en
// `spike/worktree-spike.mjs`:
//  - `worktree add --no-checkout` + `checkout <rama> -- .` con `core.hooksPath` a una carpeta que no
//    existe y cada filtro del repo anulado: ni el `post-checkout` ni un `smudge` del repo se ejecutan (sin
//    esas banderas, si). Es la regla D28 aplicada a crear el worktree: el checkout no ejecuta nada del repo.
//  - `worktree remove` se niega con cambios o ficheros sin seguir (128) y, limpio, deja la carpeta si
//    quedan ignorados (node_modules); el barrido es de Mage, y el `rmSync` recursivo de Node DESENLAZA un
//    junction sin seguirlo (lo de fuera sobrevive).
//  - la rama se queda siempre.

export interface WorktreeFs {
  readonly exists: (path: string) => boolean;
  readonly isDirectory: (path: string) => boolean;
  readonly readText: (path: string) => string;
  readonly appendText: (path: string, text: string) => void;
  readonly list: (dir: string) => readonly string[];
  readonly copy: (from: string, to: string) => void; // recursivo, sobrescribe
  readonly removeTree: (path: string) => void;
}

export interface WorktreeServiceDeps {
  readonly findBin: () => string | null;
  readonly run: GitRunner;
  readonly isTrusted: (cwd: string, accountDir: string) => boolean;
  readonly findRepoRoot: (cwd: string) => string | null;
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly fs: WorktreeFs;
  // Carpeta que NO existe: `core.hooksPath` apunta ahi para que git no encuentre ningun hook.
  readonly noHooksDir: string;
  readonly platform: NodeJS.Platform;
}

export interface WorktreeService {
  // null si la carpeta no es la RAIZ de un repo: el worktree replica el repo entero, y una conversacion
  // abierta en una subcarpeta sigue trabajando donde esta.
  create(cwd: string, accountDir: string, base: string, firstMessage: string): Promise<{ readonly path: string; readonly branch: string } | null>;
  restore(cwd: string, accountDir: string): Promise<void>;
  remove(cwd: string, accountDir: string): Promise<WorktreeRemoveResult>;
  mergeBase(cwd: string, accountDir: string, base: string): Promise<'merged' | 'conflict'>;
}

const WORKTREES_DIR = ['.claude', 'worktrees'] as const;
const EXCLUDE_LINE = '/.claude/worktrees/';
// Lo que Desktop copia fresco del repo principal ademas de `.worktreeinclude`.
const COPIED_FILES = ['.mcp.json', 'CLAUDE.md', 'CLAUDE.local.md'] as const;
const WORKTREE_INCLUDE = '.worktreeinclude';
const MAX_NAME_ATTEMPTS = 50;
const READ_FLAGS = ['-c', 'core.fsmonitor=false'] as const;

// ¿Hay cambios del usuario o del agente? Lo que Mage COPIO al crear el worktree (sin seguir: `CLAUDE.md`,
// `.claude/`…) no cuenta: si contara, ningun worktree se borraria nunca. Lo de `.worktreeinclude` ya va
// ignorado y no sale en el estado.
// ponytail: una copia que el agente edito se pierde al archivar (Desktop las vuelve a copiar frescas igual).
export function hasUserChanges(porcelain: string): boolean {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .some((line) => !isCopiedUntracked(line));
}

function untrackedPaths(porcelain: string): readonly string[] {
  return porcelain
    .split(/\r?\n/)
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).replace(/^"|"$/g, ''));
}

function isCopiedUntracked(line: string): boolean {
  if (!line.startsWith('?? ')) return false;
  const path = line.slice(3).replace(/^"|"$/g, '');
  return (COPIED_FILES as readonly string[]).includes(path) || path === '.claude/' || path.startsWith('.claude/');
}

export function createWorktreeService(deps: WorktreeServiceDeps): WorktreeService {
  return new GitWorktreeService(deps);
}

class GitWorktreeService implements WorktreeService {
  private readonly env: NodeJS.ProcessEnv;

  constructor(private readonly deps: WorktreeServiceDeps) {
    this.env = { ...deps.baseEnv, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  }

  async create(cwd: string, accountDir: string, base: string, firstMessage: string): Promise<{ readonly path: string; readonly branch: string } | null> {
    if (worktreeOfCwd(cwd) !== null) throw new Error(`${cwd} ya es un worktree de Mage`);
    const root = this.deps.findRepoRoot(cwd);
    if (root === null || this.normalize(root) !== this.normalize(cwd)) return null;
    const git = this.gate(cwd, accountDir);
    const branches = parseBranches(await this.git(git, cwd, [...READ_FLAGS, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']));
    const rejected = switchTargetError(base, branches);
    if (rejected !== null) throw new Error(`No se crea el worktree: ${rejected}`);
    const name = this.freeName(cwd, worktreeSlug(firstMessage), new Set(branches));
    const path = join(cwd, ...WORKTREES_DIR, name);
    const branch = `claude/${name}`;
    const flags = await this.safeFlags(git, cwd);
    await this.git(git, cwd, [...flags, 'worktree', 'add', '--no-checkout', '-b', branch, path, base]);
    await this.git(git, path, [...flags, 'checkout', branch, '--', '.']);
    this.excludeWorktrees(cwd);
    await this.copyFromRepo(git, cwd, path);
    return { path, branch };
  }

  // Reabrir la conversacion de un worktree que se archivo limpio: se vuelve a sacar su rama. Idempotente.
  async restore(cwd: string, accountDir: string): Promise<void> {
    const ref = this.refOf(cwd);
    if (this.deps.fs.exists(cwd)) return;
    const git = this.gate(ref.repoRoot, accountDir);
    const branches = parseBranches(await this.git(git, ref.repoRoot, [...READ_FLAGS, 'for-each-ref', '--format=%(refname:short)', 'refs/heads']));
    if (!branches.includes(ref.branch)) throw new Error(`La rama ${ref.branch} ya no existe en ${ref.repoRoot}: no se puede recrear el worktree`);
    const flags = await this.safeFlags(git, ref.repoRoot);
    await this.git(git, ref.repoRoot, ['worktree', 'prune']);
    await this.git(git, ref.repoRoot, [...flags, 'worktree', 'add', '--no-checkout', cwd, ref.branch]);
    await this.git(git, cwd, [...flags, 'checkout', ref.branch, '--', '.']);
    await this.copyFromRepo(git, ref.repoRoot, cwd);
  }

  // Archivar: solo se borra limpio; con cambios (o si git no sabe decirlo) se queda en disco. La rama, siempre.
  async remove(cwd: string, accountDir: string): Promise<WorktreeRemoveResult> {
    const ref = this.refOf(cwd);
    const git = this.gate(ref.repoRoot, accountDir);
    await this.assertMageWorktree(git, ref, cwd);
    const status = await this.git(git, cwd, [...READ_FLAGS, 'status', '--porcelain']).catch((err: unknown) => {
      // Como Desktop: si git no sabe decir si esta limpio, el worktree se queda en disco.
      console.warn(`[worktree] no se pudo leer el estado de ${cwd}:`, err instanceof Error ? err.message : String(err));
      return null;
    });
    if (status === null) return { removed: false, reason: 'unknown' };
    if (hasUserChanges(status)) return { removed: false, reason: 'dirty' };
    // Las copias de Mage son ficheros sin seguir: `worktree remove` (sin --force) se negaria por ellas.
    for (const copied of untrackedPaths(status)) this.deps.fs.removeTree(join(cwd, copied));
    await this.git(git, ref.repoRoot, ['worktree', 'remove', cwd]);
    // Lo ignorado (node_modules, .env copiado) se queda tras `worktree remove`: se barre aqui, sin seguir
    // enlaces, y solo dentro de `.claude/worktrees/`.
    if (this.deps.fs.exists(cwd)) this.deps.fs.removeTree(cwd);
    return { removed: true };
  }

  // «Traer la base»: fetch de la rama base y MERGE (nunca rebase) en la rama de la conversacion. Se niega
  // con cambios sin confirmar; un conflicto se queda para que lo resuelva el agente.
  async mergeBase(cwd: string, accountDir: string, base: string): Promise<'merged' | 'conflict'> {
    if (!/^[\w.][\w./-]*$/.test(base)) throw new Error(`Rama base no valida: "${base}"`);
    const git = this.gate(cwd, accountDir);
    const dirty = await this.git(git, cwd, [...READ_FLAGS, 'status', '--porcelain']);
    if (dirty.trim().length > 0) throw new Error(`No se trae ${base} con cambios sin confirmar en ${cwd}`);
    await this.git(git, cwd, ['fetch', 'origin', base]);
    try {
      await this.git(git, cwd, ['merge', '--no-edit', 'FETCH_HEAD']);
      return 'merged';
    } catch (err) {
      const conflicted = await this.git(git, cwd, ['diff', '--name-only', '--diff-filter=U']);
      if (conflicted.trim().length > 0) return 'conflict';
      throw err;
    }
  }

  private gate(cwd: string, accountDir: string): string {
    const git = this.deps.findBin();
    if (git === null) throw new Error('No hay git para crear el worktree');
    if (!this.deps.isTrusted(cwd, accountDir)) throw new Error(`Carpeta no autorizada para git: ${cwd}`);
    return git;
  }

  private refOf(cwd: string): WorktreeRef {
    const ref = worktreeOfCwd(cwd);
    if (ref === null) throw new Error(`No es un worktree de Mage: ${cwd}`);
    return ref;
  }

  // Solo se toca un worktree que git conoce, en esa ruta y con la rama `claude/<nombre>`: nunca uno
  // creado por otro (los del CLI llevan `worktree-<nombre>`) ni una carpeta suelta.
  private async assertMageWorktree(git: string, ref: WorktreeRef, cwd: string): Promise<void> {
    const listed = parseWorktreeList(await this.git(git, ref.repoRoot, ['worktree', 'list', '--porcelain']));
    const wanted = this.normalize(cwd);
    if (!listed.some((entry) => this.normalize(entry.path) === wanted && entry.branch === ref.branch)) {
      throw new Error(`${cwd} no es un worktree de Mage registrado en ${ref.repoRoot}`);
    }
  }

  private normalize(path: string): string {
    const unified = resolve(path).replace(/\\/g, '/').replace(/\/+$/, '');
    return this.deps.platform === 'win32' ? unified.toLowerCase() : unified;
  }

  private freeName(repoRoot: string, slug: string, branches: ReadonlySet<string>): string {
    for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt += 1) {
      const name = attempt === 1 ? slug : `${slug}-${attempt}`;
      if (!branches.has(`claude/${name}`) && !this.deps.fs.exists(join(repoRoot, ...WORKTREES_DIR, name))) return name;
    }
    throw new Error(`No hay un nombre libre para el worktree «${slug}» tras ${MAX_NAME_ATTEMPTS} intentos`);
  }

  // Sin hooks, sin fsmonitor y con cada filtro del repo (y del usuario) anulado. `config --list` sale con
  // 0 aunque no haya filtros; `--get-regexp` saldria con 1.
  private async safeFlags(git: string, cwd: string): Promise<readonly string[]> {
    const names = (await this.git(git, cwd, [...READ_FLAGS, 'config', '--list', '--name-only'])).split(/\r?\n/);
    const filters = new Set(names.filter((n) => /^filter\..+\.(smudge|clean|process|required)$/i.test(n)).map((n) => n.slice('filter.'.length, n.lastIndexOf('.'))));
    const off = [...filters].flatMap((f) => ['-c', `filter.${f}.smudge=`, '-c', `filter.${f}.clean=`, '-c', `filter.${f}.process=`, '-c', `filter.${f}.required=false`]);
    return ['-c', 'core.longpaths=true', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${this.deps.noHooksDir}`, ...off];
  }

  // Que el repo principal no vea `.claude/worktrees/` como sin seguir (el agente podria meterlo en un
  // commit). Va a `.git/info/exclude`, que no se versiona; con `.git` de fichero (el repo ya es un
  // worktree) no se toca nada.
  private excludeWorktrees(repoRoot: string): void {
    const gitDir = join(repoRoot, '.git');
    if (!this.deps.fs.isDirectory(gitDir)) return;
    const exclude = join(gitDir, 'info', 'exclude');
    const current = this.deps.fs.exists(exclude) ? this.deps.fs.readText(exclude) : '';
    if (current.split(/\r?\n/).includes(EXCLUDE_LINE)) return;
    this.deps.fs.appendText(exclude, `${current.length === 0 || current.endsWith('\n') ? '' : '\n'}${EXCLUDE_LINE}\n`);
  }

  // Lo de `.worktreeinclude` (que ademas este ignorado, como en Desktop) y, fresco, `.claude/` (sin sus
  // worktrees), `.mcp.json`, `CLAUDE.md` y `CLAUDE.local.md`.
  private async copyFromRepo(git: string, repoRoot: string, worktree: string): Promise<void> {
    for (const file of await this.includedFiles(git, repoRoot)) this.deps.fs.copy(join(repoRoot, file), join(worktree, file));
    for (const file of COPIED_FILES) if (this.deps.fs.exists(join(repoRoot, file))) this.deps.fs.copy(join(repoRoot, file), join(worktree, file));
    // `.claude/` entrada a entrada: su `worktrees/` es donde vive el propio worktree (copiarlo seria infinito).
    const claudeDir = join(repoRoot, WORKTREES_DIR[0]);
    if (!this.deps.fs.isDirectory(claudeDir)) return;
    for (const entry of this.deps.fs.list(claudeDir)) {
      if (entry !== WORKTREES_DIR[1]) this.deps.fs.copy(join(claudeDir, entry), join(worktree, WORKTREES_DIR[0], entry));
    }
  }

  private async includedFiles(git: string, repoRoot: string): Promise<readonly string[]> {
    if (!this.deps.fs.exists(join(repoRoot, WORKTREE_INCLUDE))) return [];
    const list = async (exclude: string): Promise<readonly string[]> =>
      (await this.git(git, repoRoot, [...READ_FLAGS, 'ls-files', '-z', '--others', '--ignored', exclude])).split('\u0000').filter((f) => f.length > 0 && !f.endsWith('/'));
    const ignored = new Set(await list('--exclude-standard'));
    return (await list(`--exclude-from=${WORKTREE_INCLUDE}`)).filter((file) => ignored.has(file));
  }

  private git(git: string, cwd: string, args: readonly string[]): Promise<string> {
    return this.deps.run(git, args, { cwd, env: this.env });
  }
}

// El disco de verdad (lo inyecta main; los tests pasan el suyo o este mismo sobre una carpeta temporal).
export const nodeWorktreeFs: WorktreeFs = {
  exists: existsSync,
  isDirectory: (path) => existsSync(path) && statSync(path).isDirectory(),
  readText: (path) => readFileSync(path, 'utf8'),
  appendText: (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, text);
  },
  list: (dir) => readdirSync(dir),
  copy: (from, to) => {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true, force: true });
  },
  removeTree: (path) => rmSync(path, { recursive: true, force: true }),
};
