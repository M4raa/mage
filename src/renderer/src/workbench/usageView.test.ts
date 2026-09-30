import { describe, expect, it } from 'vitest';
import type { UsageInfo } from '@shared/usage';
import {
  formatResetAbsolute,
  FIVE_HOUR_WINDOW_MS,
  SEVEN_DAY_WINDOW_MS,
  formatApiCredits,
  formatProjection,
  formatResetTime,
  perModelBars,
  projectWindowExhaustion,
  severityForPct,
  toUsageWindows,
} from './usageView';

const NOW = 1_000_000_000_000;

function usage(overrides: Partial<UsageInfo> = {}): UsageInfo {
  return {
    fiveHour: { utilization: 62, resetsAt: NOW + 84 * 60_000 }, // +1 h 24 m
    sevenDay: { utilization: 31, resetsAt: NOW + 3 * 1440 * 60_000 }, // +3 d
    limits: [],
    apiCreditsMinor: 0,
    fetchedAt: NOW,
    ...overrides,
  };
}

describe('formatResetTime', () => {
  it('formatResetTime_epochValido_devuelveLaHoraLocalConDosDigitos', () => {
    const resetsAt = new Date(2026, 0, 2, 15, 4).getTime(); // hora LOCAL, que es lo que se pinta

    expect(formatResetTime(resetsAt)).toMatch(/15.04|03.04/); // 24 h o 12 h segun el locale del sistema
  });

  it('formatResetTime_valorNoFinito_lanzaConElValorRecibido', () => {
    expect(() => formatResetTime(Number.NaN)).toThrow(/NaN/);
  });
});

describe('severityForPct', () => {
  it('severity_below80_ok', () => expect(severityForPct(79)).toBe('ok'));
  it('severity_at80_warn', () => expect(severityForPct(80)).toBe('warn'));
  it('severity_at94_warn', () => expect(severityForPct(94)).toBe('warn'));
  it('severity_at95_critical', () => expect(severityForPct(95)).toBe('critical'));
  it('severity_at100_critical', () => expect(severityForPct(100)).toBe('critical'));
});

describe('toUsageWindows', () => {
  it('toWindows_mapsPctAndCountdown', () => {
    const { fiveHour, weekly } = toUsageWindows(usage(), NOW);

    expect(fiveHour).toEqual({ pct: 62, label: '1 h 24 m' });
    expect(weekly).toEqual({ pct: 31, label: '3 d 0 h' });
  });

  it('toWindows_resetInPast_showsAhora', () => {
    const { fiveHour } = toUsageWindows(usage({ fiveHour: { utilization: 10, resetsAt: NOW - 1 } }), NOW);
    expect(fiveHour.label).toBe('ahora');
  });

  it('toWindows_nullReset_showsDash', () => {
    const { fiveHour } = toUsageWindows(usage({ fiveHour: { utilization: 10, resetsAt: null } }), NOW);
    expect(fiveHour.label).toBe('—');
  });

  it('toWindows_underOneHour_showsMinutes', () => {
    const { fiveHour } = toUsageWindows(usage({ fiveHour: { utilization: 10, resetsAt: NOW + 24 * 60_000 } }), NOW);
    expect(fiveHour.label).toBe('24 m');
  });

  it('toWindows_pctOver100_clampedTo100', () => {
    const { fiveHour } = toUsageWindows(usage({ fiveHour: { utilization: 137, resetsAt: null } }), NOW);
    expect(fiveHour.pct).toBe(100);
  });
});

describe('perModelBars', () => {
  it('perModel_empty_returnsEmpty', () => {
    expect(perModelBars(usage())).toEqual([]);
  });

  it('perModel_onlyActive_areIncluded', () => {
    const info = usage({
      limits: [
        { kind: 'model', group: 'opus', percent: 40, severity: null, resetsAt: null, isActive: true },
        { kind: 'model', group: 'sonnet', percent: 96, severity: null, resetsAt: null, isActive: false },
      ],
    });

    const bars = perModelBars(info);

    expect(bars).toHaveLength(1);
    expect(bars[0]).toEqual({ label: 'opus', pct: 40, severity: 'ok' });
  });

  it('perModel_nullGroup_fallsBackToKind', () => {
    const info = usage({
      limits: [{ kind: 'overall', group: null, percent: 95, severity: null, resetsAt: null, isActive: true }],
    });

    expect(perModelBars(info)[0]).toEqual({ label: 'overall', pct: 95, severity: 'critical' });
  });
});

describe('formatApiCredits', () => {
  it('credits_zero_clarifiesNoApiBilling', () => {
    expect(formatApiCredits(0)).toBe('0.00 $ · no factura API');
  });

  it('credits_positive_showsAmount', () => {
    expect(formatApiCredits(1234)).toBe('12.34 $');
  });

  it('credits_null_showsDash', () => {
    expect(formatApiCredits(null)).toBe('—');
  });
});

// --- Proyeccion de agotamiento --------------------------------------------------------------------

