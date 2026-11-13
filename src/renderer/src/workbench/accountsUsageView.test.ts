import { describe, expect, it } from 'vitest';
import { lastDays, localDay } from './accountsUsageView';

describe('accountsUsageView', () => {
  it('lastDays_sieteDias_delMasAntiguoAlDeHoy', () => {
    expect(lastDays('2026-11-09', 3)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09']);
  });

  it('lastDays_ceroODiaRaro_lanza', () => {
    expect(() => lastDays('2026-11-09', 0)).toThrow(/0/);
    expect(() => lastDays('ayer', 3)).toThrow(/ayer/);
  });

  it('localDay_fechaLocal_formato', () => {
    expect(localDay(new Date(2026, 10, 9, 23, 30))).toBe('2026-11-09');
  });

  it('lastDays_cruzaCambioDeHora_sinHuecosNiRepetidos', () => {
    expect(lastDays('2026-10-26', 3)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
    expect(lastDays('2026-03-30', 3)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });
});
