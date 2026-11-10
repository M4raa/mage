import { describe, expect, it } from 'vitest';
import type { UsageHistory } from '@shared/usageHistory';
import { dailySeries, daysOf, lastDays, localDay, periodTotals, seriesMax } from './accountsUsageView';

const day = (d: string, input: number) => ({ day: d, inputTokens: input, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 1 });

const HISTORY: UsageHistory = {
  generatedAt: 0,
  fromDay: '2026-10-11',
  accounts: [
    { accountId: 'a', days: [day('2026-11-08', 10), day('2026-11-09', 5)], detail: [], windows: [] },
    { accountId: 'b', days: [day('2026-11-09', 7)], detail: [], windows: [] },
  ],
  unattributed: [day('2026-11-01', 3)],
};

describe('accountsUsageView', () => {
  it('lastDays_sieteDias_delMasAntiguoAlDeHoy', () => {
    expect(lastDays('2026-11-09', 3)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09']);
  });

  it('lastDays_ceroODiaRaro_lanza', () => {
    expect(() => lastDays('2026-11-09', 0)).toThrow(/0/);
    expect(() => lastDays('ayer', 3)).toThrow(/ayer/);
  });

  it('daysOf_todas_incluyeLasSinAtribuir', () => {
    expect(daysOf(HISTORY, null)).toHaveLength(4);
    expect(daysOf(HISTORY, 'b')).toEqual([day('2026-11-09', 7)]);
    expect(daysOf(HISTORY, 'no-existe')).toEqual([]);
  });

  it('dailySeries_sumaElMismoDiaYRellenaConCero', () => {
    const series = dailySeries(daysOf(HISTORY, null), ['2026-11-07', '2026-11-08', '2026-11-09']);

    expect(series.map((d) => d.inputTokens)).toEqual([0, 10, 12]);
  });

  it('periodTotals_hoySemanaMes', () => {
    expect(periodTotals(daysOf(HISTORY, null), '2026-11-09')).toEqual({ today: 12, week: 22, month: 25 });
  });

  it('seriesMax_todoCero_uno', () => {
    expect(seriesMax(dailySeries([], ['2026-11-09']))).toBe(1);
  });

  it('localDay_fechaLocal_formato', () => {
    expect(localDay(new Date(2026, 10, 9, 23, 30))).toBe('2026-11-09');
  });
});
