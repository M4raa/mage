import { describe, expect, it } from 'vitest';
import type { TurnUsage } from '@shared/events';
import { accumulateProviderUsage, providerUsageCategoryTotals } from './providerUsage';

const turn = (over: Partial<TurnUsage> = {}): TurnUsage => ({ inputTokens: 18778, outputTokens: 13, totalTokens: 18791, thinkingTokens: 0, cacheReadTokens: 11008, ...over });

describe('accumulateProviderUsage', () => {
  it('accumulateProviderUsage_dosTurnos_sumaYGuardaLaEntradaDelUltimo', () => {
    const first = accumulateProviderUsage(undefined, turn())!;
    const second = accumulateProviderUsage(first, turn({ inputTokens: 20000, outputTokens: 50, cacheReadTokens: 18000, thinkingTokens: 5 }))!;

    expect(second).toEqual({ turns: 2, inputTokens: 38778, cachedTokens: 29008, outputTokens: 63, thinkingTokens: 5, lastInputTokens: 20000 });
  });

  it('accumulateProviderUsage_sinEntradaNiSalida_noCuentaElTurno', () => {
    expect(accumulateProviderUsage(undefined, turn({ inputTokens: null, outputTokens: null }))).toBeNull();
  });

  it('accumulateProviderUsage_cacheMayorQueLaEntrada_seAcotaALaEntrada', () => {
    expect(accumulateProviderUsage(undefined, turn({ inputTokens: 100, cacheReadTokens: 500 }))?.cachedTokens).toBe(100);
  });

  it('accumulateProviderUsage_contadorNegativoONoEntero_lanzaConElValor', () => {
    expect(() => accumulateProviderUsage(undefined, turn({ outputTokens: -1 }))).toThrow('-1');
    expect(() => accumulateProviderUsage(undefined, turn({ inputTokens: 1.5 }))).toThrow('1.5');
  });
});

describe('providerUsageCategoryTotals', () => {
  it('providerUsageCategoryTotals_separaLaCacheDeLaEntradaYLasCategoriasSumanElTotal', () => {
    const totals = providerUsageCategoryTotals({ turns: 1, inputTokens: 18778, cachedTokens: 11008, outputTokens: 13, thinkingTokens: 0, lastInputTokens: 18778 });

    expect(totals).toEqual({ inputTokens: 7770, outputTokens: 13, cacheCreationInputTokens: 0, cacheReadInputTokens: 11008, totalTokens: 18791 });
    expect(totals.inputTokens + totals.outputTokens + totals.cacheReadInputTokens).toBe(totals.totalTokens);
  });
});
