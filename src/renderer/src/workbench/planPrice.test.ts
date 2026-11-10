import { describe, expect, it } from 'vitest';
import { formatPlanPriceUsd, parsePlanPriceUsd } from './planPrice';

describe('parsePlanPriceUsd', () => {
  it.each([
    ['200', 200_000_000],
    ['19,99', 19_990_000],
    ['19.99', 19_990_000],
    ['$20', 20_000_000],
    [' 100 $ ', 100_000_000],
    ['0', 0],
  ])('parsePlanPriceUsd_%s_microUsdExactos', (text, micro) => {
    expect(parsePlanPriceUsd(text)).toEqual({ kind: 'ok', microUsd: micro });
  });

  it('parsePlanPriceUsd_vacio_sinPrecio', () => {
    expect(parsePlanPriceUsd('   ')).toEqual({ kind: 'empty' });
  });

  it.each(['-5', 'abc', '1.2.3', '20 €', '10000.01', '1,1234567'])('parsePlanPriceUsd_%s_invalido', (text) => {
    expect(parsePlanPriceUsd(text)).toEqual({ kind: 'invalid' });
  });
});

describe('formatPlanPriceUsd', () => {
  it('formatPlanPriceUsd_sinCerosDeSobra', () => {
    expect(formatPlanPriceUsd(200_000_000)).toBe('200');
    expect(formatPlanPriceUsd(19_990_000)).toBe('19.99');
    expect(formatPlanPriceUsd(0)).toBe('0');
  });

  it('formatPlanPriceUsd_negativoODecimal_lanza', () => {
    expect(() => formatPlanPriceUsd(-1)).toThrow(/-1/);
    expect(() => formatPlanPriceUsd(1.5)).toThrow(/1.5/);
  });
});
