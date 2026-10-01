import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findRepoRootWith, type GitRunner } from './gitService';
import { createWorktreeService, hasUserChanges, nodeWorktreeFs, type WorktreeServiceDeps } from './worktreeService';

function deps(over: Partial<WorktreeServiceDeps> = {}): WorktreeServiceDeps {
  return {
    findBin: () => 'git',
    run: vi.fn<GitRunner>(async () => ''),
    isTrusted: () => true,
    findRepoRoot: (cwd) => cwd,
    baseEnv: {},
    fs: { ...nodeWorktreeFs, exists: () => false },
    noHooksDir: '/no-existe',
    platform: 'linux',
    ...over,
  };
}

describe('hasUserChanges', () => {
  it('hasUserChanges_soloLoQueCopioMage_false', () => {
    expect(hasUserChanges('?? CLAUDE.local.md\n?? .claude/\n')).toBe(false);
    expect(hasUserChanges('')).toBe(false);
  });

  it('hasUserChanges_cambioOFicheroNuevo_true', () => {
    expect(hasUserChanges(' M a.txt\n')).toBe(true);
    expect(hasUserChanges('?? nuevo.ts\n?? CLAUDE.md\n')).toBe(true);
    expect(hasUserChanges(' M CLAUDE.md\n')).toBe(true);
  });
});

