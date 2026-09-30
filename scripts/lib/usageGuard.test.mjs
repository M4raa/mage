import { describe, expect, it } from 'vitest';
import { USAGE_GUARD_THRESHOLD_PERCENT, decideTurnTarget, parseTurnAnswer, spentPercent } from './usageGuard.mjs';

function usage(fiveHour, sevenDay, limits = []) {
  return { fiveHour: { utilization: fiveHour, resetsAt: null }, sevenDay: { utilization: sevenDay, resetsAt: null }, limits, apiCreditsMinor: 0, fetchedAt: 1 };
}

describe('spentPercent', () => {
  it('spentPercent_dosVentanas_devuelveLaMasGastada', () => {
    expect(spentPercent(usage(20, 55))).toBe(55);
  });

  it('spentPercent_limiteActivoMasAlto_manda', () => {
    const limits = [
      { kind: 'model', group: 'opus', percent: 90, severity: null, resetsAt: null, isActive: true },
      { kind: 'model', group: 'x', percent: 99, severity: null, resetsAt: null, isActive: false },
    ];

    expect(spentPercent(usage(10, 10, limits))).toBe(90);
  });

  it('spentPercent_null_devuelveNull', () => {
    expect(spentPercent(null)).toBeNull();
  });

  it('spentPercent_sinNumerosValidos_devuelveNull', () => {
    expect(spentPercent({ fiveHour: { utilization: 'x' }, sevenDay: {}, limits: 'no' })).toBeNull();
  });

  it('spentPercent_ceroGastado_devuelveCero', () => {
    expect(spentPercent(usage(0, 0))).toBe(0);
  });
});

describe('decideTurnTarget', () => {
  it('decideTurnTarget_justoEnElUmbral_real', () => {
    expect(decideTurnTarget({ spent: USAGE_GUARD_THRESHOLD_PERCENT, forced: null, interactive: false }).target).toBe('real');
  });

  it('decideTurnTarget_porEncimaInteractivo_pregunta', () => {
    expect(decideTurnTarget({ spent: 71, forced: null, interactive: true }).target).toBe('ask');
  });

  it('decideTurnTarget_porEncimaNoInteractivo_localYLoDice', () => {
    const decision = decideTurnTarget({ spent: 71, forced: null, interactive: false });

    expect(decision.target).toBe('local');
    expect(decision.reason).toMatch(/71 % > 70 %.*local/);
  });

  it('decideTurnTarget_usoSinLeerNoInteractivo_local', () => {
    const decision = decideTurnTarget({ spent: null, forced: null, interactive: false });

    expect(decision.target).toBe('local');
    expect(decision.reason).toMatch(/no se pudo leer/);
  });

  it('decideTurnTarget_forzado_ganaAlaGuarda', () => {
    expect(decideTurnTarget({ spent: 95, forced: 'real', interactive: false }).target).toBe('real');
    expect(decideTurnTarget({ spent: 5, forced: 'local', interactive: false }).target).toBe('local');
  });

  it('decideTurnTarget_forzadoInvalido_lanzaConElValor', () => {
    expect(() => decideTurnTarget({ spent: 5, forced: 'api', interactive: false })).toThrow(/"api"/);
  });
});

describe('parseTurnAnswer', () => {
  it('parseTurnAnswer_realOR_real', () => {
    expect(parseTurnAnswer('r')).toBe('real');
    expect(parseTurnAnswer(' Real ')).toBe('real');
  });

  it('parseTurnAnswer_vacioOCualquierOtra_local', () => {
    expect(parseTurnAnswer('')).toBe('local');
    expect(parseTurnAnswer('si')).toBe('local');
    expect(parseTurnAnswer(undefined)).toBe('local');
  });
});
