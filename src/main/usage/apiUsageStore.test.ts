import { describe, expect, it, vi } from 'vitest';
import { ApiUsageStore } from './apiUsageStore';

const result = { isError: false, subtype: 'success', numTurns: 1, costMicroUsd: 19,
  usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11, cacheReadTokens: 0, cacheCreationTokens: 0, thinkingTokens: 0 } };

describe('ApiUsageStore', () => {
  it('record_dosTurnos_persisteTotalesEnterosPorCuenta', () => {
    let disk: unknown = null;
    const write = vi.fn((file) => { disk = file; });
    const store = new ApiUsageStore({ read: () => disk, write, now: () => 1000 });

    store.record('cuenta-a', result);
    store.record('cuenta-a', result);

    expect(store.get('cuenta-a')).toMatchObject({ turns: 2, totals: { totalTokens: 22, costMicroUsd: 38 },
      lastTurn: { totalTokens: 11, costMicroUsd: 19 } });
    expect(new ApiUsageStore({ read: () => disk, write, now: () => 2000 }).get('cuenta-a')?.turns).toBe(2);
    expect(store.get('cuenta-b')).toBeNull();
  });
});
