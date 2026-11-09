import { describe, expect, it, vi } from 'vitest';
import { EMPTY_CACHE, UsageHistoryService, type TranscriptFile, type UsageHistoryCache, type UsageHistoryDeps } from './usageHistoryService';

const NOW = Date.parse('2026-11-09T12:00:00.000Z');
const line = (id: string, at: string, input = 10): string =>
  `${JSON.stringify({ type: 'assistant', timestamp: at, message: { id, usage: { input_tokens: input, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })}\n`;

function setup(initial: Record<string, string>, options: { mtimeMs?: number; accountOf?: (id: string) => string | undefined } = {}) {
  const files = new Map(Object.entries(initial));
  let saved: UsageHistoryCache = EMPTY_CACHE;
  const reads: { path: string; start: number; end: number }[] = [];
  const deps: UsageHistoryDeps = {
    roots: () => [{ dir: 'projects' }],
    listTranscripts: async () =>
      [...files.entries()].map(([path, text]): TranscriptFile => ({ path, sessionId: path.replace(/\.jsonl$/, ''), sizeBytes: Buffer.byteLength(text), mtimeMs: options.mtimeMs ?? NOW })),
    readRange: async (path, start, end) => {
      reads.push({ path, start, end });
      return Buffer.from(files.get(path) ?? '').subarray(start, end);
    },
    loadCache: () => saved,
    saveCache: (cache) => {
      saved = cache;
    },
    accountIds: () => ['a'],
    accountOf: options.accountOf ?? (() => 'a'),
    now: () => NOW,
    offsetMinutes: () => 0,
    log: vi.fn(),
  };
  return { service: new UsageHistoryService(deps), files, reads, saved: () => saved, deps };
}

describe('UsageHistoryService', () => {
  it('history_ficheroQueCrece_soloLeeLoNuevo', async () => {
    const h = setup({ 's1.jsonl': line('m1', '2026-11-09T10:00:00.000Z') });
    await h.service.history();
    const firstEnd = h.reads.at(-1)?.end ?? 0;
    h.files.set('s1.jsonl', `${h.files.get('s1.jsonl')}${line('m2', '2026-11-09T11:00:00.000Z', 5)}`);

    const history = await h.service.history();

    expect(h.reads.at(-1)?.start).toBe(firstEnd);
    expect(history.accounts[0]?.days).toEqual([{ day: '2026-11-09', inputTokens: 15, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 2 }]);
  });

  it('history_ficheroQueEncoge_seReleeDesdeElPrincipio', async () => {
    const h = setup({ 's1.jsonl': `${line('m1', '2026-11-09T10:00:00.000Z')}${line('m2', '2026-11-09T10:01:00.000Z')}` });
    await h.service.history();
    h.files.set('s1.jsonl', line('m3', '2026-11-09T10:02:00.000Z', 7));

    const history = await h.service.history();

    expect(history.accounts[0]?.days[0]).toMatchObject({ inputTokens: 7, turns: 1 });
  });

  it('history_lineaAMedioEscribir_seCuentaAlCompletarse', async () => {
    const full = line('m1', '2026-11-09T10:00:00.000Z');
    const h = setup({ 's1.jsonl': full.slice(0, 40) });
    const before = await h.service.history();
    h.files.set('s1.jsonl', full);

    const after = await h.service.history();

    expect(before.accounts[0]?.days).toEqual([]);
    expect(after.accounts[0]?.days[0]?.turns).toBe(1);
  });

  it('history_ficheroAntiguo_noSeLee', async () => {
    const h = setup({ 'viejo.jsonl': line('m1', '2026-01-01T10:00:00.000Z') }, { mtimeMs: NOW - 90 * 86_400_000 });

    await h.service.history();

    expect(h.reads).toEqual([]);
  });

  it('history_dosLlamadasSeguidas_unaSolaPasada', async () => {
    const h = setup({ 's1.jsonl': line('m1', '2026-11-09T10:00:00.000Z') });

    const [a, b] = await Promise.all([h.service.history(), h.service.history()]);

    expect(a).toBe(b);
    expect(h.reads).toHaveLength(1);
  });

  it('recordWindows_guardaLaFotoDelDiaYLaDevuelveElHistorial', async () => {
    const h = setup({});
    h.service.recordWindows('a', { fiveHourMax: 30, sevenDayMax: 12 });

    const history = await h.service.history();

    expect(history.accounts[0]?.windows).toEqual([{ day: '2026-11-09', fiveHourMax: 30, sevenDayMax: 12 }]);
    expect(h.saved().windows.a?.['2026-11-09']).toEqual({ fiveHourMax: 30, sevenDayMax: 12 });
  });

  it('recordWindows_cuentaVacia_lanza', () => {
    expect(() => setup({}).service.recordWindows(' ', { fiveHourMax: 1, sevenDayMax: 1 })).toThrow(/accountId/);
  });
});
