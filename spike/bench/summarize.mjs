// Resumen del baseline F0-B: por proveedor, ruta y tarea, éxitos, mediana [mín–máx] de ttfe y total,
// tokens de entrada y salida (mediana), coste declarado sumado y turnos reales. Sin estadística
// inferencial (H7: mediana y rango). Uso: node spike/bench/summarize.mjs <baseline.jsonl>
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function median(values) {
  const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function range(values) {
  const nums = values.filter((v) => typeof v === 'number');
  return nums.length === 0 ? null : [Math.min(...nums), Math.max(...nums)];
}

export function summarize(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.provider}|${row.route}|${row.task}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, list]) => {
    const [provider, route, task] = key.split('|');
    const ran = list.filter((r) => r.pending === undefined && r.error === undefined);
    return {
      provider, route, task,
      runs: list.length, pending: list.filter((r) => r.pending !== undefined).length, errors: list.filter((r) => r.error !== undefined).length,
      ok: ran.filter((r) => r.ok).length,
      ttfeMs: { median: median(ran.map((r) => r.ttfeMs)), range: range(ran.map((r) => r.ttfeMs)) },
      totalMs: { median: median(ran.map((r) => r.totalMs)), range: range(ran.map((r) => r.totalMs)) },
      inputTokens: median(ran.map((r) => r.tokens?.input + r.tokens?.cacheRead + r.tokens?.cacheCreate)),
      outputTokens: median(ran.map((r) => r.tokens?.output)),
      // H3 de la devolución 13 (solo Claude; null en filas anteriores que no lo midieron).
      rounds: median(ran.map((r) => r.rounds)),
      firstRequestTokens: median(ran.map((r) => r.firstRequestTokens)),
      costUsd: ran.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
      realTurns: ran.reduce((sum, r) => sum + (r.realTurns ?? 0), 0),
    };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = fs.readFileSync(process.argv[2], 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
  console.log(JSON.stringify(summarize(rows), null, 1));
}
