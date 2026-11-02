// Criterio de F2 sobre el benchmark R3 (H5 de la devolución 13), aplicado a una tanda nueva frente a la de
// referencia (R3 del baseline 018):
//  - duro: ninguna tarea pierde éxito (éxitos nuevos >= los de referencia, con el mismo número de ejecuciones);
//  - tiempo: la mediana de `ttfe` y la del total no superan el MÁXIMO de referencia en más de un 20 %. Si lo
//    superan, la tarea pide 3 repeticiones más antes de juzgar (`repeat`), y si persiste, bloquea;
//  - contexto (Claude): la mediana de tokens de entrada no sube más de un 10 % sobre la de referencia.
// Uso: node spike/bench/criteria.mjs <referencia.jsonl> <nueva.jsonl> [--provider=claude|codex]
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { median, summarize } from './summarize.mjs';

export const TIME_TOLERANCE = 1.2;
export const CONTEXT_TOLERANCE = 1.1;

const inputTokens = (row) => row.tokens.input + row.tokens.cacheRead + row.tokens.cacheCreate;

// Filas válidas de R3 por proveedor y tarea (sin pendientes ni errores de instrumento).
function rowsBy(rows, provider, task) {
  return rows.filter((r) => r.route === 'R3' && r.provider === provider && r.task === task && r.pending === undefined && r.error === undefined);
}

function maxOf(values) {
  const nums = values.filter((v) => typeof v === 'number');
  return nums.length === 0 ? null : Math.max(...nums);
}

// Veredicto de una tarea: `ok`, `repeat` (tiempo por encima: repetir 3 más) o `block`, con sus motivos.
export function judgeTask(reference, candidate, { provider }) {
  if (candidate.length === 0) return { verdict: 'pending', reasons: ['sin ejecuciones nuevas'] };
  const reasons = [];
  const okRef = reference.filter((r) => r.ok).length / Math.max(reference.length, 1);
  const okNew = candidate.filter((r) => r.ok).length / candidate.length;
  if (okNew < okRef) reasons.push(`éxito ${candidate.filter((r) => r.ok).length}/${candidate.length} < referencia ${reference.filter((r) => r.ok).length}/${reference.length}`);
  const slow = ['ttfeMs', 'totalMs'].filter((field) => {
    const limit = maxOf(reference.map((r) => r[field]));
    const value = median(candidate.map((r) => r[field]));
    return limit !== null && value !== null && value > limit * TIME_TOLERANCE;
  });
  if (provider === 'claude') {
    const refTokens = median(reference.map(inputTokens));
    const newTokens = median(candidate.map(inputTokens));
    if (refTokens !== null && newTokens !== null && newTokens > refTokens * CONTEXT_TOLERANCE) reasons.push(`tokens de entrada ${newTokens} > ${Math.round(refTokens * CONTEXT_TOLERANCE)} (+10 %)`);
  }
  if (reasons.length > 0) return { verdict: 'block', reasons };
  if (slow.length > 0) return { verdict: 'repeat', reasons: slow.map((f) => `${f} por encima del máximo de referencia +20 %`) };
  return { verdict: 'ok', reasons: [] };
}

export function judge(referenceRows, candidateRows, provider) {
  const tasks = [...new Set(referenceRows.filter((r) => r.route === 'R3' && r.provider === provider).map((r) => r.task))].sort();
  return tasks.map((task) => ({ task, ...judgeTask(rowsBy(referenceRows, provider, task), rowsBy(candidateRows, provider, task), { provider }) }));
}

const readRows = (file) => fs.readFileSync(file, 'utf8').trim().split(/\r?\n/).filter((l) => l.length > 0).map((l) => JSON.parse(l));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [refFile, newFile] = process.argv.slice(2);
  const provider = process.argv.find((a) => a.startsWith('--provider='))?.split('=')[1] ?? 'claude';
  const candidate = readRows(newFile);
  console.log(JSON.stringify({ provider, criterio: judge(readRows(refFile), candidate, provider), resumen: summarize(candidate.filter((r) => r.provider === provider)) }, null, 1));
}
