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
});
