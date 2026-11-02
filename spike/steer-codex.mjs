// Spike de F4.1 (carril G): el directo de Codex con el código REAL de Mage (CodexAdapter) contra el CLI real: 5 turnos de gpt-6-luna/low en un CODEX_HOME DESECHABLE con sesión iniciada (nunca ~/.codex). Revisión y compactación se abren a mano (Mage no las abre) para volver a medir su rechazo.
//   node spike/steer-codex.mjs --build-only        solo empaqueta la entrada (comprueba que compila; sin CLI)
//   node spike/steer-codex.mjs --codex-home <dir>  5 turnos de gpt-6-luna/low en ese CODEX_HOME
// <dir> es un CODEX_HOME DESECHABLE con sesión iniciada (`CODEX_HOME=<dir> codex login`); nunca ~/.codex. El hilo de prueba
// se borra al final (`thread/delete`); la carpeta temporal, al terminar. Sale con 1 si algo no da lo esperado.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { linguiCatalogPlugin } from '../scripts/lib/linguiEsbuildPlugin.mjs';

const self = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(self), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

async function build(outDir) {
  const require = createRequire(path.join(repo, 'package.json'));
  const esbuild = require(path.join(repo, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
  const outfile = path.join(outDir, 'steer-codex-bundle.cjs');
  await esbuild.build({
    entryPoints: [path.join(repo, 'spike/steer-codex-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile,
    alias: { '@shared': path.join(repo, 'src/shared') }, plugins: [linguiCatalogPlugin(repo)], logLevel: 'error',
  });
  return outfile;
}

function codexHomeArg() {
  const home = option('codex-home');
  if (home === undefined) throw new Error('Falta --codex-home <dir>: un CODEX_HOME desechable con sesion iniciada');
  const resolved = path.resolve(home);
  if (resolved.toLowerCase() === path.join(os.homedir(), '.codex').toLowerCase()) throw new Error('--codex-home no puede ser el CODEX_HOME del usuario (~/.codex)');
  if (!fs.existsSync(path.join(resolved, 'auth.json'))) throw new Error(`${resolved} no tiene sesion iniciada: CODEX_HOME=<dir> codex login`);
  return resolved;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function expected(out) {
  const c = out.casos ?? {};
  return out.turnos === 5 && c.enTurno === 'active_turn' && ['active_turn', 'no_active_turn'].includes(c.esperandoTurno)
    && c.tardio?.recibo === 'resolved/no_active_turn' && c.permisoPendiente === 'active_turn'
    && same(c.revision, { code: -32600, turnKind: 'review' }) && same(c.compactacion, { code: -32600, turnKind: 'compact' });
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-g-steer-codex-bundle-'));
try {
  const bundle = await build(outDir);
  if (args.includes('--build-only')) {
    console.log('bundle ok');
  } else {
    const home = codexHomeArg();
    const spike = createRequire(import.meta.url)(bundle);
    console.log(`codex: ${spike.codexBinary()}`);
    const out = await spike.run(home);
    const ok = expected(out);
    console.log(JSON.stringify({ ok, ...out }, null, 1));
    process.exitCode = ok ? 0 : 1;
  }
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