describe('projectWindowExhaustion', () => {
  const NOW = 1_000_000_000_000;
  const H = 60 * 60 * 1000;

  it('project_ritmoQueAgotaAntesDelReset_devuelveElTiempoRestante', () => {
    // Ventana de 5h: han pasado 2h y se lleva el 50% -> 25%/h -> las otras 50 unidades en 2h,
    // que caen ANTES del reset (quedan 3h).
    const projection = projectWindowExhaustion(50, NOW + 3 * H, FIVE_HOUR_WINDOW_MS, NOW);

    expect(projection).toEqual({ kind: 'depleting', etaMs: 2 * H });
    expect(formatProjection(projection)).toBe('A este ritmo se agota en 2 h 0 m');
  });

  it('project_ritmoLento_noSeAgotaAntesDelReset', () => {
    // Han pasado 4h de 5 y solo se lleva el 10%: no llega a agotarse.
    const projection = projectWindowExhaustion(10, NOW + 1 * H, FIVE_HOUR_WINDOW_MS, NOW);

    expect(projection).toEqual({ kind: 'safe' });
    expect(formatProjection(projection)).toBe('A este ritmo no se agota antes del reset');
  });

  // El limite exacto cuenta como "no se agota": agotarse justo al resetear no es agotarse.
  it('project_agotamientoJustoEnElReset_cuentaComoSeguro', () => {
    const projection = projectWindowExhaustion(50, NOW + 2.5 * H, FIVE_HOUR_WINDOW_MS, NOW);

    expect(projection).toEqual({ kind: 'safe' });
  });

  it('project_ventanaYaAgotada_loDiceSinProyectar', () => {
    expect(projectWindowExhaustion(100, NOW + 1 * H, FIVE_HOUR_WINDOW_MS, NOW)).toEqual({ kind: 'exhausted' });
    expect(formatProjection({ kind: 'exhausted' })).toBe('Ventana agotada');
  });

  it('project_sinConsumo_esSeguro', () => {
    expect(projectWindowExhaustion(0, NOW + 1 * H, FIVE_HOUR_WINDOW_MS, NOW)).toEqual({ kind: 'safe' });
  });

  it('project_sinFechaDeReset_esDesconocido', () => {
    expect(projectWindowExhaustion(50, null, FIVE_HOUR_WINDOW_MS, NOW)).toEqual({ kind: 'unknown' });
    expect(formatProjection({ kind: 'unknown' })).toBeNull();
  });

  // Reloj incoherente: el reset ya paso, o esta mas lejos que la propia ventana. No se inventa ritmo.
  it('project_relojIncoherente_esDesconocido', () => {
    expect(projectWindowExhaustion(50, NOW - 1, FIVE_HOUR_WINDOW_MS, NOW)).toEqual({ kind: 'unknown' });
    expect(projectWindowExhaustion(50, NOW + 6 * H, FIVE_HOUR_WINDOW_MS, NOW)).toEqual({ kind: 'unknown' });
  });

  it('project_ventanaSemanal_usaSuPropiaDuracion', () => {
    const day = 24 * H;
    // 2 dias consumidos de 7, al 40% -> 20%/dia -> el 60% restante en 3 dias, antes del reset (5 dias).
    const projection = projectWindowExhaustion(40, NOW + 5 * day, SEVEN_DAY_WINDOW_MS, NOW);

    expect(projection).toEqual({ kind: 'depleting', etaMs: 3 * day });
    expect(formatProjection(projection)).toBe('A este ritmo se agota en 3 d 0 h');
  });

  it('project_valorNoFinito_esDesconocido', () => {
    expect(projectWindowExhaustion(Number.NaN, NOW + 1 * H, FIVE_HOUR_WINDOW_MS, NOW)).toEqual({ kind: 'unknown' });
  });
});

describe('formatResetAbsolute', () => {
  // Lunes 2026-09-28 10:00 hora local (los tests no dependen de la zona: todo es hora local).
  const MONDAY_10 = new Date(2026, 8, 28, 10, 0).getTime();

  it('formatResetAbsolute_null_guion', () => {
    expect(formatResetAbsolute(null, MONDAY_10, false)).toBe('—');
  });

  it('formatResetAbsolute_yaPasado_ya', () => {
    expect(formatResetAbsolute(MONDAY_10 - 1, MONDAY_10, false)).toBe('ya');
    expect(formatResetAbsolute(MONDAY_10, MONDAY_10, true)).toBe('ya');
  });

  it('formatResetAbsolute_mismoDia_soloHora', () => {
    expect(formatResetAbsolute(new Date(2026, 8, 28, 15, 5).getTime(), MONDAY_10, false)).toBe('15:05');
  });

  it('formatResetAbsolute_mismoDiaConDia_diaYHora', () => {
    expect(formatResetAbsolute(new Date(2026, 8, 28, 15, 5).getTime(), MONDAY_10, true)).toBe('lun 15:05');
  });

  it('formatResetAbsolute_otroDiaDeLaSemana_diaYHora', () => {
    expect(formatResetAbsolute(new Date(2026, 8, 30, 9, 0).getTime(), MONDAY_10, false)).toBe('mié 09:00');
  });

  it('formatResetAbsolute_masDeSeisDias_fecha', () => {
    expect(formatResetAbsolute(new Date(2026, 9, 5, 9, 0).getTime(), MONDAY_10, true)).toBe('05/10 09:00');
  });

  it('formatResetAbsolute_noFinito_lanza', () => {
    expect(() => formatResetAbsolute(Number.NaN, MONDAY_10, false)).toThrow(/NaN/);
  });
});
