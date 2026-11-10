import { describe, expect, it } from 'vitest';
import { baseModelId, costMicroUsd, modelOfKey, priceOf, pricingKey } from './modelPricing';

const NONE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };

describe('pricingKey', () => {
  it('pricingKey_modeloConFecha_laQuita', () => {
    expect(pricingKey('claude-haiku-4-5-20251001', 10, false)).toBe('claude-haiku-4-5');
    expect(baseModelId('claude-opus-5-5')).toBe('claude-opus-5-5');
  });

  it('pricingKey_haiku55PorEncimaDe100k_tramoLargo', () => {
    expect(pricingKey('claude-haiku-5-5', 100_000, false)).toBe('claude-haiku-5-5');
    expect(pricingKey('claude-haiku-5-5', 100_001, false)).toBe('claude-haiku-5-5#long');
  });

  it('pricingKey_gpt6PorEncimaDe272k_tramoLargo', () => {
    expect(pricingKey('gpt-6.1-sol', 272_001, false)).toBe('gpt-6.1-sol#long');
    expect(pricingKey('gpt-6.1-sol', 272_000, false)).toBe('gpt-6.1-sol');
  });

  it('pricingKey_opusRapido_sufijoFast', () => {
    expect(pricingKey('claude-opus-5-5', 1, true)).toBe('claude-opus-5-5#fast');
    expect(modelOfKey('claude-haiku-5-5#long#fast')).toBe('claude-haiku-5-5');
  });

  it('pricingKey_promptNegativo_lanzaConElValor', () => {
    expect(() => pricingKey('x', -1, false)).toThrow(/-1/);
  });
});

describe('costMicroUsd', () => {
  it('costMicroUsd_opus55_cadaTipoASuPrecio', () => {
    // 1M de cada: entrada 4 $, salida 20 $, lectura 0,20 $, escritura 5 min 5 $, escritura 1 h 8 $ = 37,20 $.
    const tokens = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWrite5mTokens: 1_000_000, cacheWrite1hTokens: 1_000_000 };

    expect(costMicroUsd('claude-opus-5-5', tokens)).toBe(37_200_000);
  });

  it('costMicroUsd_modoRapido_eldoble', () => {
    expect(costMicroUsd('claude-opus-5-5#fast', { ...NONE, outputTokens: 1_000_000 })).toBe(40_000_000);
  });

  it('costMicroUsd_codex_sinCobrarEscrituraDeCache', () => {
    expect(costMicroUsd('gpt-6.1-sol', { ...NONE, inputTokens: 1_000_000, cacheReadTokens: 1_000_000, cacheWrite1hTokens: 1_000_000 })).toBe(2_100_000);
  });

  it('costMicroUsd_modeloSinPrecio_null', () => {
    expect(costMicroUsd('agy:1084', { ...NONE, inputTokens: 5 })).toBeNull();
    expect(priceOf('<synthetic>')).toBeNull();
  });

  it('costMicroUsd_sinTokens_cero', () => {
    expect(costMicroUsd('claude-sonnet-5-5', NONE)).toBe(0);
  });

  it('costMicroUsd_volumenEnorme_sinPerderPrecision', () => {
    // 10 000 M de tokens de salida de Fable 5.1 a 50 $/MTok = 500 000 $: el producto pasa de 2^53.
    expect(costMicroUsd('claude-fable-5-1', { ...NONE, outputTokens: 10_000_000_000 })).toBe(500_000_000_000);
  });

  it('costMicroUsd_tokensNoEnteros_lanzaConElValor', () => {
    expect(() => costMicroUsd('claude-opus-5-5', { ...NONE, inputTokens: 1.5 })).toThrow(/1.5/);
  });
});
