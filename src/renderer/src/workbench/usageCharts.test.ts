import { describe, expect, it } from 'vitest';
import { costMicroUsd } from '@shared/modelPricing';
import { EMPTY_MODEL_USAGE, NO_LIMITS, type AccountUsageHistory, type DailyDetail, type ModelUsage } from '@shared/usageHistory';
import { lastDays } from './accountsUsageView';
import {
  OTHER_SERIES,
  accountPoints,
  barHeightPx,
  budgetMeter,
  dayLabel,
  modelPoints,
  niceCeil,
  peakSlot,
  projectLabel,
  rankedRows,
  stackDaily,
  tokenSplitOf,
  windowMeter,
  type SeriesPoint,
} from './usageCharts';

function usage(input: number, output: number, cacheRead = 0, cacheWrite5m = 0, turns = 1): ModelUsage {
  return { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheWrite5mTokens: cacheWrite5m, cacheWrite1hTokens: 0, turns };
}

function dayDetail(day: string, byModel: Record<string, ModelUsage>): DailyDetail {
  return { day, byModel, limits: NO_LIMITS, hours: new Array<number>(24).fill(0), tools: {}, sessions: [], projects: {} };
}

function point(day: string, id: string, tokens: number, value = tokens): SeriesPoint {
  return { day, id, value, tokens };
}

const PERIOD = ['2026-11-10', '2026-11-11', '2026-11-12'];

describe('niceCeil', () => {
  it('niceCeil_cero_cero', () => {
    // Arrange / Act / Assert
    expect(niceCeil(0)).toBe(0);
  });

  it('niceCeil_valoresTipicos_unoDosOCincoPorPotencia', () => {
    // Arrange
    const cases: readonly (readonly [number, number])[] = [[1, 1], [7, 10], [150, 200], [1000, 1000], [4000, 5000], [12200, 20000]];
    // Act
    const result = cases.map(([value]) => niceCeil(value));
    // Assert
    expect(result).toEqual(cases.map(([, expected]) => expected));
  });

  it('niceCeil_negativo_lanza', () => {
    // Arrange / Act / Assert
    expect(() => niceCeil(-1)).toThrow('-1');
  });
});

describe('barHeightPx', () => {
  it('barHeightPx_ceroOSinMaximo_cero', () => {
    // Arrange / Act / Assert
    expect(barHeightPx(0, 100, 140)).toBe(0);
    expect(barHeightPx(5, 0, 140)).toBe(0);
  });

  it('barHeightPx_valorMinusculo_minimoDosPx', () => {
    // Arrange / Act
    const height = barHeightPx(1, 1_000_000, 140);
    // Assert
    expect(height).toBe(2);
  });

  it('barHeightPx_maximo_altoEntero', () => {
    // Arrange / Act
    const height = barHeightPx(500, 500, 140);
    // Assert
    expect(height).toBe(140);
  });
});

