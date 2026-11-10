import { describe, expect, it } from 'vitest';
import { EMPTY_DETAIL, type DailyDetail, type ModelUsage } from '@shared/usageHistory';
import { combineDetail, computeAccountMetrics, planValueOf, utilizationOf } from './accountMetrics';

const usage = (input: number, output: number, turns = 1): ModelUsage => ({ inputTokens: input, outputTokens: output, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, turns });

function day(d: string, byModel: Record<string, ModelUsage>, extra: Partial<DailyDetail> = {}): DailyDetail {
  const hours = new Array<number>(24).fill(0);
  hours[10] = Object.values(byModel).reduce((sum, u) => sum + u.turns, 0);
  return { ...EMPTY_DETAIL, hours, byModel, day: d, sessions: ['s1'], projects: {}, ...extra };
}

const PERIOD = ['2026-11-07', '2026-11-08', '2026-11-09'];

describe('computeAccountMetrics', () => {
  it('computeAccountMetrics_dosModelos_costeYFilasPorModelo', () => {
    const detail = [
      day('2026-11-08', { 'claude-opus-5-5': usage(1_000_000, 0) }),
      day('2026-11-09', { 'claude-opus-5-5': usage(0, 1_000_000), 'claude-haiku-5-5#long': usage(1_000_000, 0) }),
    ];

    const m = computeAccountMetrics({ detail, windows: [], period: PERIOD, planPriceMicroUsd: null });

    // Opus: 4 $ + 20 $; Haiku 5.5 tramo largo: 0,50 $.
    expect(m.costMicroUsd).toBe(24_500_000);
    expect(m.models.map((row) => row.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
    expect(m.models[1]?.costMicroUsd).toBe(500_000);
    expect(m.turns).toBe(3);
    expect(m.activeDays).toBe(2);
    expect(m.unpriced).toBe(false);
  });

  it('computeAccountMetrics_modeloSinPrecio_avisaYNoInventaCoste', () => {
    const m = computeAccountMetrics({ detail: [day('2026-11-09', { 'agy:1084': usage(100, 10) })], windows: [], period: PERIOD, planPriceMicroUsd: null });

    expect(m.unpriced).toBe(true);
    expect(m.costMicroUsd).toBe(0);
    expect(m.models[0]?.costMicroUsd).toBeNull();
  });

  it('computeAccountMetrics_conversacionDeVariosDias_cuentaUnaVez', () => {
    const detail = [day('2026-11-08', { x: usage(1, 1) }, { sessions: ['a', 'b'] }), day('2026-11-09', { x: usage(1, 1) }, { sessions: ['a'] })];

    expect(computeAccountMetrics({ detail, windows: [], period: PERIOD, planPriceMicroUsd: null }).conversations).toBe(2);
  });

  it('computeAccountMetrics_fueraDelPeriodo_noCuenta', () => {
    const m = computeAccountMetrics({ detail: [day('2026-10-01', { 'claude-opus-5-5': usage(5, 5) })], windows: [], period: PERIOD, planPriceMicroUsd: null });

    expect(m.tokens).toBe(0);
    expect(m.limits).toEqual({ fiveHour: 0, weekly: 0, other: 0 });
    expect(m.streak).toEqual({ longest: 0, current: 0 });
  });

  it('computeAccountMetrics_rachaYMapaDeCalor', () => {
    const detail = [day('2026-11-08', { x: usage(1, 1, 2) }), day('2026-11-09', { x: usage(1, 1) })];

    const m = computeAccountMetrics({ detail, windows: [], period: PERIOD, planPriceMicroUsd: null });

    expect(m.streak).toEqual({ longest: 2, current: 2 });
    // 2026-11-08 es domingo (0) y 2026-11-09 lunes (1), los dos a las 10.
    expect(m.heatmap[0]?.[10]).toBe(2);
    expect(m.heatmap[1]?.[10]).toBe(1);
  });

  it('computeAccountMetrics_topesHerramientasYProyectos_sumados', () => {
    const detail = [
      day('2026-11-08', {}, { limits: { fiveHour: 1, weekly: 0, other: 0 }, tools: { Bash: 3 }, projects: { 'C:/a': 10 } }),
      day('2026-11-09', {}, { limits: { fiveHour: 1, weekly: 1, other: 0 }, tools: { Bash: 1, Edit: 5 }, projects: { 'C:/a': 5, 'C:/b': 50 } }),
    ];

    const m = computeAccountMetrics({ detail, windows: [], period: PERIOD, planPriceMicroUsd: null });

    expect(m.limits).toEqual({ fiveHour: 2, weekly: 1, other: 0 });
    expect(m.tools).toEqual([['Edit', 5], ['Bash', 4]]);
    expect(m.projects).toEqual([['C:/b', 50], ['C:/a', 15]]);
  });
});

describe('utilizationOf', () => {
  const period = Array.from({ length: 14 }, (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`);

  it('utilizationOf_dosSemanasConPicos_media', () => {
    const windows = [
      { day: '2026-11-02', fiveHourMax: null, sevenDayMax: 30 },
      { day: '2026-11-05', fiveHourMax: null, sevenDayMax: 50 },
      { day: '2026-11-12', fiveHourMax: null, sevenDayMax: 90 },
    ];

    expect(utilizationOf(windows, period)).toEqual({ avgPct: 70, weeksWithData: 2, weeks: 2 });
  });

  it('utilizationOf_sinDato_null', () => {
    expect(utilizationOf([{ day: '2026-11-02', fiveHourMax: 10, sevenDayMax: null }], period)).toEqual({ avgPct: null, weeksWithData: 0, weeks: 2 });
  });

  it('utilizationOf_periodoNoMultiploDeSiete_ultimoBloqueIncompleto', () => {
    expect(utilizationOf([], period.slice(0, 10)).weeks).toBe(2);
    expect(utilizationOf([], []).weeks).toBe(0);
  });
});

describe('planValueOf', () => {
  it('planValueOf_planMensualEn30Dias_ratioDelCoste', () => {
    expect(planValueOf(400_000_000, 200_000_000, 30)).toEqual({ planCostMicroUsd: 200_000_000, ratio: 2 });
  });

  it('planValueOf_sieteDias_prorratea', () => {
    expect(planValueOf(0, 30_000_000, 7)).toEqual({ planCostMicroUsd: 7_000_000, ratio: 0 });
  });

  it('planValueOf_sinPrecioOPlanACero', () => {
    expect(planValueOf(5, null, 30)).toBeNull();
    expect(planValueOf(5, 0, 30)).toEqual({ planCostMicroUsd: 0, ratio: null });
  });

  it('planValueOf_precioNoEntero_lanzaConElValor', () => {
    expect(() => planValueOf(5, 1.5, 30)).toThrow(/1.5/);
  });
});

describe('combineDetail', () => {
  it('combineDetail_mismoDiaDeDosCuentas_sumaYUneSesiones', () => {
    const a = { accountId: 'a', days: [], windows: [], detail: [day('2026-11-09', { x: usage(1, 0) }, { sessions: ['s1'], projects: { p: 1 } })] };
    const b = { accountId: 'b', days: [], windows: [], detail: [day('2026-11-09', { x: usage(2, 0) }, { sessions: ['s2'], projects: { p: 2 } })] };

    const combined = combineDetail([a, b]);

    expect(combined).toHaveLength(1);
    expect(combined[0]?.byModel['x']?.inputTokens).toBe(3);
    expect(combined[0]?.sessions).toEqual(['s1', 's2']);
    expect(combined[0]?.projects).toEqual({ p: 3 });
  });
});
