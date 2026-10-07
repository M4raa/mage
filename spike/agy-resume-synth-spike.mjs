// Mide si agy reanuda una conversación ESCRITA POR MAGE (no copiada tal cual): se parte de una conversación real
// como plantilla, se reescriben sus pasos con texto nuevo y se pide a agy que la continúe. GASTA UN TURNO de
// suscripción de agy por ejecución (autorizado por el usuario el 2026-10-07). Nunca toca el ~/.gemini real: la
// plantilla se lee en solo lectura y todo lo demás va en un USERPROFILE temporal.
// Uso: node spike/agy-resume-synth-spike.mjs [--template <id>] [--mode copy|text|text-no-blob] [--dry]
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const templateId = option('--template', '5e41189b-3232-466c-ab06-ebd3034c6aad');
const mode = option('--mode', 'text');
const dry = args.includes('--dry');
const secret = 'CIRUELA';

// --- protobuf sin esquema: leer, cambiar un campo por camino y volver a codificar ---------------------------
const readVarint = (buf, i) => { let v = 0; let s = 0; for (;;) { const b = buf[i++]; v += (b & 0x7f) * 2 ** s; if (!(b & 0x80)) return [v, i]; s += 7; } };
const varint = (value) => { const out = []; let r = value; while (r >= 0x80) { out.push((r % 0x80) | 0x80); r = Math.floor(r / 0x80); } return [...out, r]; };
function parse(buf) {
  const fields = [];
  let i = 0;
  while (i < buf.length) {
    const [key, k] = readVarint(buf, i); i = k;
    const field = Math.floor(key / 8); const wire = key % 8;
    if (wire === 0) { const [v, n] = readVarint(buf, i); i = n; fields.push({ field, wire, value: v }); }
    else if (wire === 2) { const [len, n] = readVarint(buf, i); fields.push({ field, wire, value: buf.subarray(n, n + len) }); i = n + len; }
    else if (wire === 1) { fields.push({ field, wire, value: buf.subarray(i, i + 8) }); i += 8; }
    else if (wire === 5) { fields.push({ field, wire, value: buf.subarray(i, i + 4) }); i += 4; }
    else throw new Error(`wire ${wire}`);
  }
  return fields;
}
function encode(fields) {
  const out = [];
  for (const { field, wire, value } of fields) {
    out.push(...varint(field * 8 + wire));
    if (wire === 0) out.push(...varint(value));
    else if (wire === 2) out.push(...varint(value.length), ...value);
    else out.push(...value);
  }
  return Buffer.from(out);
}
// Cambia el campo de `path` por `replacement` (Buffer) o lo elimina (null), recalculando las longitudes de los padres.
function patch(buf, path, replacement) {
  const [head, ...rest] = path;
  const fields = parse(buf);
  const index = fields.findIndex((f) => f.field === head && f.wire === 2);
  if (index < 0) return buf;
  if (rest.length === 0) {
    if (replacement === null) fields.splice(index, 1); else fields[index] = { ...fields[index], value: replacement };
  } else {
    fields[index] = { ...fields[index], value: patch(Buffer.from(fields[index].value), rest, replacement) };
  }
  return encode(fields);
}
const replaceAll = (buf, from, to) => Buffer.from(buf.toString('latin1').split(from).join(to), 'latin1');

