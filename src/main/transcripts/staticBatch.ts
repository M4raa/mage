import type { TranscriptBatch, TranscriptParseError } from '@shared/transcripts';
import { parseTranscriptLine } from './normalize';

// Un único lote final con unas líneas ya construidas en memoria (el historial de agy sale de SQLite, no de un
// fichero NDJSON que se pueda leer a trozos). Mismo contrato que `readTranscriptBatches` hacia el renderer.
export function staticTranscriptBatch(lines: readonly unknown[]): TranscriptBatch {
  const entries: TranscriptBatch['entries'][number][] = [];
  const errors: TranscriptParseError[] = [];
  lines.forEach((line, index) => {
    const parsed = parseTranscriptLine(line, index + 1);
    if (parsed.ok) entries.push(parsed.entry);
    else errors.push({ lineNumber: parsed.lineNumber, message: parsed.error });
  });
  return { entries, errors, isFinal: true, totalLinesSoFar: lines.length, rawLineNumber: lines.length, bytesReadSoFar: 0 };
}
