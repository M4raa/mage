import { describe, expect, it } from 'vitest';
import { addApiTurn, apiAmountsOf, parseMicroUsd } from './apiUsage';
import { formatMicroUsd } from '@shared/usage';

describe('uso API en enteros', () => {
  it('parseMicroUsd_costeDeHaiku_conservaMicrousd', () => {
    expect(parseMicroUsd(0.000019)).toBe(19);
    expect(parseMicroUsd('1.9e-5')).toBe(19);
    expect(formatMicroUsd(19)).toBe('$0.000019');
  });

  it('parseMicroUsd_valoresInvalidos_noInventanCoste', () => {
    expect(parseMicroUsd(-0.01)).toBeNull();
    expect(parseMicroUsd('mal')).toBeNull();
  });

  it('apiAmountsOf_turnoMedido_sumaTokensConCache', () => {
    const turn = apiAmountsOf({ isError: false, subtype: 'success', numTurns: 1, costMicroUsd: 19,
      usage: { inputTokens: 9, outputTokens: 2, totalTokens: 11, cacheReadTokens: 3, cacheCreationTokens: 4, thinkingTokens: 0 } });

    expect(turn).toMatchObject({ totalTokens: 18, costMicroUsd: 19 });
    expect(addApiTurn(null, turn!, 1000)).toMatchObject({ turns: 1, totals: { totalTokens: 18 }, updatedAtMs: 1000 });
  });
});
