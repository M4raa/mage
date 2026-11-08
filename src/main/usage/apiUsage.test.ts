import { describe, expect, it } from 'vitest';
import { addApiResult, addApiTurn, apiAmountsOf, parseMicroUsd, turnCostMicroUsd } from './apiUsage';
import type { ApiUsageAmounts } from '@shared/usage';

const amounts = (totalTokens: number, costMicroUsd: number): ApiUsageAmounts =>
  ({ inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens, costMicroUsd });

describe('coste del turno por diferencia del acumulado', () => {
  it('turnCostMicroUsd_sinPrevio_devuelveElAcumulado', () => {
    expect(turnCostMicroUsd(undefined, 55)).toBe(55);
  });

  it('turnCostMicroUsd_acumuladoQueCrece_devuelveLaDiferencia', () => {
    expect(turnCostMicroUsd(55, 110)).toBe(55);
  });

  it('turnCostMicroUsd_acumuladoQueBaja_devuelveElAcumulado', () => {
    expect(turnCostMicroUsd(220, 55)).toBe(55);
  });

  it('turnCostMicroUsd_igual_devuelveCero', () => {
    expect(turnCostMicroUsd(165, 165)).toBe(0);
  });

  it('addApiResult_sinTokensNiCoste_devuelveElAnterior', () => {
    const previous = addApiTurn(null, amounts(25, 55), 1000);

    expect(addApiResult(previous, amounts(0, 0), 2000)).toBe(previous);
    expect(addApiResult(null, amounts(0, 0), 2000)).toBeNull();
  });

  it('addApiResult_sinTokensConCoste_soloSumaElCosteAlTotal', () => {
    const first = addApiTurn(null, amounts(25, 55), 1000);
    const previous = addApiTurn(first, amounts(25, 55), 1500);

    const next = addApiResult(previous, amounts(0, 7), 2000);

    expect(next).toMatchObject({ turns: 2, lastTurn: previous.lastTurn, updatedAtMs: 2000,
      totals: { totalTokens: 50, costMicroUsd: 117 } });
  });

  it('addApiResult_conTokens_esUnTurno', () => {
    const previous = addApiTurn(null, amounts(25, 55), 1000);

    expect(addApiResult(previous, amounts(10, 5), 2000)).toEqual(addApiTurn(previous, amounts(10, 5), 2000));
  });

  it('addApiResult_fechaInvalida_lanzaConElValor', () => {
    expect(() => addApiResult(null, amounts(0, 7), -1)).toThrow(/-1/);
    expect(() => addApiResult(null, amounts(0, 0), -1)).toThrow(/-1/);
  });
});
import { formatMicroUsd } from '@shared/usage';

describe('uso API en enteros', () => {
  it('parseMicroUsd_costeDeHaiku_conservaMicrousd', () => {
    expect(parseMicroUsd(0.000019)).toBe(19);
    expect(parseMicroUsd('1.9e-5')).toBe(19);
    expect(formatMicroUsd(19, 'en-US')).toBe('$0.000019');
    expect(formatMicroUsd(19, 'es-ES')).toBe('$0,000019');
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
