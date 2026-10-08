// Ejecuta el AgyLoginService REAL (con la entrega del código por consola) de producción contra agy real, en un perfil temporal y SIN abrir el navegador, y
// cronometra cada paso: cuánto tarda en dar la URL y qué pasa al mandarle un código inventado (el login no puede
// completarse sin una cuenta de Google, pero se ve si agy contesta, muere o se queda callado).
// Uso: node spike/agy-login-service-e2e.mjs
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const esbuild = createRequire(createRequire(join(repo, 'package.json')).resolve('vite/package.json'))('esbuild');
const work = mkdtempSync(join(tmpdir(), 'mage-agylogin-e2e-'));
const bundle = join(work, 'login.mjs');
esbuild.buildSync({
  stdin: { contents: `export * from './src/main/accounts/agyLoginService.ts'; export * from './src/main/accounts/providerAccounts.ts'; export * from './src/main/accounts/agyConsoleInput.ts'; export { AGY_FILE_TOKEN_ENV } from './src/main/engine/agyProfile.ts';`, resolveDir: repo, loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', outfile: bundle, alias: { '@shared': join(repo, 'src', 'shared') }, external: ['node:*'], logLevel: 'error',
});
const m = await import(pathToFileURL(bundle).href);

const profile = mkdtempSync(join(tmpdir(), 'mage-agylogin-profile-'));
const t0 = Date.now();
const stamp = (label) => console.log(`[${String(Date.now() - t0).padStart(6)} ms] ${label}`);
const children = [];
const service = new m.AgyLoginService({
  spawnLogin: (dir) => {
    stamp('spawn de agy');
    const child = spawn('agy', ['--print', '/usage'], { cwd: dir, env: { ...process.env, USERPROFILE: dir, HOME: process.env.USERPROFILE, ...m.AGY_FILE_TOKEN_ENV }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.on('data', (c) => stamp(`stdout (${c.length} bytes): ${JSON.stringify(c.toString().replace(/https:\/\/accounts\.google\.com\S+/g, '<URL>').trim().slice(0, 140))}`));
    child.stderr.on('data', (c) => stamp(`stderr (${c.length} bytes): ${JSON.stringify(c.toString().trim().slice(0, 140))}`));
    child.on('exit', (code) => stamp(`agy terminó (código ${code})`));
    children.push(child);
    return child;
  },
  openUrl: async () => stamp('openUrl (no se abre nada en esta prueba)'),
  killTree: (child) => { stamp('killTree'); spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); },
  sendCode: (child, code) => m.sendToConsole({
    timeoutMs: 10_000,
    spawnHelper: (script, pid) => spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `& { ${script} } -TargetPid ${pid}`], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }),
  }, child.pid, code),
  exitWaitMs: 3000,
  tokenExists: (dir) => existsSync(join(dir, ...m.AGY_TOKEN_PARTS)),
  urlTimeoutMs: 30_000, authTimeoutMs: 60_000, pollMs: 250, settleMs: 3_000,
});

try {
  const started = await service.start(profile);
  stamp(`start() → ${started.status}${started.status === 'url' ? ' (URL recibida)' : `: ${started.reason}`}`);
  if (started.status === 'url') {
    await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
    stamp('submitCode con un código inventado…');
    const result = await service.submitCode('4/0AbCdEfGhIjKlMnOpQrStUv_inventado');
    stamp(`submitCode() → ${JSON.stringify(result)}`);
  }
} finally {
  await service.cancel();
  await new Promise((resolveWait) => setTimeout(resolveWait, 800));
  for (const child of children) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