// --- plantilla ------------------------------------------------------------------------------------------------
const real = join(homedir(), '.gemini', 'antigravity-cli', 'conversations', `${templateId}.db`);
const src = new DatabaseSync(real, { readOnly: true });
const ddl = src.prepare("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
const templateSteps = src.prepare('SELECT * FROM steps ORDER BY idx').all();
const trajMeta = src.prepare('SELECT * FROM trajectory_meta').get();
const metaBlob = src.prepare('SELECT * FROM trajectory_metadata_blob').all();
const userTpl = templateSteps.find((s) => s.step_type === 14);
const modelTpl = templateSteps.find((s) => s.step_type === 15);

const newConv = randomUUID();
const newTraj = randomUUID();
const swapIds = (value) => (value === null || value === undefined ? value
  : replaceAll(replaceAll(Buffer.from(value), templateId, newConv), trajMeta.trajectory_id, newTraj));
const text = (value) => Buffer.from(value, 'utf8');
const userPayload = (value) => {
  let p = patch(swapIds(userTpl.step_payload), [19, 2], text(value));
  p = patch(p, [19, 3, 1], text(value));
  return p;
};
const modelPayload = (value) => {
  let p = patch(swapIds(modelTpl.step_payload), [20, 1], text(value));
  p = patch(p, [20, 8], text(value));
  if (mode === 'text-no-blob') p = patch(p, [20, 14], null);
  return p;
};

// --- modo `minimal`: pasos construidos desde cero, sin clonar nada de la plantilla (salvo el DDL) -------------------
const lenField = (field, bytes) => encode([{ field, wire: 2, value: Buffer.from(bytes) }]);
const strField = (field, value) => lenField(field, Buffer.from(value, 'utf8'));
const numField = (field, value) => encode([{ field, wire: 0, value }]);
const stamp = (seconds, nanos = 0) => Buffer.concat([numField(1, seconds), numField(2, nanos)]);
const stepMeta = (kind, seconds) => Buffer.concat([lenField(1, stamp(seconds)), numField(3, kind === 'user' ? 4 : 2),
  strField(12, randomUUID()), lenField(20, Buffer.concat([strField(1, newTraj), strField(4, newConv)]))]);
const minimalStep = (kind, value, seconds) => {
  const meta = stepMeta(kind, seconds);
  const body = kind === 'user'
    ? lenField(19, Buffer.concat([strField(2, value), lenField(3, strField(1, value))]))
    : lenField(20, Buffer.concat([strField(1, value), strField(8, value)]));
  return { meta, payload: Buffer.concat([numField(1, kind === 'user' ? 14 : 15), numField(4, 3), lenField(5, meta), body]) };
};
const minimalBlob = (cwdUri) => Buffer.concat([lenField(1, Buffer.concat([strField(1, cwdUri), lenField(3, Buffer.alloc(0))])), lenField(2, stamp(1790776206)),
  strField(6, newConv), strField(7, cwdUri), strField(18, 'default-cli-project')]);

const conversation = [
  ['user', `Recuerda la palabra secreta ${secret}. Responde solo: recordado.`],
  ['model', 'recordado'],
];

const profile = mkdtempSync(join(tmpdir(), 'mage-agy-synth-'));
const dbDir = join(profile, '.gemini', 'antigravity-cli', 'conversations');
mkdirSync(dbDir, { recursive: true });
const dst = new DatabaseSync(join(dbDir, `${newConv}.db`));
for (const { sql } of ddl) dst.exec(sql);
dst.prepare('INSERT INTO trajectory_meta VALUES (?, ?, ?, ?)').run(newTraj, newConv, trajMeta.trajectory_type, trajMeta.source);
if (mode === 'minimal') dst.prepare('INSERT INTO trajectory_metadata_blob VALUES (?, ?)').run('main', minimalBlob(`file:///${profile.replaceAll('\\', '/')}`));
else for (const row of metaBlob) dst.prepare('INSERT INTO trajectory_metadata_blob VALUES (?, ?)').run(row.id, swapIds(row.data));
const insert = dst.prepare('INSERT INTO steps (idx, step_type, status, has_subtrajectory, metadata, error_details, permissions, task_details, render_info, step_payload, step_format) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
if (mode === 'minimal') {
  conversation.forEach(([kind, value], idx) => {
    const { meta, payload } = minimalStep(kind, value, 1790776206 + idx * 3);
    insert.run(idx, kind === 'user' ? 14 : 15, 3, 0, meta, null, null, null, null, payload, 0);
  });
} else if (mode === 'copy') {
  for (const s of templateSteps) insert.run(s.idx, s.step_type, s.status, s.has_subtrajectory, swapIds(s.metadata), s.error_details, s.permissions, s.task_details, s.render_info, swapIds(s.step_payload), s.step_format);
} else {
  conversation.forEach(([kind, value], idx) => {
    const tpl = kind === 'user' ? userTpl : modelTpl;
    insert.run(idx, tpl.step_type, tpl.status, tpl.has_subtrajectory, swapIds(tpl.metadata), tpl.error_details, tpl.permissions, tpl.task_details, tpl.render_info,
      kind === 'user' ? userPayload(value) : modelPayload(value), tpl.step_format);
  });
}
dst.close();
console.log(`modo ${mode}: conversación ${newConv} en ${dbDir}`);

try {
  if (dry) process.exit(0);
  const question = mode === 'copy' ? 'Que palabra dijiste en tu respuesta anterior? Responde solo esa palabra.' : 'Que palabra secreta te pedi recordar? Responde solo esa palabra.';
  const run = spawnSync('agy', ['--conversation', newConv, '--print', question, '--output-format', 'text'],
    { cwd: profile, env: { ...process.env, USERPROFILE: profile }, encoding: 'utf8', timeout: 180_000, windowsHide: true });
  console.log('salida de agy:', JSON.stringify((run.stdout ?? '').trim().slice(0, 300)), '| código', run.status);
  if ((run.stderr ?? '').trim().length > 0) console.log('stderr:', (run.stderr ?? '').trim().slice(0, 300));
  const cliDir = join(profile, '.gemini', 'antigravity-cli');
  const log = join(cliDir, 'cli.log');
  if (run.status !== 0 && existsSync(log)) console.log('cli.log (cola):', readFileSync(log, 'utf8').split('\n').slice(-12).join('\n').slice(-1800));
  if (run.status !== 0 && existsSync(join(cliDir, 'crashes'))) console.log('crashes:', readdirSync(join(cliDir, 'crashes')).join(', '));
  console.log(mode === 'copy' ? '(copia literal: debe contestar «naranja»)' : `(debe contestar «${secret}»)`, '→', (run.stdout ?? '').toUpperCase().includes(mode === 'copy' ? 'NARANJA' : secret) ? 'RESUMIÓ' : 'NO RESUMIÓ');
} finally {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
