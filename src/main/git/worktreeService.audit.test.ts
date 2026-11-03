import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findRepoRootWith, type GitRunner } from './gitService';
import { GIT_REAL_TIMEOUT_MS } from '@testing/realProcess';
import { createWorktreeService, hasUserChanges, nodeWorktreeFs } from './worktreeService';

const temporaryDirs: string[] = [];
function temporaryDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'mage-a09-')));
  temporaryDirs.push(dir);
  return dir;
}
afterEach(() => {
  // Rutas absolutas creadas por este test; no se borra ningún worktree del usuario.
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('A09 — traer la base con copias de Mage', () => {
  it('A09_worktreeRecienCreado_lasCopiasDeMageNoImpidenTraerBase', async () => {
    const repo = temporaryDir();
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
    git(['-c', 'init.defaultBranch=main', 'init', '-q']);
    writeFileSync(join(repo, 'a.txt'), 'uno\n');
    git(['add', '.']);
    git(['-c', 'user.name=audit', '-c', 'user.email=audit@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
    writeFileSync(join(repo, 'CLAUDE.local.md'), 'instrucciones locales');
    let fetched = false;
    const run: GitRunner = async (bin, args, options) => {
      // Se corta antes de cualquier acceso a red: sólo interesa si supera la guarda de limpieza.
      if (args.includes('fetch')) { fetched = true; throw new Error('FETCH_INTERCEPTADO'); }
      return execFileSync(bin, [...args], { cwd: options.cwd, env: options.env, encoding: 'utf8', windowsHide: true });
    };
    const service = createWorktreeService({
      findBin: () => 'git', run, isTrusted: () => true,
      findRepoRoot: (cwd) => findRepoRootWith(cwd, existsSync), baseEnv: process.env,
      fs: nodeWorktreeFs, noHooksDir: join(repo, 'no-hooks'), platform: process.platform,
    });
    const created = await service.create(repo, 'account', 'main', 'audit');
    expect(created).not.toBeNull();
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: created!.path, encoding: 'utf8', windowsHide: true });
    expect(hasUserChanges(status)).toBe(false);
    try { await service.mergeBase(created!.path, 'account', 'main'); } catch { /* Se comprueba el punto al que llegó. */ }
    expect(fetched).toBe(true);
  }, GIT_REAL_TIMEOUT_MS);
});


it('A09_fetchLocalYMergeReal_conservanCopiasEIncorporanBase', async () => {
  const repo = temporaryDir();
  const git = (args: string[], cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  const identity = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false'];
  git(['-c', 'init.defaultBranch=main', 'init', '-q']);
  writeFileSync(join(repo, 'a.txt'), 'uno\n');
  git(['add', '.']); git([...identity, 'commit', '-qm', 'primero']);
  git(['remote', 'add', 'origin', repo]); // Remoto local: nunca se accede a red.
  writeFileSync(join(repo, 'CLAUDE.local.md'), 'instrucciones locales');
  writeFileSync(join(repo, '.mcp.json'), '{}');
  mkdirSync(join(repo, '.claude'));
  writeFileSync(join(repo, '.claude', 'settings.local.json'), '{}');
  const service = createWorktreeService({ findBin: () => 'git', run: async (bin, args, options) =>
    execFileSync(bin, [...args], { cwd: options.cwd, env: options.env, encoding: 'utf8', windowsHide: true }),
    isTrusted: () => true, findRepoRoot: cwd => findRepoRootWith(cwd, existsSync), baseEnv: process.env,
    fs: nodeWorktreeFs, noHooksDir: join(repo, 'sin-hooks'), platform: process.platform });
  const created = await service.create(repo, 'cuenta', 'main', 'actualiza base');
  expect(created).not.toBeNull();
  writeFileSync(join(repo, 'a.txt'), 'dos\n');
  git(['add', 'a.txt']); git([...identity, 'commit', '-qm', 'base avanza']);
  expect(await service.mergeBase(created!.path, 'cuenta', 'main')).toBe('merged');
  expect(readFileSync(join(created!.path, 'a.txt'), 'utf8').trimEnd()).toBe('dos');
  expect(readFileSync(join(created!.path, 'CLAUDE.local.md'), 'utf8')).toBe('instrucciones locales');
  expect(readFileSync(join(created!.path, '.mcp.json'), 'utf8')).toBe('{}');
  expect(readFileSync(join(created!.path, '.claude', 'settings.local.json'), 'utf8')).toBe('{}');
}, GIT_REAL_TIMEOUT_MS);

it.each([' M a.txt\n', '?? nuevo.ts\n', ' M CLAUDE.md\n'])('A09_cambiosReales_%j_bloqueanAntesDeFetch', async status => {
  let fetched = false;
  const service = createWorktreeService({ findBin: () => 'git', run: async (_bin, args) => {
    if (args.includes('fetch')) fetched = true;
    return status;
  }, isTrusted: () => true, findRepoRoot: cwd => cwd, baseEnv: {}, fs: nodeWorktreeFs,
  noHooksDir: '/fixture/sin-hooks', platform: process.platform });
  await expect(service.mergeBase('/fixture', 'cuenta', 'main')).rejects.toThrow('cambios sin confirmar');
  expect(fetched).toBe(false);
});