describe('createWorktreeService (guardas)', () => {
  it('create_carpetaSinConfianza_lanzaSinEjecutar', async () => {
    const run = vi.fn<GitRunner>(async () => '');

    await expect(createWorktreeService(deps({ run, isTrusted: () => false })).create('/r', '/acc', 'main', 'hola')).rejects.toThrow('no autorizada');
    expect(run).not.toHaveBeenCalled();
  });

  it('create_subcarpetaDelRepo_nullSinEjecutar', async () => {
    const run = vi.fn<GitRunner>(async () => '');

    expect(await createWorktreeService(deps({ run, findRepoRoot: () => '/r' })).create('/r/src', '/acc', 'main', 'hola')).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('create_baseQueNoEsRama_lanza', async () => {
    const run = vi.fn<GitRunner>(async () => 'main\n');

    await expect(createWorktreeService(deps({ run })).create('/r', '/acc', '--upload-pack=x', 'hola')).rejects.toThrow('no válida');
  });

  it('create_desdeUnWorktree_lanza', async () => {
    await expect(createWorktreeService(deps()).create('/r/.claude/worktrees/a', '/acc', 'main', 'x')).rejects.toThrow('ya es un worktree');
  });

  it('remove_carpetaQueGitNoListaComoDeMage_lanzaSinBorrar', async () => {
    const removeTree = vi.fn();
    const run = vi.fn<GitRunner>(async () => 'worktree /r/.claude/worktrees/agent-1\nHEAD 1\nbranch refs/heads/worktree-agent-1\n');

    await expect(createWorktreeService(deps({ run, fs: { ...nodeWorktreeFs, removeTree } })).remove('/r/.claude/worktrees/agent-1', '/acc')).rejects.toThrow('no es un worktree de Mage');
    expect(removeTree).not.toHaveBeenCalled();
  });

  it('mergeBase_ramaRara_lanza', async () => {
    await expect(createWorktreeService(deps()).mergeBase('/r', '/acc', '-x')).rejects.toThrow('no valida');
  });
});

// De punta a punta con el git REAL en una carpeta temporal (se salta sin git): lo que mide el spike.
const HAS_GIT = spawnSync('git', ['--version'], { windowsHide: true }).status === 0;
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false'];
const realRun: GitRunner = async (bin, args, options) => execFileSync(bin, [...args], { cwd: options.cwd, env: options.env, encoding: 'utf8', windowsHide: true });

describe.skipIf(!HAS_GIT)('createWorktreeService (git real)', () => {
  let base = '';
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  function setup(): string {
    base = realpathSync.native(mkdtempSync(join(tmpdir(), 'mage-wt-test-')));
    const repo = join(base, 'repo');
    mkdirSync(repo);
    const git = (args: string[]): void => void execFileSync('git', args, { cwd: repo, windowsHide: true });
    git(['-c', 'init.defaultBranch=main', 'init', '-q']);
    writeFileSync(join(repo, 'a.txt'), 'uno\n');
    writeFileSync(join(repo, '.gitignore'), '.env\nnode_modules/\n');
    writeFileSync(join(repo, '.worktreeinclude'), '.env\n');
    git(['add', '.']);
    git([...ID, 'commit', '-qm', 'primero']);
    writeFileSync(join(repo, '.env'), 'SECRETO=1\n');
    writeFileSync(join(repo, 'CLAUDE.local.md'), '# local\n');
    mkdirSync(join(repo, '.claude'));
    writeFileSync(join(repo, '.claude', 'settings.local.json'), '{}');
    writeFileSync(join(repo, '.git', 'hooks', 'post-checkout'), `#!/bin/sh\necho x > "${join(base, 'hook').replace(/\\/g, '/')}"\n`, { mode: 0o755 });
    return repo;
  }

  function realDeps(): WorktreeServiceDeps {
    return { ...deps(), run: realRun, fs: nodeWorktreeFs, findRepoRoot: (cwd) => findRepoRootWith(cwd, existsSync), noHooksDir: join(base, 'sin-hooks'), platform: process.platform, baseEnv: process.env };
  }

  it('create_yRemoveLimpio_ramaClaudeSinHooksCopiaYBarre', async () => {
    const repo = setup();
    const service = createWorktreeService(realDeps());

    const created = await service.create(repo, '/acc', 'main', 'Arreglar el login de Google');

    expect(created?.branch).toBe('claude/arreglar-el-login-de');
    const path = created!.path;
    expect(readFileSync(join(path, 'a.txt'), 'utf8').trim()).toBe('uno');
    expect(readFileSync(join(path, '.env'), 'utf8')).toContain('SECRETO');
    expect(existsSync(join(path, 'CLAUDE.local.md'))).toBe(true);
    expect(existsSync(join(path, '.claude', 'settings.local.json'))).toBe(true);
    expect(existsSync(join(path, '.claude', 'worktrees'))).toBe(false);
    expect(existsSync(join(base, 'hook'))).toBe(false);
    expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain('/.claude/worktrees/');
    // Ignorado + junction a una carpeta de fuera: el barrido no sigue el enlace.
    const outside = join(base, 'fuera');
    mkdirSync(outside);
    writeFileSync(join(outside, 'no-borrar.txt'), 'x');
    mkdirSync(join(path, 'node_modules'));
    symlinkSync(outside, join(path, 'node_modules', 'enlace'), 'junction');

    expect(await service.remove(path, '/acc')).toEqual({ removed: true });
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(outside, 'no-borrar.txt'))).toBe(true);
    expect(execFileSync('git', ['branch', '--list', 'claude/*'], { cwd: repo, encoding: 'utf8' })).toContain('claude/arreglar-el-login-de');

    await service.restore(path, '/acc');
    expect(readFileSync(join(path, 'a.txt'), 'utf8').trim()).toBe('uno');
  });

  it('remove_conCambios_seQuedaEnDisco', async () => {
    const repo = setup();
    const service = createWorktreeService(realDeps());
    const created = await service.create(repo, '/acc', 'main', 'tarea');
    writeFileSync(join(created!.path, 'a.txt'), 'cambiado\n');

    expect(await service.remove(created!.path, '/acc')).toEqual({ removed: false, reason: 'dirty' });
    expect(existsSync(created!.path)).toBe(true);
  });

  it('create_nombreOcupado_leAñadeSufijo', async () => {
    const repo = setup();
    const service = createWorktreeService(realDeps());

    await service.create(repo, '/acc', 'main', 'tarea');
    const second = await service.create(repo, '/acc', 'main', 'tarea');

    expect(second?.branch).toBe('claude/tarea-2');
  });
});