describe('stackDaily', () => {
  it('stackDaily_sinPuntos_sinSeriesYDiasACero', () => {
    // Arrange / Act
    const chart = stackDaily([], PERIOD);
    // Assert
    expect(chart.series).toEqual([]);
    expect(chart.days).toHaveLength(3);
    expect(chart.days.every((day) => day.total === 0)).toBe(true);
    expect(chart.max).toBe(0);
  });

  it('stackDaily_unDia_unaColumnaConSuTotal', () => {
    // Arrange
    const points = [point('2026-11-11', 'a', 10)];
    // Act
    const chart = stackDaily(points, PERIOD);
    // Assert
    expect(chart.series).toEqual(['a']);
    expect(chart.days[1]).toEqual({ day: '2026-11-11', values: [10], total: 10 });
    expect(chart.days[0]?.total).toBe(0);
    expect(chart.max).toBe(10);
  });

  it('stackDaily_cuatroModelos_tresYOtros', () => {
    // Arrange
    const points = [point('2026-11-12', 'a', 40), point('2026-11-12', 'b', 30), point('2026-11-12', 'c', 20), point('2026-11-12', 'd', 10)];
    // Act
    const chart = stackDaily(points, PERIOD);
    // Assert
    expect(chart.series).toEqual(['a', 'b', 'c', OTHER_SERIES]);
    expect(chart.days[2]?.values[3]).toBe(10);
    expect(chart.days[2]?.total).toBe(100);
  });

  it('stackDaily_tresModelos_sinOtros', () => {
    // Arrange
    const points = [point('2026-11-12', 'a', 3), point('2026-11-12', 'b', 2), point('2026-11-12', 'c', 1)];
    // Act
    const chart = stackDaily(points, PERIOD);
    // Assert
    expect(chart.series).toEqual(['a', 'b', 'c']);
  });

  it('stackDaily_diaFueraDelPeriodo_ordenaPeroNoPinta', () => {
    // Arrange
    const points = [point('2026-01-01', 'x', 1000), point('2026-11-12', 'y', 10)];
    // Act
    const chart = stackDaily(points, PERIOD);
    // Assert
    expect(chart.series).toEqual(['x', 'y']);
    expect(chart.days.every((day) => day.values[0] === 0)).toBe(true);
    expect(chart.days[2]?.values[1]).toBe(10);
  });

  it('stackDaily_periodoConCambioDeHora_unaColumnaPorDia', () => {
    // Arrange
    const period = lastDays('2026-10-26', 3);
    // Act
    const chart = stackDaily([], period);
    // Assert
    expect(chart.days.map((day) => day.day)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });
});

describe('modelPoints y accountPoints', () => {
  it('modelPoints_tramoLargo_mismoModelo', () => {
    // Arrange
    const detail = [dayDetail('2026-11-12', { 'claude-haiku-5-5': usage(10, 10), 'claude-haiku-5-5#long': usage(20, 20) })];
    // Act
    const points = modelPoints(detail, 'tokens');
    // Assert
    expect(points.map((p) => p.id)).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5']);
    expect(rankSeriesIds(points)).toEqual(['claude-haiku-5-5']);
  });

  it('modelPoints_costeSinPrecio_ceroConTokens', () => {
    // Arrange
    const detail = [dayDetail('2026-11-12', { 'agy:1318': usage(100, 50) })];
    // Act
    const [first] = modelPoints(detail, 'cost');
    // Assert
    expect(first?.value).toBe(0);
    expect(first?.tokens).toBeGreaterThan(0);
  });

  it('accountPoints_dosCuentas_idDeCuenta', () => {
    // Arrange
    const accounts: AccountUsageHistory[] = [
      { accountId: 'acc-1', days: [], detail: [dayDetail('2026-11-12', { 'claude-opus-5-5': usage(1, 1) })], windows: [] },
      { accountId: 'acc-2', days: [], detail: [dayDetail('2026-11-12', { 'claude-opus-5-5': usage(2, 2) })], windows: [] },
    ];
    // Act
    const points = accountPoints(accounts, 'tokens');
    // Assert
    expect(points.map((p) => p.id)).toEqual(['acc-1', 'acc-2']);
  });
});

function rankSeriesIds(points: readonly SeriesPoint[]): readonly string[] {
  return stackDaily(points, ['2026-11-12']).series;
}

describe('tokenSplitOf', () => {
  const today = '2026-11-12';
  const twoAgo = '2026-11-10';

  function seed(): DailyDetail[] {
    return [
      dayDetail(twoAgo, { 'gpt-6.1-sol': usage(3000, 1000) }),
      dayDetail(today, { 'claude-opus-5-5': usage(1000, 2000, 7000, 0, 4), 'claude-haiku-5-5': usage(500, 500, 0, 1000, 2), 'claude-sonnet-5-5': usage(100, 100) }),
    ];
  }

  it('tokenSplitOf_siembraVerify_partesYAcierto', () => {
    // Arrange
    const detail = seed();
    // Act
    const split = tokenSplitOf(detail, PERIOD);
    // Assert
    expect(split.tokens).toEqual({ input: 4600, output: 3600, cacheRead: 7000, cacheWrite: 1000 });
    expect(split.total).toBe(16200);
    expect(split.cacheHitPct).toBe(56);
  });

  it('tokenSplitOf_sinEntrada_aciertoNull', () => {
    // Arrange / Act
    const split = tokenSplitOf([], PERIOD);
    // Assert
    expect(split.cacheHitPct).toBeNull();
    expect(split.total).toBe(0);
  });

  it('tokenSplitOf_costePorParte_elDelModeloConSoloEsaParte', () => {
    // Arrange
    const detail = [dayDetail(today, { 'claude-opus-5-5': usage(1_000_000, 0) })];
    // Act
    const split = tokenSplitOf(detail, PERIOD);
    // Assert
    expect(split.costMicroUsd.input).toBe(costMicroUsd('claude-opus-5-5', { ...EMPTY_MODEL_USAGE, inputTokens: 1_000_000 }));
  });

  it('tokenSplitOf_modeloSinPrecio_tokensSinCoste', () => {
    // Arrange
    const detail = [dayDetail(today, { 'agy:1318': usage(100, 50) })];
    // Act
    const split = tokenSplitOf(detail, PERIOD);
    // Assert
    expect(split.tokens.input).toBe(100);
    expect(split.costMicroUsd).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it('tokenSplitOf_diaFueraDelPeriodo_noCuenta', () => {
    // Arrange
    const detail = [dayDetail('2026-01-01', { 'claude-opus-5-5': usage(999, 999) })];
    // Act
    const split = tokenSplitOf(detail, PERIOD);
    // Assert
    expect(split.total).toBe(0);
  });
});

describe('rankedRows', () => {
  it('rankedRows_ordenCuotaYAncho', () => {
    // Arrange / Act
    const rows = rankedRows([['b', 25], ['a', 75]], 100);
    // Assert
    expect(rows).toEqual([
      { id: 'a', value: 75, sharePct: 75, widthPct: 100 },
      { id: 'b', value: 25, sharePct: 25, widthPct: 33 },
    ]);
  });

  it('rankedRows_masDeOcho_soloOcho', () => {
    // Arrange
    const entries = Array.from({ length: 12 }, (_, i): readonly [string, number] => [`k${i}`, i + 1]);
    // Act
    const rows = rankedRows(entries, 78);
    // Assert
    expect(rows).toHaveLength(8);
    expect(rows[0]?.id).toBe('k11');
  });

  it('rankedRows_totalCero_cuotaCero', () => {
    // Arrange / Act
    const rows = rankedRows([['a', 5]], 0);
    // Assert
    expect(rows[0]?.sharePct).toBe(0);
  });

  it('rankedRows_valorCero_seQuita', () => {
    // Arrange / Act
    const rows = rankedRows([['a', 0], ['b', 3]], 3);
    // Assert
    expect(rows.map((row) => row.id)).toEqual(['b']);
  });
});

describe('projectLabel', () => {
  it('projectLabel_windows_ultimoTramo', () => {
    // Arrange / Act / Assert
    expect(projectLabel('C:\\sourcecode\\mage')).toBe('mage');
  });

  it('projectLabel_posixConBarraFinal_ultimoTramo', () => {
    // Arrange / Act / Assert
    expect(projectLabel('/home/u/app/')).toBe('app');
  });

  it('projectLabel_vacio_vacio', () => {
    // Arrange / Act / Assert
    expect(projectLabel('')).toBe('');
  });
});

describe('peakSlot', () => {
  it('peakSlot_mapaACero_null', () => {
    // Arrange
    const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    // Act / Assert
    expect(peakSlot(heatmap)).toBeNull();
  });

  it('peakSlot_unaCasilla_esa', () => {
    // Arrange
    const heatmap = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    heatmap[3]![10] = 7;
    // Act
    const peak = peakSlot(heatmap);
    // Assert
    expect(peak).toEqual({ weekday: 3, hour: 10, turns: 7 });
  });
});

describe('windowMeter', () => {
  it('windowMeter_85_quedan15Aviso', () => {
    // Arrange / Act
    const meter = windowMeter({ utilization: 85, resetsAt: null });
    // Assert
    expect(meter).toMatchObject({ usedPct: 85, remainingPct: 15, severity: 'warn' });
  });

  it('windowMeter_fueraDeRango_seRecorta', () => {
    // Arrange / Act
    const over = windowMeter({ utilization: 120, resetsAt: null });
    const under = windowMeter({ utilization: -5, resetsAt: null });
    // Assert
    expect(over).toMatchObject({ usedPct: 100, remainingPct: 0, severity: 'critical' });
    expect(under).toMatchObject({ usedPct: 0, remainingPct: 100, severity: 'ok' });
  });

  it('windowMeter_noNumerico_lanza', () => {
    // Arrange / Act / Assert
    expect(() => windowMeter({ utilization: Number.NaN, resetsAt: null })).toThrow('NaN');
  });
});

describe('budgetMeter', () => {
  it('budgetMeter_sinPresupuesto_null', () => {
    // Arrange / Act / Assert
    expect(budgetMeter(1000, null, 30)).toBeNull();
  });

  it('budgetMeter_presupuestoCero_null', () => {
    // Arrange / Act / Assert
    expect(budgetMeter(1000, 0, 30)).toBeNull();
  });

  it('budgetMeter_mitadDelMes_cincuentaOk', () => {
    // Arrange / Act
    const meter = budgetMeter(15_000_000, 30_000_000, 30);
    // Assert
    expect(meter).toMatchObject({ budgetMicroUsd: 30_000_000, usedPct: 50, severity: 'ok' });
  });

  it('budgetMeter_sieteDiasProrrateado_cienCritico', () => {
    // Arrange / Act
    const meter = budgetMeter(7_000_000, 30_000_000, 7);
    // Assert
    expect(meter).toMatchObject({ budgetMicroUsd: 7_000_000, usedPct: 100, severity: 'critical' });
  });

  it('budgetMeter_gastoNegativo_lanza', () => {
    // Arrange / Act / Assert
    expect(() => budgetMeter(-1, 30_000_000, 30)).toThrow('-1');
  });
});

describe('dayLabel', () => {
  it('dayLabel_diasDeCambioDeHora_mismoDia', () => {
    // Arrange / Act
    const autumn = dayLabel('2026-10-25', 'en-US');
    const spring = dayLabel('2026-03-29', 'en-US');
    // Assert
    expect(autumn).toContain('25');
    expect(spring).toContain('29');
    expect(autumn).toContain('Sun');
    expect(spring).toContain('Sun');
  });

  it('dayLabel_formatoRaro_lanza', () => {
    // Arrange / Act / Assert
    expect(() => dayLabel('ayer', 'es-ES')).toThrow('ayer');
  });
});
