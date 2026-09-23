import { describe, expect, it } from 'vitest';
import { parseEpochMs, toUsageInfo, UsageResponseSchema } from './schemas';

// `parseEpochMs` no tenia test directo y tiene DOS consumidores: el panel de Uso y el timestamp de
// CADA linea de transcripcion (transcripts/normalize.ts). Es parseo en la frontera: lo que entra viene
// de un endpoint que no controlamos, y un fallo silencioso aqui hace desaparecer el reloj de reset sin
// que nadie se entere de por que.

describe('parseEpochMs', () => {
  it('parseEpochMs_iso_devuelveEpochMs', () => {
    expect(parseEpochMs('2026-09-03T10:00:00.000Z')).toBe(Date.parse('2026-09-03T10:00:00.000Z'));
  });

  it('parseEpochMs_epochEnSegundos_loEscalaAMilisegundos', () => {
    // 1.760.000.000 s = octubre de 2025. Por debajo del techo, asi que se interpreta en segundos.
    expect(parseEpochMs(1_760_000_000)).toBe(1_760_000_000_000);
  });

  it('parseEpochMs_epochEnMilisegundos_loDejaIgual', () => {
    expect(parseEpochMs(1_760_000_000_000)).toBe(1_760_000_000_000);
  });

  it('parseEpochMs_stringNumerico_devuelveNull', () => {
    // CASO REAL del informe: si el endpoint manda "1760000000" como CADENA, `Date.parse` no lo entiende
    // y el reloj de reset desaparece EN SILENCIO. Queda documentado: hoy devuelve null a proposito
    // (mejor sin dato que con uno inventado), pero si el endpoint cambiara a esta forma, este test es
    // el que lo cuenta.
    expect(parseEpochMs('1760000000')).toBeNull();
  });

  it('parseEpochMs_cero_devuelveCero', () => {
    // 0 es un valor legitimo del tipo, no "ausente": se escala como segundos y sale 0 (epoch).
    expect(parseEpochMs(0)).toBe(0);
  });

  it('parseEpochMs_negativo_seRespeta', () => {
    expect(parseEpochMs(-1)).toBe(-1000);
  });

  it('parseEpochMs_noFinito_devuelveNull', () => {
    expect(parseEpochMs(Number.NaN)).toBeNull();
    expect(parseEpochMs(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('parseEpochMs_ausenteONulo_devuelveNull', () => {
    expect(parseEpochMs(null)).toBeNull();
    expect(parseEpochMs(undefined)).toBeNull();
  });

  it('parseEpochMs_textoQueNoEsFecha_devuelveNull', () => {
    expect(parseEpochMs('manana por la tarde')).toBeNull();
  });
});

describe('toUsageInfo', () => {
  const FETCHED_AT = 1_700_000_000_000;

  it('toUsageInfo_respuestaCompleta_mapeaVentanasYLimites', () => {
    const raw = UsageResponseSchema.parse({
      five_hour: { utilization: 42, resets_at: '2026-09-03T15:00:00.000Z' },
      seven_day: { utilization: 7, resets_at: 1_760_000_000 },
      limits: [],
      spend: { used: { amount_minor: 1234 } },
    });

    const info = toUsageInfo(raw, FETCHED_AT);

    expect(info.fiveHour.utilization).toBe(42);
    expect(info.fiveHour.resetsAt).toBe(Date.parse('2026-09-03T15:00:00.000Z'));
    expect(info.sevenDay.resetsAt).toBe(1_760_000_000_000);
    expect(info.apiCreditsMinor).toBe(1234);
    expect(info.fetchedAt).toBe(FETCHED_AT);
  });

  it('toUsageInfo_respuestaVacia_rellenaDefaultsSeguros', () => {
    // El endpoint puede no traer una ventana: eso es 0 % y sin reloj, no un crash ni un NaN.
    const info = toUsageInfo(UsageResponseSchema.parse({}), FETCHED_AT);

    expect(info.fiveHour).toEqual({ utilization: 0, resetsAt: null });
    expect(info.sevenDay).toEqual({ utilization: 0, resetsAt: null });
    expect(info.limits).toEqual([]);
    expect(info.apiCreditsMinor).toBeNull();
  });

  it('toUsageInfo_limitsNulo_devuelveListaVacia', () => {
    const info = toUsageInfo(UsageResponseSchema.parse({ limits: null }), FETCHED_AT);

    expect(info.limits).toEqual([]);
  });

  it('toUsageInfo_gastoAusente_dejaLosCreditosEnNull', () => {
    // Dinero: null significa "no se sabe", que NO es lo mismo que 0 y no se puede pintar como 0.
    const info = toUsageInfo(UsageResponseSchema.parse({ spend: {} }), FETCHED_AT);

    expect(info.apiCreditsMinor).toBeNull();
  });
});
