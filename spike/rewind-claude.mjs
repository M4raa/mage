// Spike de F4.4/F4.5/F4.6 (carril K, punto de control K10): rewind, Reintentar, Divergir y keep-alive de Claude con el código REAL de
// Mage (spike/rewind-claude-entry.ts, empaquetado aquí con esbuild) contra el CLI REAL de Claude y un servidor Anthropic FALSO.
//   node spike/rewind-claude.mjs --build-only       solo empaqueta la entrada (comprueba que compila; sin CLI)
//   node spike/rewind-claude.mjs [--out <fichero>]  lanza `claude` varias veces contra el servidor falso
// Mide (c1-c8): rewind de la conversación tras dos turnos con herramienta (regla de `last_seen`, sin `stale_target`), con ficheros, con
// Bash (que no se restaura), con el turno en marcha, Reintentar, Divergir con id elegido por Mage, reabrir tras un rewind (dato, no
// fallo) y un keep-alive de mentira (el reloj salta una hora); y, como dato, cuánto crece `<configDir>/file-history` (t1Disco).
// Diseñado con Claude Code 2.1.314. Turnos REALES: 0 (clave falsa, servidor local, config dir y carpetas temporales `mage-k-*`
// que se borran al terminar). Sin pasos previos del usuario. Sale con 0 si todo da lo esperado y con 1 si no; el JSON de salida
// va a --out (por defecto, en el directorio temporal) y solo lleva booleanos, recuentos y nombres de campo.
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
  const outfile = path.join(outDir, 'rewind-claude-bundle.cjs');
  await esbuild.build({
    entryPoints: [path.join(repo, 'spike/rewind-claude-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile,
    alias: { '@shared': path.join(repo, 'src/shared') }, plugins: [linguiCatalogPlugin(repo)], logLevel: 'error',
  });
  return outfile;
}

// Cada comprobación dice por qué falla: la lista de fallos es parte de la salida.
function failures(out) {
  const c = out.casos ?? {};
  const checks = [
    ['c1.sinError', c.c1Conversacion?.applyError === null], ['c1.sinStaleTarget', c.c1Conversacion?.staleTarget === false],
    ['c1.borrador', c.c1Conversacion?.draftMatches === true], ['c1.peticionTieneUno', c.c1Conversacion?.lastRequestHasUno === true],
    ['c1.peticionNoTieneDos', c.c1Conversacion?.lastRequestHasDos === false], ['c1.fichero', c.c1Conversacion?.aTxt === 'DOS'],
    ['c2.planConFicheros', c.c2Ficheros?.filesAvailable === true], ['c2.planListaATxt', c.c2Ficheros?.changedHasATxt === true],
    ['c2.sinError', c.c2Ficheros?.applyError === null], ['c2.fichero', c.c2Ficheros?.aTxt === 'UNO'],
    ['c3.planNoListaBTxt', c.c3Bash?.planListsBTxt === false], ['c3.sinError', c.c3Bash?.applyError === null], ['c3.bashIntacto', c.c3Bash?.bTxt === 'X'],
    ['c4.sinError', c.c4TurnoEnMarcha?.applyError === null], ['c4.dentroDelPlazo', c.c4TurnoEnMarcha?.withinBudget === true], ['c4.reposo', c.c4TurnoEnMarcha?.idleAfter === true],
    ['c5.sinError', c.c5Reintentar?.applyError === null], ['c5.terminaEnElSegundo', c.c5Reintentar?.lastRequestEndsWithSecond === true],
    ['c5.sinRespuestaVieja', c.c5Reintentar?.oldAnswerPresent === false],
    ['c6.sinError', c.c6Divergir?.divergeError === null], ['c6.tienePrimero', c.c6Divergir?.forkHasFirst === true],
    ['c6.tieneRespuestaDelPrimero', c.c6Divergir?.forkHasFirstAnswer === true], ['c6.sinSegundo', c.c6Divergir?.forkHasSecond === false],
    ['c6.idDeMage', c.c6Divergir?.forkIdIsMages === true], ['c6.originalIntacto', c.c6Divergir?.originalUnchanged === true],
    ['c7.sinError', c.c7ReabrirTrasRewind?.applyError === null], ['c7.corteGuardado', c.c7ReabrirTrasRewind?.pendingCutSaved === true],
    ['c7.ramaSinElSegundo', c.c7ReabrirTrasRewind?.branchHasSecond === false],
    ['c8.temporizador', c.c8KeepAliveFalso?.timerRegistered === true], ['c8.registrado', c.c8KeepAliveFalso?.keepAliveRecorded === true],
    ['c8.oyenteSinEventos', c.c8KeepAliveFalso?.eventsDuringKa === 0], ['c8.unaPeticionDeKa', c.c8KeepAliveFalso?.fakeReceivedKa === 1],
    ['c8.siguienteSinKa', c.c8KeepAliveFalso?.afterRequestHasKa === false], ['c8.contador', c.c8KeepAliveFalso?.totalsCount === 1],
  ];
  return checks.filter(([, passed]) => !passed).map(([name]) => name);
}

const expected = (out) => failures(out).length === 0;

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-k-rewind-claude-bundle-'));
try {
  const bundle = await build(outDir);
  if (args.includes('--build-only')) {
    console.log('bundle ok');
  } else {
    const spike = createRequire(import.meta.url)(bundle);
    console.log(`claude: ${spike.claudeBinary()}`);
    const out = await spike.run();
    const failed = failures(out);
    const ok = expected(out);
    // c7 es un dato para dirección: si el --resume NO sigue el corte, se marca como hallazgo (no cambia el código de salida).
    const finding = out.casos?.c7ReabrirTrasRewind?.resumeFollowsCut === false ? 'c7: reabrir con --resume tras un rewind sin mensaje nuevo NO respeta el corte' : null;
    const result = JSON.stringify({ ok, failed, finding, ...out }, null, 1);
    const target = option('out') ?? path.join(os.tmpdir(), 'mage-k-rewind-claude-out.json');
    fs.writeFileSync(target, result);
    console.log(result);
    console.log(`salida: ${target}`);
    process.exitCode = ok ? 0 : 1;
  }
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
