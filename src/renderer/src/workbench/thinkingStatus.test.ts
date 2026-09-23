import { describe, expect, it } from 'vitest';
import { computeThinkingStatus } from './thinkingStatus';

describe('computeThinkingStatus', () => {
  it('elapsedBajoUnMinuto_muestraSegundos', () => {
    expect(computeThinkingStatus(12_000, 0).elapsedText).toBe('12 s');
  });

  it('elapsedSobreUnMinuto_muestraMinutosYSegundosConPad', () => {
    expect(computeThinkingStatus(65_000, 0).elapsedText).toBe('1 m 05 s');
  });

  it('laPalabraCambiaConElTiempo', () => {
    const first = computeThinkingStatus(0, 0).label;
    const later = computeThinkingStatus(4_000, 0).label;

    expect(first).toBe('pensando');
    expect(later).not.toBe(first); // ha cambiado tras el intervalo
  });

  it('sinActividadRecienteBajoUmbral_noStalled', () => {
    expect(computeThinkingStatus(30_000, 10_000).stalled).toBe(false);
  });

  it('sinActividadSobreUmbral_stalled', () => {
    const status = computeThinkingStatus(60_000, 30_000);

    expect(status.stalled).toBe(true);
    expect(status.sinceActivityText).toBe('30 s');
  });

  it('elapsedNegativo_seSaneaA0', () => {
    expect(computeThinkingStatus(-5, 0).elapsedText).toBe('0 s');
  });
});
