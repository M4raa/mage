import { createInterface } from 'node:readline';
import type { TranscriptBatch, TranscriptEntry, TranscriptParseError } from '@shared/transcripts';
import { parseTranscriptLine, type ParsedLineResult } from './normalize';

// Tamano de lote por numero de lineas: ~2000-2500 lineas (caso real del DoD, ~7-9MB) producen
// 10-13 lotes.
export const BATCH_SIZE = 200;
// Tamano de lote por tiempo (~1 frame): una linea `attachment` gigante no debe retener el lote
// esperando alcanzar BATCH_SIZE.
export const BATCH_FLUSH_MS = 16;

// Cede el control al event loop entre lotes (ademas de la cesion natural de I/O de readline), para
// que un archivo con muchas lineas cortas no sature el loop del main process antes del siguiente
// flush.
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// Numero de linea FISICA (1-based) de un resultado ya parseado: directo en los que fallaron, derivado
// de `index` en los que no (nunca se guarda dos veces el mismo dato).
function lineNumberOf(line: ParsedLineResult): number {
  return line.ok ? line.entry.index + 1 : line.lineNumber;
}

// Trocea un flujo de lineas ya parseadas en TranscriptBatch, por tamano o por tiempo (lo que
// ocurra antes). Funcion PURA respecto a la fuente de lineas (recibe un AsyncIterable, no abre
// ningun fichero) -> testeable con un iterable en memoria sin tocar disco.
// `startingTotalLines`/`startingLineNumber` (I5): para una reanudacion (tail), los dos recuentos
// acumulados siguen desde ahi en vez de reiniciar a 0 — sin `startingTotalLines`, un refresco a
// mitad de conversacion mostraria menos lineas de las que de verdad tiene el fichero; sin
// `startingLineNumber`, `rawLineNumber` (la posicion que la SIGUIENTE reanudacion necesita) quedaria
// mal si esta pasada no procesa ninguna linea (fichero sin cambios desde el ultimo refresco).
// `bytesReadSoFar` lo rellena el caller (TranscriptService): este modulo no abre el stream.
export async function* groupIntoBatches(
  lines: AsyncIterable<ParsedLineResult>,
  batchSize: number,
  startingTotalLines = 0,
  startingLineNumber = 0,
): AsyncGenerator<Omit<TranscriptBatch, 'bytesReadSoFar'>> {
  let entries: TranscriptEntry[] = [];
  let errors: TranscriptParseError[] = [];
  let totalLinesSoFar = startingTotalLines;
  let rawLineNumber = startingLineNumber;
  let batchStartedAt = Date.now();

  for await (const line of lines) {
    totalLinesSoFar += 1;
    rawLineNumber = lineNumberOf(line);
    if (line.ok) entries.push(line.entry);
    else errors.push({ lineNumber: line.lineNumber, message: line.error });

    const dueBySize = entries.length + errors.length >= batchSize;
    const dueByTime = Date.now() - batchStartedAt >= BATCH_FLUSH_MS;
    if (dueBySize || dueByTime) {
      yield { entries, errors, isFinal: false, totalLinesSoFar, rawLineNumber };
      entries = [];
      errors = [];
      batchStartedAt = Date.now();
      await yieldToEventLoop();
    }
  }

  yield { entries, errors, isFinal: true, totalLinesSoFar, rawLineNumber };
}

// Lee un archivo NDJSON de transcripcion linea a linea (nunca readFileSync: evita cargar el
// archivo entero en memoria y bloquear el event loop con un JSON.parse monolitico). `readStream`
// es inyectable para tests (fs.createReadStream real en produccion). `signal`, si se aborta,
// cierra la interfaz de readline DIRECTAMENTE (rl.close()): destruir solo el stream de entrada no
// basta, porque el async-iterator de readline puede quedar esperando un 'end' que nunca llega.
// `startingLineNumber` (I5): al reanudar una lectura por bytes (tail), la PRIMERA linea nueva no es
// la 1 sino la siguiente a la ultima ya consumida — de eso depende `TranscriptEntry.index` (clave
// estable de la virtualizacion): sin este offset, las entradas nuevas reusarian indices ya usados por
// las que el renderer ya tiene acumuladas.
export async function* readTranscriptLines(
  readStream: NodeJS.ReadableStream,
  signal?: AbortSignal,
  startingLineNumber = 0,
): AsyncGenerator<ParsedLineResult> {
  const rl = createInterface({ input: readStream, crlfDelay: Infinity });
  const onAbort = (): void => rl.close();
  signal?.addEventListener('abort', onAbort);
  try {
    let lineNumber = startingLineNumber;
    for await (const rawLine of rl) {
      lineNumber += 1;
      if (rawLine.trim().length === 0) continue; // linea en blanco (p.ej. fichero vacio): se ignora
      yield parseJsonLine(rawLine, lineNumber);
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

function parseJsonLine(rawLine: string, lineNumber: number): ParsedLineResult {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawLine);
  } catch {
    return { ok: false, error: 'JSON invalido (linea corrupta o truncada)', lineNumber };
  }
  return parseTranscriptLine(parsedJson, lineNumber);
}

// Orquesta lectura + troceo para un stream ya abierto. Punto de entrada usado por
// TranscriptService. `signal` permite cancelar una lectura en curso (ver readTranscriptLines).
// `startingLineNumber`/`startingTotalLines` (I5): posicion desde la que continuar en una reanudacion.
export function readTranscriptBatches(
  readStream: NodeJS.ReadableStream,
  signal?: AbortSignal,
  startingLineNumber = 0,
  startingTotalLines = 0,
): AsyncGenerator<Omit<TranscriptBatch, 'bytesReadSoFar'>> {
  return groupIntoBatches(readTranscriptLines(readStream, signal, startingLineNumber), BATCH_SIZE, startingTotalLines, startingLineNumber);
}
