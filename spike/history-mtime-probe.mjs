// Sonda de H4 (devolución 18): ¿el mtime del fichero de una conversación dice cuándo se escribió por última vez?
// Solo lectura y sin contenido: imprime tiempos, tamaños y el instante de la ÚLTIMA entrada.
//   node spike/history-mtime-probe.mjs codex <CODEX_HOME>...   rollouts: `timestamp` de la última línea
//   node spike/history-mtime-probe.mjs agy <dir conversations>...  bases SQLite: campo 5.1.1 del último paso
// Las bases de agy se COPIAN (con su -wal) a una carpeta temporal y se lee la copia: nunca se abre la del usuario.
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const [mode, ...roots] = process.argv.slice(2);
if (mode !== 'codex' && mode !== 'agy') throw new Error(`Modo no valido: ${JSON.stringify(mode)} (codex | agy)`);

const walk = (dir) => existsSync(dir)
  ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
  : [];

// Protobuf mínimo: solo lo necesario para llegar a un varint por una ruta de campos.
function readVarint(buf, pos) {
  let value = 0; let shift = 1;
  for (;;) { const b = buf[pos++]; value += (b & 0x7f) * shift; shift *= 128; if (b < 0x80) return [value, pos]; }
}
function fields(buf) {
  const out = []; let pos = 0;
  while (pos < buf.length) {
    const [key, p1] = readVarint(buf, pos); const field = Math.floor(key / 8); const wire = key % 8; pos = p1;
    if (wire === 0) { const [v, p2] = readVarint(buf, pos); out.push({ field, varint: v }); pos = p2; }
    else if (wire === 2) { const [len, p2] = readVarint(buf, pos); out.push({ field, bytes: buf.subarray(p2, p2 + len) }); pos = p2 + len; }
    else if (wire === 1) pos += 8; else if (wire === 5) pos += 4; else return out;
  }
  return out;
}
function varintAt(buf, path) {
  let current = buf;
  for (const f of path.slice(0, -1)) { current = fields(current).find((x) => x.field === f && x.bytes)?.bytes; if (!current) return null; }
  return fields(current).find((x) => x.field === path.at(-1) && x.varint !== undefined)?.varint ?? null;
}

const row = (file, lastIso) => {
  const st = statSync(file);
  const lastMs = lastIso === null ? Number.NaN : Date.parse(lastIso);
  return { file: basename(file).slice(0, 48), sizeBytes: st.size, mtime: st.mtime.toISOString(), last: lastIso,
    lastMinusMtimeMin: Number.isNaN(lastMs) ? null : Math.round((lastMs - st.mtimeMs) / 600) / 100 };
};

function codexRow(file) {
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim().length > 0);
  let last = null;
  try { last = JSON.parse(lines.at(-1)).timestamp ?? null; } catch { last = null; }
  return row(file, last);
}

function agyRow(file, scratch) {
  const copy = join(scratch, basename(file));
  copyFileSync(file, copy);
  if (existsSync(`${file}-wal`)) copyFileSync(`${file}-wal`, `${copy}-wal`);
  const db = new DatabaseSync(copy);
  try {
    const step = db.prepare('SELECT step_payload FROM steps ORDER BY idx DESC LIMIT 1').get();
    const seconds = step?.step_payload ? varintAt(Buffer.from(step.step_payload), [5, 1, 1]) : null;
    const r = row(file, seconds === null ? null : new Date(seconds * 1000).toISOString());
    const wal = existsSync(`${file}-wal`) ? statSync(`${file}-wal`) : null;
    return { ...r, walBytes: wal?.size ?? null, walMtime: wal?.mtime.toISOString() ?? null };
  } finally { db.close(); }
}

const scratch = mkdtempSync(join(tmpdir(), 'mage-mtime-probe-'));
try {
  for (const root of roots) {
    const files = mode === 'codex'
      ? walk(join(root, 'sessions')).filter((f) => basename(f).startsWith('rollout-') && f.endsWith('.jsonl'))
      : walk(root).filter((f) => f.endsWith('.db'));
    for (const file of files) console.log(JSON.stringify(mode === 'codex' ? codexRow(file) : agyRow(file, scratch)));
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
