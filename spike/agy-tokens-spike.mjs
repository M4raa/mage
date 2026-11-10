// Mage — Spike del 2026-11-10 (P-039 M1): ¿guarda agy tokens por paso en sus bases SQLite?
// Recorre las bases de `<dir>` (por defecto ~/.gemini/antigravity-cli/conversations), cuenta los tipos de paso y, para los
// que no son entrada ni respuesta (los de «contabilidad»), vuelca la FORMA de sus campos varint: ruta del campo y valor
// numérico. NUNCA imprime texto: los campos de bytes que parecen texto se reducen a su longitud.
// Uso: node spike/agy-tokens-spike.mjs [--dir <carpeta>] [--max <bases>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseProtobuf } from '../src/main/conversations/protobufWire.ts';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const dir = arg('--dir', path.join(os.homedir(), '.gemini', 'antigravity-cli', 'conversations'));
const max = Number(arg('--max', '20'));

// Aplana un mensaje en «ruta -> valor numérico» (varints) y «ruta -> bytes(n)» (bytes no anidables).
function flatten(fields, prefix, out, depth = 0) {
  for (const f of fields) {
    const key = `${prefix}${f.field}`;
    if (f.kind === 'varint') out.push([key, f.value]);
    else if (f.kind === 'bytes') {
      const nested = depth < 6 ? parseProtobuf(f.value) : null;
      if (nested !== null && nested.length > 0) flatten(nested, `${key}.`, out, depth + 1);
      else out.push([key, `bytes(${f.value.length})`]);
    } else out.push([key, f.kind]);
  }
}

const dbs = fs.readdirSync(dir).filter((n) => n.endsWith('.db')).slice(0, max);
const typeCounts = new Map();
const samples = new Map();
for (const name of dbs) {
  const db = new DatabaseSync(path.join(dir, name), { readOnly: true });
  try {
    const rows = db.prepare('SELECT step_type, step_payload FROM steps ORDER BY idx').all();
    for (const row of rows) {
      typeCounts.set(row.step_type, (typeCounts.get(row.step_type) ?? 0) + 1);
      if (row.step_type === 14 || samples.has(row.step_type)) continue;
      const fields = parseProtobuf(row.step_payload ?? new Uint8Array());
      if (fields === null) continue;
      const out = [];
      flatten(fields, '', out);
      samples.set(row.step_type, out.slice(0, 140));
    }
  } finally {
    db.close();
  }
}
console.log(JSON.stringify({ bases: dbs.length, tipos: Object.fromEntries([...typeCounts].sort((a, b) => a[0] - b[0])) }));
for (const [type, out] of [...samples].sort((a, b) => a[0] - b[0])) {
  console.log(`\n== tipo ${type}`);
  for (const [k, v] of out) console.log(`  ${k} = ${v}`);
}
