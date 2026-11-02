// H1 de la devolución 17: sonda de contención del latido de los locks (#55) en Windows. Un proceso sustituye el lock
// en bucle (temporal + rename, como el latido) y otro lo lee en bucle (como `peek`/`describeOther` de la otra
// instancia), durante varias tandas. Tres modos de escritor:
//   - raw: `renameSync` sin reintento (el código de 62f0e71) → cuenta los EPERM/EBUSY;
//   - replace: `nodeLockFs.replace` de producción (con reintento) → errores que llegan al llamante y reintentos usados;
//   - heartbeat: `ConversationLocks.heartbeat` dentro de `runLockHeartbeatTick`, con varias conversaciones → errores
//     no controlados (excepciones que escapan del tick), fallos registrados y renovaciones.
// Carpeta desechable bajo el temporal del sistema; nunca la carpeta real de locks. Sin red ni turnos.
//
//   node spike/lock-contention.mjs [--seconds 4] [--rounds 2]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const self = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(self), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

function build(outDir) {
  const require = createRequire(path.join(repo, 'package.json'));
  const esbuild = require(path.join(repo, 'node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild'));
  const outfile = path.join(outDir, 'lock-contention-bundle.cjs');
  esbuild.buildSync({
    entryPoints: [path.join(repo, 'spike/lock-contention-entry.ts')], bundle: true, platform: 'node', format: 'cjs', outfile,
    alias: { '@shared': path.join(repo, 'src/shared') }, logLevel: 'error',
  });
  return outfile;
}

const REFS = ['a', 'b', 'c', 'd'].map((id) => ({ provider: 'claude', accountDir: '', nativeId: `sonda-${id}` }));

// --- papeles de los hijos ---------------------------------------------------------------------------------------
function reader(dir, until) {
  let reads = 0;
  let errors = 0;
  const files = () => fs.readdirSync(dir).filter((name) => name.endsWith('.lock')).map((name) => path.join(dir, name));
  while (Date.now() < until) {
    for (const file of files()) {
      try { fs.readFileSync(file, 'utf8'); reads += 1; } catch (err) { if (err.code !== 'ENOENT') errors += 1; }
    }
  }
  return { reads, errors };
}

function rawWriter(dir, until) {
  const target = path.join(dir, 'raw.lock');
  fs.writeFileSync(target, '{}');
  let attempts = 0;
  let failures = 0;
  const codes = {};
  for (let n = 0; Date.now() < until; n++) {
    const temp = `${target}.${n}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ n }));
    attempts += 1;
    try {
      fs.renameSync(temp, target);
    } catch (err) {
      failures += 1;
      codes[err.code] = (codes[err.code] ?? 0) + 1;
      fs.rmSync(temp, { force: true });
    }
  }
  return { attempts, failures, codes };
}

function countingSleep(bundle, counter) {
  return (ms) => { counter.retries += 1; bundle.sleepSync(ms); };
}

function replaceWriter(bundle, dir, until) {
  const target = path.join(dir, 'replace.lock');
  fs.writeFileSync(target, '{}');
  const counter = { retries: 0 };
  let suffix = 0;
  const lockFs = bundle.nodeLockFs(fs, () => String((suffix += 1)), countingSleep(bundle, counter));
  let attempts = 0;
  let failures = 0;
  for (let n = 0; Date.now() < until; n++) {
    attempts += 1;
    try { lockFs.replace(target, JSON.stringify({ n })); } catch { failures += 1; }
  }
  return { attempts, failures, retries: counter.retries };
}

function heartbeatWriter(bundle, dir, until) {
  const counter = { retries: 0 };
  let suffix = 0;
  const locks = new bundle.ConversationLocks({
    dir, identity: { instanceId: `sonda-${process.pid}`, profile: 'sonda', profileHash: 'sonda', pid: process.pid },
    fileNameOf: (ref) => bundle.lockFileName(ref, (p) => p), now: Date.now, isPidAlive: () => true,
    fs: bundle.nodeLockFs(fs, () => String((suffix += 1)), countingSleep(bundle, counter)),
  });
  for (const ref of REFS) locks.acquire(ref, 'tab:1:sonda');
  const tally = { ticks: 0, uncaught: 0, loggedFailures: 0, loggedErrors: 0 };
  const log = (level) => { if (level === 'warn') tally.loggedFailures += 1; else tally.loggedErrors += 1; };
  while (Date.now() < until) {
    tally.ticks += 1;
    try { bundle.runLockHeartbeatTick({ heartbeat: () => locks.heartbeat(), log, notifyLost: () => undefined }); } catch { tally.uncaught += 1; }
  }
  const stillOwned = REFS.filter((ref) => locks.peek(ref)?.owner === true).length;
  locks.releaseAll();
  return { ...tally, renewals: tally.ticks * REFS.length, retries: counter.retries, stillOwned, of: REFS.length };
}

function child(role, dir, until, bundlePath) {
  const bundle = createRequire(self)(bundlePath);
  const roles = {
    reader: () => reader(dir, until),
    raw: () => rawWriter(dir, until),
    replace: () => replaceWriter(bundle, dir, until),
    heartbeat: () => heartbeatWriter(bundle, dir, until),
  };
  process.stdout.write(`${JSON.stringify(roles[role]())}\n`);
}

// --- orquestador ------------------------------------------------------------------------------------------------
function runChild(role, dir, until, bundle) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [self, '--child', role, dir, String(until), bundle], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    proc.stdout.on('data', (chunk) => { out += chunk; });
    proc.on('error', reject);
    proc.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out.trim())) : reject(new Error(`${role} salió con ${code}`))));
  });
}

async function round(mode, bundle, seconds) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-lock-contention-'));
  try {
    // Margen para que el escritor cree sus ficheros antes de que el lector empiece a encontrarlos.
    const until = Date.now() + 300 + seconds * 1000;
    const [writer, readerResult] = await Promise.all([runChild(mode, dir, until, bundle), runChild('reader', dir, until, bundle)]);
    return { mode, seconds, writer, reader: readerResult };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  if (args[0] === '--child') return child(args[1], args[2], Number(args[3]), args[4]);
  const seconds = Number(option('seconds', '4'));
  const rounds = Number(option('rounds', '2'));
  const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mage-lock-contention-build-'));
  try {
    const bundle = build(buildDir);
    console.log(JSON.stringify({ platform: process.platform, node: process.version, seconds, rounds }));
    for (const mode of ['raw', 'replace', 'heartbeat']) {
      for (let i = 0; i < rounds; i++) console.log(JSON.stringify(await round(mode, bundle, seconds)));
    }
  } finally {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }
}

await main();
