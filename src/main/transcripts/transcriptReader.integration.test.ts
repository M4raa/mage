import { createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { TranscriptBatch } from '@shared/transcripts';
import { readTranscriptBatches } from './transcriptReader';

// __dirname no existe en modulos ESM: lo derivamos de import.meta.url (mismo patron que main/index.ts).
const currentDir = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string => join(currentDir, 'fixtures', name);

type Batch = Omit<TranscriptBatch, 'bytesReadSoFar'>;

async function readAll(filePath: string): Promise<Batch[]> {
  const batches: Batch[] = [];
  for await (const batch of readTranscriptBatches(createReadStream(filePath, { encoding: 'utf8' }))) {
    batches.push(batch);
  }
  return batches;
}

describe('readTranscriptBatches (integracion, fixtures reales en disco)', () => {
  it('ficheroVacio_devuelveBatchFinalSinEntradasNiErrores', async () => {
    const batches = await readAll(fixture('empty.jsonl'));

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual({ entries: [], errors: [], isFinal: true, totalLinesSoFar: 0, rawLineNumber: 0 });
  });

  it('ficheroMixedTypes_generaEntriesDeTodosLosTiposConCategoriaCorrecta', async () => {
    const batches = await readAll(fixture('mixed-types.jsonl'));
    const entries = batches.flatMap((b) => b.entries);
    const errors = batches.flatMap((b) => b.errors);

    expect(errors).toHaveLength(0);
    expect(entries).toHaveLength(13);

    const byKind = new Map(entries.map((e) => [e.kind, e]));
    expect(byKind.get('user')?.category).toBe('turn');
    expect(byKind.get('assistant')?.category).toBe('turn');
    expect(byKind.get('system')?.category).toBe('turn');
    expect(byKind.get('mode')?.category).toBe('metadata');
    expect(byKind.get('permission-mode')?.category).toBe('metadata');
    expect(byKind.get('file-history-snapshot')?.category).toBe('metadata');
    expect(byKind.get('attachment')?.category).toBe('metadata');
    expect(byKind.get('last-prompt')?.category).toBe('metadata');
    expect(byKind.get('ai-title')?.category).toBe('metadata');
    expect(byKind.get('agent-name')?.category).toBe('metadata');
    expect(byKind.get('custom-title')?.category).toBe('metadata');
    expect(byKind.get('queue-operation')?.category).toBe('metadata');
    expect(byKind.get('future-thing-not-yet-invented')?.category).toBe('unknown');

    expect(batches.at(-1)?.isFinal).toBe(true);
  });

  it('ficheroTruncadoAMitadDeLinea_reportaTranscriptParseErrorSinLanzarNiColgar', async () => {
    const batches = await readAll(fixture('truncated-mid-line.jsonl'));
    const entries = batches.flatMap((b) => b.entries);
    const errors = batches.flatMap((b) => b.errors);

    // 2 lineas previas validas (mode + user) + 1 linea final truncada con error
    expect(entries).toHaveLength(2);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.lineNumber).toBe(3);
    expect(batches.at(-1)?.isFinal).toBe(true);
  });

  it('hugeAttachment_noBloqueaElLoopEntreLotesYConservaElPayloadCompleto', async () => {
    const batches = await readAll(fixture('huge-attachment.jsonl'));
    const entries = batches.flatMap((b) => b.entries);

    expect(entries).toHaveLength(3);
    const attachmentEntry = entries.find((e) => e.kind === 'attachment');
    expect(attachmentEntry).toBeDefined();
    expect(JSON.stringify(attachmentEntry?.raw).length).toBeGreaterThan(1500);
    // el resumen de la fila SI esta acotado (no reventar el alto de la fila colapsada)
    expect(attachmentEntry?.summary.length).toBeLessThan(160);
  });

  // M2.2.2: la lectura+normalizacion extrae message.usage a `tokenUsage` en las lineas assistant
  // (la agregacion/deteccion de compactacion se prueba sobre este mismo patron real en
  // renderer/src/workbench/contextView.test.ts, dominio del renderer).
  it('usageWithCompaction_extraeTokenUsageSoloEnLineasAssistant', async () => {
    const batches = await readAll(fixture('usage-with-compaction.jsonl'));
    const entries = batches.flatMap((b) => b.entries);

    // Solo las 5 lineas assistant llevan tokenUsage; user/system no.
    const withUsage = entries.filter((e) => e.tokenUsage !== null);
    expect(withUsage).toHaveLength(5);
    expect(entries.find((e) => e.kind === 'user')?.tokenUsage).toBeNull();
    expect(entries.find((e) => e.kind === 'system')?.tokenUsage).toBeNull();

    // El patron real de compactacion queda representado en los datos: la 4a linea assistant tiene
    // cache_read (33547) muy inferior al de la 3a (221478), con el resto de contadores enteros.
    const preCompaction = withUsage[2]?.tokenUsage;
    const compaction = withUsage[3]?.tokenUsage;
    expect(preCompaction?.cacheReadInputTokens).toBe(221478);
    expect(compaction?.cacheReadInputTokens).toBe(33547);
    expect(compaction?.cacheCreationInputTokens).toBe(192888);
    expect(withUsage.every((e) => Number.isInteger(e.tokenUsage?.inputTokens))).toBe(true);
  });
});
