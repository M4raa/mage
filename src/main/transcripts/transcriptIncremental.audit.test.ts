import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { BATCH_SIZE } from './transcriptReader';
import { TranscriptService } from './transcriptService';
import type { TranscriptBatch, TranscriptTailPosition } from '@shared/transcripts';

const line = (uuid: string) => JSON.stringify({ type: 'user', uuid, message: { content: uuid } }) + '\n';
const tailOf = (batch: TranscriptBatch): TranscriptTailPosition => ({
  bytesRead: batch.bytesReadSoFar, rawLineNumber: batch.rawLineNumber, totalLinesSoFar: batch.totalLinesSoFar,
});
function transcriptService(contents: () => string): TranscriptService {
  return new TranscriptService({
    exists: () => true,
    sizeOf: () => Buffer.byteLength(contents()),
    createReadStream: (_path, start = 0) => Readable.from([Buffer.from(contents()).subarray(start)]),
  });
}
async function lastBatch(service: TranscriptService, from?: TranscriptTailPosition): Promise<TranscriptBatch> {
  let last: TranscriptBatch | undefined;
  for await (const batch of service.openStream('fixture.jsonl', new AbortController().signal, from)) last = batch;
  if (last === undefined) throw new Error('No se recibió ningún lote');
  return last;
}

describe('transcripciones incrementales', () => {
  it('A02_lineaIncompleta_releerlaConservaSuIndiceFisico', async () => {
    const complete = line('b');
    let contents = line('a') + complete.slice(0, 12);
    const service = transcriptService(() => contents);
    const first = await lastBatch(service);
    contents = line('a') + complete;
    const second = await lastBatch(service, tailOf(first));
    expect(second.entries.find((entry) => entry.uuid === 'b')?.index).toBe(1);
  });

  it('A03_lineasBlancasFinales_reanudarConservaElIndiceFisico', async () => {
    let contents = line('a') + '\n\n';
    const service = transcriptService(() => contents);
    const first = await lastBatch(service);
    contents += line('b');
    const second = await lastBatch(service, tailOf(first));
    expect(second.entries.find((entry) => entry.uuid === 'b')?.index).toBe(3);
  });

  it('A10_transcripcionTruncada_releerSustituyeLasEntradasAntiguas', async () => {
    let contents = line('viejo-1') + line('viejo-2');
    const service = transcriptService(() => contents);
    const first = await lastBatch(service);
    contents = line('nuevo');
    const second = await lastBatch(service, tailOf(first));
    expect(second.reset).toBe(true);
    expect(second.entries.map(entry => entry.uuid)).toEqual(['nuevo']);
  });
});



describe('checkpoint incremental — límites y reemplazo', () => {
  it('A10_resetSoloEnPrimerLote_conservaLosSiguientes', async () => {
    let contents = line('viejo-' + 'x'.repeat(60_000));
    const service = transcriptService(() => contents);
    const first = await lastBatch(service);
    contents = Array.from({ length: BATCH_SIZE + 20 }, (_, i) => line(String(i))).join('');
    const entries = [];
    let resets = 0;
    for await (const batch of service.openStream('fixture.jsonl', new AbortController().signal, tailOf(first))) {
      if (batch.reset) resets++;
      entries.push(...batch.entries);
    }
    expect(resets).toBe(1);
    expect(entries.map(entry => entry.uuid)).toEqual(Array.from({ length: BATCH_SIZE + 20 }, (_, i) => String(i)));
  });

  it('A10_truncadoAVacio_eliminaEntradasYErroresPrevios', async () => {
    let contents = line('viejo') + 'no es JSON\n';
    const service = transcriptService(() => contents);
    const first = await lastBatch(service);
    expect(first.errors).toHaveLength(1);
    contents = '';
    const second = await lastBatch(service, tailOf(first));
    expect(second.reset).toBe(true);
    expect(second.entries).toEqual([]);
    expect(second.errors).toEqual([]);
    expect(tailOf(second)).toEqual({ bytesRead: 0, rawLineNumber: 0, totalLinesSoFar: 0 });
  });

  it.each(['\n', '\r\n'])('A02_colaUTF8SinTerminador_%j_noPublicaDuplicadosNiErroresProvisionales', async ending => {
    const firstLine = line('á😀').trimEnd() + ending;
    const next = line('ñ😀').trimEnd() + ending;
    let contents = firstLine + next.slice(0, -ending.length);
    const service = transcriptService(() => contents);
    const first = await lastBatch(service);
    expect(first.entries.map(entry => entry.uuid)).toEqual(['á😀']);
    expect(first.errors).toEqual([]);
    expect(tailOf(first)).toEqual({ bytesRead: Buffer.byteLength(firstLine), rawLineNumber: 1, totalLinesSoFar: 1 });
    const unchanged = await lastBatch(service, tailOf(first));
    expect(unchanged.entries).toEqual([]);
    expect(tailOf(unchanged)).toEqual(tailOf(first));
    contents = firstLine + next;
    const second = await lastBatch(service, tailOf(unchanged));
    expect(second.entries.map(entry => [entry.uuid, entry.index])).toEqual([['ñ😀', 1]]);
    expect(second.totalLinesSoFar).toBe(2);
  });

  it.each(['\n', '\r\n'])('A03_soloBlancasYErrorCompleto_%j_checkpointFisicoAcumulado', async ending => {
    let contents = ending.repeat(3);
    const service = transcriptService(() => contents);
    const first = await lastBatch(service);
    expect(first.rawLineNumber).toBe(3);
    expect(first.totalLinesSoFar).toBe(0);
    contents += 'JSON inválido' + ending + ending;
    const second = await lastBatch(service, tailOf(first));
    expect(second.errors.map(error => error.lineNumber)).toEqual([4]);
    expect(second.rawLineNumber).toBe(5);
    expect(second.totalLinesSoFar).toBe(1);
    contents += line('b').trimEnd() + ending;
    const third = await lastBatch(service, tailOf(second));
    expect(third.entries[0]?.index).toBe(5);
    expect(third.totalLinesSoFar).toBe(2);
    expect(third.reset).toBeUndefined();
  });
});
