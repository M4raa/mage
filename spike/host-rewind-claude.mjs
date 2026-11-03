// Spike del punto de control cp/M-01 (carril M): el rewind por el HOST 1.4 (`session.rewindPoints`, `session.rewindPlan` y
// `session.rewind`) con el código REAL de Mage (spike/host-rewind-claude-entry.ts, empaquetado aquí con esbuild) contra el CLI REAL
// de Claude y un servidor Anthropic FALSO.
//   node spike/host-rewind-claude.mjs --build-only       solo empaqueta la entrada (comprueba que compila; sin CLI)
//   node spike/host-rewind-claude.mjs [--out <fichero>]  lanza `claude` contra el servidor falso
// Mide (h1-h5): los puntos del host (2, con `nativeId`), el plan desde el primero (2 mensajes), el rewind sin `projection` y con
// el siguiente turno sin lo descartado, `attachments` rechazado con -32602 y la notificación `conversation_rewound` al suscriptor.
// Turnos REALES: 0 (clave falsa, servidor local, config dir y carpetas temporales `mage-m-*` que se borran al terminar). Sale con 0
// si todo da lo esperado y con 1 si no; el JSON de salida va a --out (por defecto, en el directorio temporal) y solo lleva
// booleanos, recuentos y nombres de campo.
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
  const outfile = path.join(outDir, 'host-rewind-claude-bundle.cjs');
  await esbuild.build({
    entryPoints: [path.join(repo, 'spike/host-rewind-claude-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile,
    alias: { '@shared': path.join(repo, 'src/shared') }, plugins: [linguiCatalogPlugin(repo)], logLevel: 'error',
  });
  return outfile;
}

// Cada comprobación dice por qué falla: la lista de fallos es parte de la salida.
function failures(out) {
  const c = out.casos ?? {};
  const checks = [
    ['sinError', out.error === undefined],
    ['h1.sinError', c.h1?.replyError === null], ['h1.dosPuntos', c.h1?.pointCount === 2], ['h1.conNativeId', c.h1?.allWithNativeId === true],
    ['h1.nativeIdEsElCommandId', c.h1?.nativeIdsAreCommandIds === true], ['h1.rebobinables', c.h1?.allRewindable === true],
    ['h2.sinError', c.h2?.replyError === null], ['h2.disponible', c.h2?.unavailableNull === true], ['h2.descarta2', c.h2?.discardedMessages === 2],
    ['h3.sinError', c.h3?.replyError === null], ['h3.sinProjection', c.h3?.hasProjectionKey === false], ['h3.borrador', c.h3?.draftIsFirstMessage === true],
    ['h3.peticionSinUno', c.h3?.nextRequestHasUno === false], ['h3.peticionSinDos', c.h3?.nextRequestHasDos === false],
    ['h4.invalidParams', c.h4?.isInvalidParams === true],
    ['h5.suscrito', c.h5?.subscribed === true], ['h5.notificacion', c.h5?.rewoundNotifications === 1],
  ];
  return checks.filter(([, passed]) => !passed).map(([name]) => name);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-m-host-rewind-bundle-'));
try {
  const bundle = await build(outDir);
  if (args.includes('--build-only')) {
    console.log('bundle ok');
  } else {
    const spike = createRequire(import.meta.url)(bundle);
    console.log(`claude: ${spike.claudeBinary()}`);
    const out = await spike.run();
    const failed = failures(out);
    const ok = failed.length === 0;
    const result = JSON.stringify({ ok, failed, ...out }, null, 1);
    const target = option('out') ?? path.join(os.tmpdir(), 'mage-m-host-rewind-claude-out.json');
    fs.writeFileSync(target, result);
    console.log(result);
    console.log(`salida: ${target}`);
    process.exitCode = ok ? 0 : 1;
  }
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
