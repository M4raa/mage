import { describe, expect, it } from 'vitest';
import type { TranscriptBatch, TranscriptEntry } from '@shared/transcripts';
import { groupIntoBatches } from './transcriptReader';
import type { ParsedLineResult } from './normalize';
import { makeEntry } from '@testing/transcriptEntry';

type Batch = Omit<TranscriptBatch, 'bytesReadSoFar'>;

function okEntry(index: number): ParsedLineResult {
  return { ok: true, entry: makeEntry({ index, uuid: null, summary: `linea ${index}` }) };
}

function errorLine(lineNumber: number): ParsedLineResult {
  return { ok: false, error: 'JSON invalido', lineNumber };
}

async function* iterableOf(items: readonly ParsedLineResult[]): AsyncGenerator<ParsedLineResult> {
  for (const item of items) yield item;
}

async function collectBatches(
  lines: readonly ParsedLineResult[],
  batchSize: number,
  startingTotalLines = 0,
  startingLineNumber = 0,
): Promise<Batch[]> {
  const batches: Batch[] = [];
  for await (const batch of groupIntoBatches(iterableOf(lines), batchSize, startingTotalLines, startingLineNumber)) batches.push(batch);
  return batches;
}

describe('groupIntoBatches', () => {
  it('iterableVacio_devuelveUnSoloLoteFinalVacio', async () => {
    const batches = await collectBatches([], 200);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual({ entries: [], errors: [], isFinal: true, totalLinesSoFar: 0, rawLineNumber: 0 });
  });

  it('masLineasQueBatchSize_partePartesEnVariosLotesNoFinales', async () => {
    const lines = Array.from({ length: 5 }, (_, i) => okEntry(i));

    const batches = await collectBatches(lines, 2);

    // 5 lineas, lotes de 2 -> [2, 2, 1(final)]
    expect(batches).toHaveLength(3);
    const [first, second, third] = batches;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    expect(first?.entries).toHaveLength(2);
    expect(first?.isFinal).toBe(false);
    expect(second?.entries).toHaveLength(2);
    expect(second?.isFinal).toBe(false);
    expect(third?.entries).toHaveLength(1);
    expect(third?.isFinal).toBe(true);
    expect(third?.totalLinesSoFar).toBe(5);
  });

  it('lineasConErroresIntercalados_acumulaErroresSinRomperElStream', async () => {
    const lines = [okEntry(0), errorLine(2), okEntry(3)];

    const batches = await collectBatches(lines, 10);

    expect(batches).toHaveLength(1);
    const [batch] = batches;
    expect(batch?.entries).toHaveLength(2);
    expect(batch?.errors).toHaveLength(1);
    expect(batch?.errors[0]?.lineNumber).toBe(2);
    expect(batch?.totalLinesSoFar).toBe(3);
  });

  it('ultimoLote_marcaIsFinalTrue', async () => {
    const lines = [okEntry(0), okEntry(1)];

    const batches = await collectBatches(lines, 10);

    expect(batches.at(-1)?.isFinal).toBe(true);
  });

  it('rawLineNumber_siguePorEntradasYPorErroresPorIgual', async () => {
    // okEntry(N) construye una entrada con index=N (linea fisica N+1); errorLine(N) es la linea N.
    const lines = [okEntry(4), errorLine(6)];

    const batches = await collectBatches(lines, 10);

    expect(batches.at(-1)?.rawLineNumber).toBe(6);
  });

  it('reanudacion_I5_siguenLosRecuentosDesdeLaPosicionDada_noReinicianA0', async () => {
    // Simula un refresco (tail) que empieza donde la lectura anterior se quedo: 1000 lineas ya
    // contadas, la ultima siendo la linea fisica 1000, y esta pasada solo trae 2 lineas nuevas.
    const lines = [okEntry(1000), okEntry(1001)]; // lineas fisicas 1001 y 1002

    const batches = await collectBatches(lines, 10, 1000, 1000);

    const last = batches.at(-1);
    expect(last?.totalLinesSoFar).toBe(1002); // 1000 previas + 2 nuevas, no 2
    expect(last?.rawLineNumber).toBe(1002);
  });

  it('reanudacion_I5_sinLineasNuevas_conservaLaPosicionDeReanudacion', async () => {
    // El fichero no cambio desde el ultimo refresco: 0 lineas nuevas, la posicion no debe caer a 0.
    const batches = await collectBatches([], 10, 1000, 1000);

    expect(batches[0]).toEqual({ entries: [], errors: [], isFinal: true, totalLinesSoFar: 1000, rawLineNumber: 1000 });
  });
});
