// Spike (devolución 19, H2): ¿actualiza el sistema de ficheros el mtime y el tamaño de un fichero que OTRO proceso
// mantiene abierto y al que va añadiendo líneas, como hace Codex con su rollout? Un proceso hijo escribe (sin cerrar el
// fichero) y este lo mira con `fs.statSync`, igual que `CodexHistoryService.describe`. Sin CLI ni datos del usuario.
//
//   node spike/rollout-mtime-spike.mjs [--lines=12] [--every=300] [--fsync]
//
// Imprime un JSON con las muestras y el veredicto: si el mtime y el tamaño cambian con el fichero abierto y al cerrarlo.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const arg = (name, fallback) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const LINES = arg('lines', 12);
const EVERY_MS = arg('every', 300);
const FSYNC = process.argv.includes('--fsync');
// Tras la última línea, el escritor espera con el fichero aún abierto antes de cerrarlo.
const HOLD_OPEN_MS = 1500;

// El escritor: abre en modo append, escribe una línea JSONL cada EVERY_MS y avisa por stdout de cada hito.
const WRITER = `
const fs = require('node:fs');
const [file, lines, every, fsync, hold] = process.argv.slice(1);
const fd = fs.openSync(file, 'a');
let n = 0;
const timer = setInterval(() => {
  fs.writeSync(fd, JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg', n }) + '\\n');
  if (fsync === '1') fs.fsyncSync(fd);
  console.log('line ' + n);
  n += 1;
  if (n < Number(lines)) return;
  clearInterval(timer);
  setTimeout(() => { fs.closeSync(fd); console.log('closed'); }, Number(hold));
}, Number(every));
`;

function sample(file, phase, startedAt) {
  const stat = statSync(file);
  return { tMs: Date.now() - startedAt, phase, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'mage-rollout-mtime-'));
  const file = join(dir, 'rollout-spike.jsonl');
  const startedAt = Date.now();
  const child = spawn(process.execPath, ['-e', WRITER, file, String(LINES), String(EVERY_MS), FSYNC ? '1' : '0', String(HOLD_OPEN_MS)], { stdio: ['ignore', 'pipe', 'inherit'] });
  let phase = 'abriendo';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { phase = chunk.includes('closed') ? 'cerrado' : 'abierto'; });
  const samples = [];
  const timer = setInterval(() => { if (phase !== 'abriendo') samples.push(sample(file, phase, startedAt)); }, EVERY_MS / 2);
  await new Promise((resolve) => child.on('exit', resolve));
  clearInterval(timer);
  await new Promise((resolve) => setTimeout(resolve, 500));
  samples.push(sample(file, 'cerrado', startedAt));
  rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify({ platform: process.platform, node: process.version, lines: LINES, everyMs: EVERY_MS, fsync: FSYNC, verdict: verdictOf(samples), samples }, null, 2));
}

function verdictOf(samples) {
  const open = samples.filter((s) => s.phase === 'abierto');
  const closed = samples.filter((s) => s.phase === 'cerrado');
  const distinct = (list, key) => new Set(list.map((s) => s[key])).size;
  return {
    mtimeCambiaConElFicheroAbierto: distinct(open, 'mtimeMs') > 1,
    tamanoCambiaConElFicheroAbierto: distinct(open, 'sizeBytes') > 1,
    mtimeAlCerrar: closed.at(-1)?.mtimeMs ?? null,
    ultimoMtimeAbierto: open.at(-1)?.mtimeMs ?? null,
    muestrasAbierto: open.length,
  };
}

await main();
