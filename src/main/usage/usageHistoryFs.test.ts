import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listTranscripts, parseUsageHistoryCache, readRange } from './usageHistoryFs';
import { EMPTY_CACHE } from './usageHistoryService';

describe('listTranscripts', () => {
  it('listTranscripts_sesionesYSubagentes_lasDosConElIdDeLaSesion', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mage-usage-'));
    mkdirSync(join(root, 'proyecto', 's1', 'subagents'), { recursive: true });
    writeFileSync(join(root, 'proyecto', 's1.jsonl'), 'a\n');
    writeFileSync(join(root, 'proyecto', 's1', 'subagents', 'agent-x.jsonl'), 'b\n');
    writeFileSync(join(root, 'proyecto', 'notas.txt'), 'c');

    const files = await listTranscripts(root);

    expect(files.map((f) => f.sessionId).sort()).toEqual(['s1', 's1']);
  });

  it('listTranscripts_carpetaQueNoExiste_vacio', async () => {
    expect(await listTranscripts(join(tmpdir(), 'no-existe-mage-usage'))).toEqual([]);
  });
});

describe('readRange', () => {
  it('readRange_rango_leeEsosBytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mage-usage-'));
    writeFileSync(join(root, 'f'), 'abcdef');

    expect((await readRange(join(root, 'f'), 2, 4)).toString()).toBe('cd');
  });

  it('readRange_rangoInvertido_lanza', async () => {
    await expect(readRange('x', 4, 2)).rejects.toThrow(/4\.\.2/);
  });
});

describe('parseUsageHistoryCache', () => {
  it('parseUsageHistoryCache_sinFichero_vacia', () => {
    expect(parseUsageHistoryCache(null, vi.fn())).toBe(EMPTY_CACHE);
  });

  it('parseUsageHistoryCache_rotaOConOtraForma_vaciaYAvisa', () => {
    const warn = vi.fn();

    expect(parseUsageHistoryCache('{', warn)).toBe(EMPTY_CACHE);
    expect(parseUsageHistoryCache('{"version":3}', warn)).toBe(EMPTY_CACHE);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('parseUsageHistoryCache_valida_laDevuelve', () => {
    const cache = { version: 2, files: {}, windows: { a: { '2026-11-09': { fiveHourMax: 30, sevenDayMax: null } } } };

    expect(parseUsageHistoryCache(JSON.stringify(cache), vi.fn())).toEqual(cache);
  });

  it('parseUsageHistoryCache_versionAnteriorAlDetalle_seReconstruye', () => {
    // La v1 (0.1.5 antes de P-039) guardaba solo totales por día: no casa y se relee todo una vez.
    const v1 = { version: 1, files: { f: { offset: 1, sessionId: 's', state: { recentIds: [] }, days: { d: { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 1 } } } }, windows: {} };

    expect(parseUsageHistoryCache(JSON.stringify(v1), vi.fn())).toBe(EMPTY_CACHE);
  });
});
