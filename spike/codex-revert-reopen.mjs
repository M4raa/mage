// Spike de F4.3: reabrir y migrar una conversación de Codex con revert, con el código REAL de Mage contra el CLI real
// (spike/codex-revert-reopen-entry.ts, empaquetado aquí con esbuild).
//   node spike/codex-revert-reopen.mjs --build-only        solo empaqueta la entrada (comprueba que compila; sin CLI)
//   node spike/codex-revert-reopen.mjs --codex-home <dir>  2 turnos de gpt-6-luna/low en ese CODEX_HOME
// <dir> es un CODEX_HOME DESECHABLE con sesión iniciada (`CODEX_HOME=<dir> codex login`); nunca ~/.codex. El hilo de prueba
// se borra al migrarlo (`thread/delete`); las carpetas temporales, al terminar. Sale con 1 si algo no da lo esperado.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(self), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

function build(outDir) {
  const require = createRequire(path.join(repo, 'package.json'));
  const esbuild = require(path.join(repo, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
  const outfile = path.join(outDir, 'codex-revert-reopen-bundle.cjs');
  esbuild.buildSync({
    entryPoints: [path.join(repo, 'spike/codex-revert-reopen-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile,
    alias: { '@shared': path.join(repo, 'src/shared') }, logLevel: 'error',
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

function expected(out) {
  const r = out.reopen ?? {};
  const n = out.withoutHistoryDb ?? {};
  const m = out.migrate ?? {};
  return out.modelTurns === 2 && r.entries === 1 && r.segments === true && r.sourceKind === 'codexTurns' && r.turns === 1 && r.hasKept && !r.hasDropped
    && out.liveStillAnswers === true && n.turns === 1 && n.hasKept && !n.hasDropped
    && m.newId && m.written && m.hasKept && !m.hasDropped && m.sourceGone;
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-b-revert-bundle-'));
try {
  const bundle = build(outDir);
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
