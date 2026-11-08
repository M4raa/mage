// Spike de F4.4/F4.5/U13 (carril K, punto de control K10): rewind, copia, divergir, borrar con copias y actualizar un hilo legacy de
// Codex con el código REAL de Mage (spike/rewind-codex-entry.ts, empaquetado aquí con esbuild) contra el CLI REAL de Codex.
//   node spike/rewind-codex.mjs --build-only                                  solo empaqueta la entrada (comprueba que compila; sin CLI)
//   node spike/rewind-codex.mjs --codex-home <dir> [--out <fichero>]          5 turnos de gpt-6-luna/low en ese CODEX_HOME
// Mide: r1 rewind con 3 turnos (el plan no tiene ficheros y ofrece copia; tras rebobinar el modelo contesta lo del 1º, el fichero sigue
// como estaba y el hilo vigente tiene 2 turnos), f1 divergir (el fork reanudado contesta lo del 1º; borrar el original con copias lanza
// `errors.rewind.hasCopies`; fork y original se borran después) y l1 legacy (`codex migrate-rollouts` con copia previa; qué ficheros había
// antes y después, que es lo NO MEDIDO). La medición de dos procesos sobre el mismo hilo (cp/B-04) sigue en codex-revert-reopen.mjs.
// Diseñado con codex-cli 0.164.0. Turnos REALES: 5 de gpt-6-luna/low (3 + 1 + 1). Paso del USUARIO antes: crear el CODEX_HOME desechable
// con sesión (`CODEX_HOME=<dir> codex login`); nunca ~/.codex (se rechaza). Las carpetas temporales `mage-k-*` se borran al terminar; los
// hilos de prueba, al final de cada caso. Sale con 0 si todo da lo esperado y con 1 si no; el JSON de salida va a --out (por defecto, en el
// directorio temporal).
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
  const outfile = path.join(outDir, 'rewind-codex-bundle.cjs');
  await esbuild.build({
    entryPoints: [path.join(repo, 'spike/rewind-codex-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile,
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

// Cada comprobación dice por qué falla: la lista de fallos es parte de la salida.
function failures(out) {
  const { r1Rewind: r1, f1Divergir: f1, l1Legacy: l1 } = out;
  const checks = [
    ['sinError', out.error === undefined],
    ['r1.planSinFicheros', r1?.planFilesNull === true], ['r1.planOfreceCopia', r1?.planCanSaveCopy === true], ['r1.sinError', r1?.applyError === null],
    ['r1.respondeUno', r1?.answerIsUno === true], ['r1.ficheroSigueEnDos', r1?.aTxt === 'DOS'], ['r1.dosTurnosVigentes', r1?.turnsAfter === 2],
    ['f1.hayFork', typeof f1?.forkThreadId === 'string'], ['f1.forkRespondeUno', f1?.forkAnswerIsUno === true],
    ['f1.borrarOriginalConCopias', f1?.deleteOriginalHasCopies === true], ['f1.borraFork', f1?.forkDeleted === true], ['f1.borraOriginal', f1?.originalDeleted === true],
    ['l1.eraLegacy', l1?.historyBefore === 'legacy'], ['l1.sinError', l1?.updateError === null],
    ['l1.copiaCompleta', Array.isArray(l1?.filesBefore) && l1.filesBefore.length > 0 && l1?.backupFiles === l1.filesBefore.length],
    ['l1.quedaPaginado', l1?.historyAfter === 'paginated'], ['l1.borraHilo', l1?.threadDeleted === true],
  ];
  return checks.filter(([, passed]) => !passed).map(([name]) => name);
}

const expected = (out) => failures(out).length === 0;

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-k-rewind-codex-bundle-'));
try {
  const bundle = await build(outDir);
  if (args.includes('--build-only')) {
    console.log('bundle ok');
  } else {
    const home = codexHomeArg();
    const spike = createRequire(import.meta.url)(bundle);
    console.log(`codex: ${spike.codexBinary()}`);
    const out = await spike.run(home);
    const failed = failures(out);
    const ok = expected(out);
    const result = JSON.stringify({ ok, failed, ...out }, null, 1);
    const target = option('out') ?? path.join(os.tmpdir(), 'mage-k-rewind-codex-out.json');
    fs.writeFileSync(target, result);
    console.log(result);
    console.log(`salida: ${target}`);
    process.exitCode = ok ? 0 : 1;
  }
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
