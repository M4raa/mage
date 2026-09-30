import { describe, expect, it } from 'vitest';
import { computeThinkingStatus, pickSpinnerVerb, SPINNER_VERBS } from './thinkingStatus';

describe('computeThinkingStatus', () => {
  it('elapsedBajoUnMinuto_muestraSegundos', () => {
    expect(computeThinkingStatus(12_000, 0, 1).elapsedText).toBe('12 s');
  });

  it('elapsedSobreUnMinuto_muestraMinutosYSegundosConPad', () => {
    expect(computeThinkingStatus(65_000, 0, 1).elapsedText).toBe('1 m 05 s');
  });

  it('mismaSemilla_dalaMismaPalabraAunqueCorraElTiempo', () => {
    const first = computeThinkingStatus(0, 0, 1_790_000_000_000).label;
    const later = computeThinkingStatus(120_000, 0, 1_790_000_000_000).label;

    expect(later).toBe(first);
  });

  it('semillasDistintas_recorrenVariosVerbos', () => {
    const labels = new Set(Array.from({ length: 50 }, (_, i) => pickSpinnerVerb(1_790_000_000_000 + i * 977)));

    expect(labels.size).toBeGreaterThan(10);
  });

  it('semillaNegativaOCero_daUnVerboDeLaLista', () => {
    expect(SPINNER_VERBS).toContain(pickSpinnerVerb(0));
    expect(SPINNER_VERBS).toContain(pickSpinnerVerb(-7));
  });

  it('lista_incluyeLosDelCliYLosPropios', () => {
    expect(SPINNER_VERBS).toContain('Accomplishing');
    expect(SPINNER_VERBS).toContain('Spellcasting');
  });

  it('sinActividadRecienteBajoUmbral_noStalled', () => {
    expect(computeThinkingStatus(30_000, 10_000, 1).stalled).toBe(false);
  });

  it('sinActividadSobreUmbral_stalled', () => {
    const status = computeThinkingStatus(60_000, 30_000, 1);

    expect(status.stalled).toBe(true);
    expect(status.sinceActivityText).toBe('30 s');
  });

  it('elapsedNegativo_seSaneaA0', () => {
    expect(computeThinkingStatus(-5, 0, 1).elapsedText).toBe('0 s');
  });
});
