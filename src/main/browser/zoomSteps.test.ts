import { describe, expect, it } from 'vitest';
import { nextZoom } from './zoomSteps';

describe('nextZoom', () => {
  it('nextZoom_cienMasUno_110', () => {
    expect(nextZoom(100, 1)).toBe(110);
  });

  it('nextZoom_cienMenosUno_90', () => {
    expect(nextZoom(100, -1)).toBe(90);
  });

  it('nextZoom_maximoMasUno_200', () => {
    expect(nextZoom(200, 1)).toBe(200);
  });

  it('nextZoom_minimoMenosUno_50', () => {
    expect(nextZoom(50, -1)).toBe(50);
  });

  it('nextZoom_cero_100', () => {
    expect(nextZoom(175, 0)).toBe(100);
  });

  it('nextZoom_fueraDeTabla_alSiguiente', () => {
    expect(nextZoom(105, 1)).toBe(110);
    expect(nextZoom(105, -1)).toBe(100);
  });

  it('nextZoom_noFinito_lanzaConValor', () => {
    expect(() => nextZoom(Number.NaN, 1)).toThrow(/NaN/);
    expect(() => nextZoom(0, 1)).toThrow(/: 0/);
  });
});
