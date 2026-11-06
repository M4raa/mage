// Spike de F4.6 (carril K, punto de control K10): keep-alive de la caché de Claude con el coordinador REAL de Mage (spike/keepalive-claude-entry.ts,
// empaquetado aquí con esbuild) y Claude REAL, sin servidor falso.
//   node spike/keepalive-claude.mjs --build-only                       solo empaqueta la entrada (comprueba que compila; sin CLI)
//   node spike/keepalive-claude.mjs [--long] [--big-chars <n>] [--out <fichero>]
// Serie corta (3 turnos): T1 con ~200 000 caracteres de líneas numeradas fabricadas, un keep-alive que vence YA (el spike adelanta una hora el reloj
// del coordinador, no el real) con su rewind, y T3. Espera: cacheTtlSeconds 3600 (suscripción), T3.cacheRead >= 0.85 x (T1.cacheRead +
// T1.cacheCreation), 0 `tool_use` en el keep-alive y el registro cuenta 1. `--long` añade 3 turnos y ~70 min de espera REAL (sin desplazar el reloj):
// el keep-alive lo dispara el temporizador de Mage a TTL - 60 s (~59 min) y a los 70 min un turno nuevo debe leer de la caché (>= 0.85 x contexto de T1').
// El contexto debe pasar el umbral del keep-alive (100 000 tokens, DEFAULT_KEEP_ALIVE): si el informe dice `timerRegistered: false`, repetir con
// `--big-chars 330000` (el tamaño de a1.mjs en la medición).
// Diseñado con Claude Code 2.1.314. Turnos REALES: 3 de haiku/low (6 con --long), con la cuenta de ~/.claude (suscripción); el config dir ES esa carpeta y
// no se copia ninguna credencial. Sin pasos previos del usuario salvo tener `claude` con sesión iniciada. Al terminar borra SOLO las carpetas de
// transcripciones de sus carpetas de trabajo `mage-k-ka-*` en ~/.claude/projects/ (y esas carpetas temporales). Sale con 0 si todo da lo esperado y con 1
// si no; el JSON de salida va a --out (por defecto, en el directorio temporal).
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
const DEFAULT_BIG_CHARS = 200_000;
const CACHE_HIT_RATIO = 0.85;
const EXPECTED_TTL_SECONDS = 3600;

async function build(outDir) {
  const require = createRequire(path.join(repo, 'package.json'));
  const esbuild = require(path.join(repo, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
  const outfile = path.join(outDir, 'keepalive-claude-bundle.cjs');
  await esbuild.build({
    entryPoints: [path.join(repo, 'spike/keepalive-claude-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile,
    alias: { '@shared': path.join(repo, 'src/shared') }, plugins: [linguiCatalogPlugin(repo)], logLevel: 'error',
  });
  return outfile;
}

function bigCharsArg() {
  const raw = option('big-chars');
  if (raw === undefined) return DEFAULT_BIG_CHARS;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1_000) throw new Error(`--big-chars debe ser un entero >= 1000: ${JSON.stringify(raw)}`);
  return value;
}

// Cada comprobación dice por qué falla: la lista de fallos es parte de la salida.
function failures(out) {
  const short = out.corta ?? {};
  const long = out.larga;
  const checks = [
    ['sinError', out.error === undefined],
    ['corta.temporizador', short.timerRegistered === true], ['corta.registrado', short.keepAliveRecorded === true],
    ['corta.ttl3600', short.cacheTtlSeconds === EXPECTED_TTL_SECONDS],
    ['corta.t3LeeDeLaCache', typeof short.t3CacheReadRatio === 'number' && short.t3CacheReadRatio >= CACHE_HIT_RATIO],
    ['corta.kaSinHerramientas', short.kaToolUses === 0], ['corta.registroCuentaUno', short.kaCount === 1],
  ];
  if (long !== undefined) {
    checks.push(['larga.registrado', long.keepAliveRecorded === true], ['larga.leeDeLaCache', typeof long.checkCacheReadRatio === 'number' && long.checkCacheReadRatio >= CACHE_HIT_RATIO]);
  }
  return checks.filter(([, passed]) => !passed).map(([name]) => name);
}

const expected = (out) => failures(out).length === 0;

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-k-keepalive-bundle-'));
try {
  const bundle = await build(outDir);
  if (args.includes('--build-only')) {
    console.log('bundle ok');
  } else {
    const spike = createRequire(import.meta.url)(bundle);
    console.log(`claude: ${spike.claudeBinary()}`);
    const out = await spike.run({ long: args.includes('--long'), bigChars: bigCharsArg() });
    const failed = failures(out);
    const ok = expected(out);
    const result = JSON.stringify({ ok, failed, ...out }, null, 1);
    const target = option('out') ?? path.join(os.tmpdir(), 'mage-k-keepalive-claude-out.json');
    fs.writeFileSync(target, result);
    console.log(result);
    console.log(`salida: ${target}`);
    process.exitCode = ok ? 0 : 1;
  }
} finally {
  fs.rmSync(outDir, { recursive: true, force: true });
}
