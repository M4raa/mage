// Mage — Spike del bloque 3 del grupo D: worktrees como Claude Desktop, medidos con el git real.
//
// Todo en un repo TEMPORAL (nunca en el de Mage): `node spike/worktree-spike.mjs [carpeta-base]`.
// Mide, en este orden:
//   1. `git worktree add --no-checkout -b <rama> <ruta> <base>` + checkout con los hooks y los filtros
//      del repo desactivados: ¿corre el `post-checkout`? ¿corre un filtro `smudge` del repo?
//   2. `.worktreeinclude`: que ficheros ignorados casan (interseccion de dos `ls-files -o -i`).
//   3. `git worktree list --porcelain` (la forma que parsea Mage).
//   4. Borrado: `git worktree remove` con un fichero ignorado y con un junction (Windows) / symlink a
//      una carpeta de FUERA del worktree: ¿sobrevive lo de fuera? ¿lo rechaza si hay cambios?
// No mide nada del CLI de Claude (gastaria un turno): donde deja la transcripcion con el cwd en un
// worktree se deduce de `cwdChange.ts`, sin medir.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = mkdtempSync(join(process.argv[2] ?? tmpdir(), 'wt-spike-'));
const repo = join(base, 'repo');
const outside = join(base, 'fuera');
const ID = ['-c', 'user.name=spike', '-c', 'user.email=spike@example.invalid', '-c', 'commit.gpgsign=false'];

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { status: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim().split('\n')[0] };
}

function must(cwd, args) {
  const r = git(cwd, args);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.err}`);
  return r.out;
}

function setupRepo() {
  mkdirSync(repo, { recursive: true });
  must(repo, ['-c', 'init.defaultBranch=main', 'init']);
  writeFileSync(join(repo, 'a.txt'), 'uno\n');
  writeFileSync(join(repo, '.gitignore'), '.env\nnode_modules/\n.claude/worktrees/\n');
  writeFileSync(join(repo, '.gitattributes'), '*.txt filter=espia\n');
  writeFileSync(join(repo, '.worktreeinclude'), '.env\n');
  must(repo, ['add', '.']);
  must(repo, [...ID, 'commit', '-m', 'primero']);
  writeFileSync(join(repo, '.env'), 'SECRETO=1\n');
  // Un hook y un filtro del repo que DEJAN RASTRO si se ejecutan.
  const hooks = join(repo, '.git', 'hooks');
  writeFileSync(join(hooks, 'post-checkout'), `#!/bin/sh\necho hook > "${join(base, 'hook-corrio').replaceAll('\\', '/')}"\n`, { mode: 0o755 });
  must(repo, ['config', 'filter.espia.smudge', `sh -c 'echo filtro > "${join(base, 'filtro-corrio').replaceAll('\\', '/')}"; cat'`]);
}

// Lo que Mage le pasaria a git al crear el worktree: sin hooks, sin fsmonitor y cada filtro del repo
// anulado (`smudge`/`process` vacios, `required=false`).
function safeFlags() {
  const filters = git(repo, ['config', '--get-regexp', '^filter\\..*\\.(smudge|clean|process)$']).out.split('\n').filter(Boolean);
  const names = [...new Set(filters.map((line) => line.split(' ')[0].split('.').slice(1, -1).join('.')))];
  const nullHooks = join(base, 'sin-hooks');
  mkdirSync(nullHooks, { recursive: true });
  return ['-c', 'core.longpaths=true', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${nullHooks}`, ...names.flatMap((n) => ['-c', `filter.${n}.smudge=`, '-c', `filter.${n}.clean=`, '-c', `filter.${n}.process=`, '-c', `filter.${n}.required=false`])];
}

function measureCreate() {
  const wt = join(repo, '.claude', 'worktrees', 'arreglar-login');
  const flags = safeFlags();
  console.log('flags:', JSON.stringify(flags.filter((f) => f !== '-c')));
  console.log('add --no-checkout:', JSON.stringify(git(repo, [...flags, 'worktree', 'add', '--no-checkout', '-b', 'claude/arreglar-login', wt, 'main'])));
  console.log('checkout:', JSON.stringify(git(wt, [...flags, 'checkout', 'claude/arreglar-login', '--', '.'])));
  console.log('a.txt en el worktree:', existsSync(join(wt, 'a.txt')), JSON.stringify(existsSync(join(wt, 'a.txt')) ? readFileSync(join(wt, 'a.txt'), 'utf8') : null));
  console.log('status del worktree limpio:', JSON.stringify(git(wt, ['status', '--porcelain']).out));
  console.log('hook corrio:', existsSync(join(base, 'hook-corrio')), '· filtro corrio:', existsSync(join(base, 'filtro-corrio')));
  // Control: el mismo checkout SIN las banderas, en otro worktree, para ver que el hook y el filtro SI corren.
  const control = join(base, 'control');
  git(repo, ['worktree', 'add', '-b', 'control', control, 'main']);
  console.log('control (sin banderas) -> hook:', existsSync(join(base, 'hook-corrio')), '· filtro:', existsSync(join(base, 'filtro-corrio')));
  git(repo, ['worktree', 'remove', '--force', control]);
  return wt;
}

function measureInclude() {
  const byInclude = must(repo, ['ls-files', '-z', '--others', '--ignored', '--exclude-from=.worktreeinclude']).split('\0').filter(Boolean);
  const ignored = must(repo, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard']).split('\0').filter(Boolean);
  console.log('.worktreeinclude casa:', JSON.stringify(byInclude), '· ignorados:', JSON.stringify(ignored));
}

function measureRemove(wt) {
  console.log('worktree list --porcelain:', JSON.stringify(must(repo, ['worktree', 'list', '--porcelain'])));
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, 'no-borrar.txt'), 'de fuera\n');
  mkdirSync(join(wt, 'node_modules'), { recursive: true });
  symlinkSync(outside, join(wt, 'node_modules', 'enlace'), 'junction');
  writeFileSync(join(wt, '.env'), 'copiado\n');
  writeFileSync(join(wt, 'a.txt'), 'cambiado\n');
  console.log('remove con cambios:', JSON.stringify(git(repo, ['worktree', 'remove', wt])));
  must(wt, ['checkout', '--', 'a.txt']);
  console.log('status solo con ignorados:', JSON.stringify(git(wt, ['status', '--porcelain']).out));
  console.log('remove limpio (con ignorados y junction):', JSON.stringify(git(repo, ['worktree', 'remove', wt])));
  console.log('carpeta del worktree tras remove:', existsSync(wt), '· lo de fuera sobrevive:', existsSync(join(outside, 'no-borrar.txt')));
  console.log('la rama se queda:', JSON.stringify(git(repo, ['branch', '--list', 'claude/*']).out));
  // `git worktree remove` deja la carpeta si quedan ignorados (medido): el barrido es de Mage. `rmSync`
  // recursivo de Node, ¿sigue el junction o lo desenlaza?
  if (existsSync(wt)) rmSync(wt, { recursive: true, force: true });
  console.log('tras rmSync -> worktree:', existsSync(wt), '· lo de fuera sobrevive:', existsSync(join(outside, 'no-borrar.txt')));
}

try {
  console.log('git:', must(base, ['--version']), '· plataforma:', process.platform, '· fecha:', new Date().toISOString());
  setupRepo();
  const wt = measureCreate();
  measureInclude();
  measureRemove(wt);
} finally {
  rmSync(base, { recursive: true, force: true });
}
