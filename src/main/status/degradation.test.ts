import { describe, expect, it } from 'vitest';
import { clearDegraded, degradationReason, isDegraded, markDegraded, NOT_DEGRADED } from './degradation';

describe('markDegraded + isDegraded + degradationReason', () => {
  it('featureMarcada_quedaDegradadaConSuMotivo', () => {
    const state = markDegraded(NOT_DEGRADED, 'usage', 'cooldown tras 429');

    expect(isDegraded(state, 'usage')).toBe(true);
    expect(degradationReason(state, 'usage')).toBe('cooldown tras 429');
  });

  it('featureNuncaMarcada_noEstaDegradada', () => {
    expect(isDegraded(NOT_DEGRADED, 'usage')).toBe(false);
    expect(degradationReason(NOT_DEGRADED, 'usage')).toBeNull();
  });

  it('dosFeaturesDistintas_sonIndependientes', () => {
    const state = markDegraded(NOT_DEGRADED, 'usage', 'cooldown');

    expect(isDegraded(state, 'openvsx')).toBe(false);
  });

  it('motivoVacio_lanza', () => {
    expect(() => markDegraded(NOT_DEGRADED, 'usage', '')).toThrow(/motivo/);
    expect(() => markDegraded(NOT_DEGRADED, 'usage', '   ')).toThrow(/motivo/);
  });

  it('segundaMarca_sobrescribeElMotivoAnterior', () => {
    const first = markDegraded(NOT_DEGRADED, 'usage', 'motivo viejo');
    const second = markDegraded(first, 'usage', 'motivo nuevo');

    expect(degradationReason(second, 'usage')).toBe('motivo nuevo');
  });

  it('noMutaElEstadoRecibido', () => {
    markDegraded(NOT_DEGRADED, 'usage', 'cooldown');

    expect(NOT_DEGRADED.reasonByFeature).toEqual({});
  });
});

describe('clearDegraded', () => {
  it('featureDegradada_laLimpia', () => {
    const state = markDegraded(NOT_DEGRADED, 'usage', 'cooldown');

    expect(isDegraded(clearDegraded(state, 'usage'), 'usage')).toBe(false);
  });

  it('featureNoDegradada_devuelveLaMismaReferencia', () => {
    expect(clearDegraded(NOT_DEGRADED, 'usage')).toBe(NOT_DEGRADED);
  });

  it('soloAfectaALaFeatureIndicada', () => {
    const state = markDegraded(markDegraded(NOT_DEGRADED, 'usage', 'a'), 'openvsx', 'b');

    const cleared = clearDegraded(state, 'usage');

    expect(isDegraded(cleared, 'usage')).toBe(false);
    expect(isDegraded(cleared, 'openvsx')).toBe(true);
  });
});
