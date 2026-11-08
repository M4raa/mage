import { describe, expect, it, vi } from 'vitest';
import { ApiUsageStore } from './apiUsageStore';

const result = { isError: false, subtype: 'success', numTurns: 1, costMicroUsd: 19,
  usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11, cacheReadTokens: 0, cacheCreationTokens: 0, thinkingTokens: 0 } };

// Uso de 25 tokens por turno; el coste que llega es el ACUMULADO de la conversación (medido en 2.1.319).
const cumulative = (conversationId: string | undefined, costMicroUsd: number, tokens = 10) => ({ isError: false,
  subtype: 'success', numTurns: 1, costMicroUsd, ...(conversationId === undefined ? {} : { conversationId }),
  usage: { inputTokens: tokens, outputTokens: tokens === 0 ? 0 : 5, totalTokens: tokens === 0 ? 0 : tokens + 15,
    cacheReadTokens: tokens === 0 ? 0 : 10, cacheCreationTokens: 0, thinkingTokens: 0 } });

function memoryStore(initial: unknown = null): ApiUsageStore {
  let disk: unknown = initial;
  return new ApiUsageStore({ read: () => disk, write: (file) => { disk = file; }, now: () => 1000 });
}

describe('ApiUsageStore — coste acumulado por conversación', () => {
  it('record_tresResultsDeLaMismaConversacion_cuentaElCosteDeCadaTurno', () => {
    const store = memoryStore();

    store.record('a', cumulative('c1', 55));
    store.record('a', cumulative('c1', 110));
    store.record('a', cumulative('c1', 165));

    expect(store.get('a')).toMatchObject({ turns: 3, totals: { costMicroUsd: 165 }, lastTurn: { costMicroUsd: 55 } });
  });

  it('record_comandoLocalSinTokens_noPisaElUltimoTurno', () => {
    const store = memoryStore();
    store.record('a', cumulative('c1', 55));
    store.record('a', cumulative('c1', 110));

    store.record('a', cumulative('c1', 110, 0));

    expect(store.get('a')).toMatchObject({ turns: 2, lastTurn: { totalTokens: 25, costMicroUsd: 55 }, totals: { costMicroUsd: 110 } });
  });

  it('record_trasClear_otraConversacionEmpiezaDeCero', () => {
    const store = memoryStore();
    store.record('a', cumulative('c1', 110));

    store.record('a', cumulative('c2', 55));

    expect(store.get('a')?.lastTurn.costMicroUsd).toBe(55);
  });

  it('record_sinConversationId_tomaElCosteTalCual', () => {
    const store = memoryStore();

    store.record('a', cumulative(undefined, 55));

    expect(store.get('a')?.lastTurn.costMicroUsd).toBe(55);
  });

  it('record_ficheroSinMapa_loLee', () => {
    let disk: unknown = { version: 1, byAccount: {} };
    const write = vi.fn((file) => { disk = file; });
    const store = new ApiUsageStore({ read: () => disk, write, now: () => 1000 });

    store.record('a', cumulative('c1', 55));

    expect(disk).toMatchObject({ version: 1, cumulativeByConversation: { c1: 55 } });
  });
});

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
