import type { TranscriptBatch, TranscriptTailPosition } from '@shared/transcripts';

// Forma de `TranscriptService.openStream`, sin importar main: este directorio lo compilan node y web.
export interface TranscriptStreamSource {
  openStream(path: string, signal: AbortSignal, from?: TranscriptTailPosition): AsyncIterable<TranscriptBatch>;
}

// Una lectura entera de `openStream`, plegada lote a lote con la misma regla que `applyTranscriptBatch`
// del renderer. El lector corta los lotes también por TIEMPO (BATCH_FLUSH_MS): bajo carga una lectura de
// una sola línea sale en dos lotes, `reset` va en el PRIMERO y el último puede llegar vacío. Los tests que
// miraban solo el último lote fallaban de vez en cuando por eso; el producto no.
export interface FoldedTranscriptRead {
  readonly last: TranscriptBatch;
  readonly entries: TranscriptBatch['entries'];
  readonly errors: TranscriptBatch['errors'];
  readonly reset: boolean;
}

export async function readFoldedTranscript(service: TranscriptStreamSource, path: string, from?: TranscriptTailPosition): Promise<FoldedTranscriptRead> {
  let last: TranscriptBatch | undefined;
  let entries: TranscriptBatch['entries'] = [];
  let errors: TranscriptBatch['errors'] = [];
  let reset = false;
  for await (const batch of service.openStream(path, new AbortController().signal, from)) {
    entries = batch.reset === true ? [...batch.entries] : [...entries, ...batch.entries];
    errors = batch.reset === true ? [...batch.errors] : [...errors, ...batch.errors];
    reset ||= batch.reset === true;
    last = batch;
  }
  if (last === undefined) throw new Error(`Sin lote final al leer ${path}`);
  return { last, entries, errors, reset };
}

export const tailOf = (batch: TranscriptBatch): TranscriptTailPosition => ({
  bytesRead: batch.bytesReadSoFar, rawLineNumber: batch.rawLineNumber, totalLinesSoFar: batch.totalLinesSoFar,
});
