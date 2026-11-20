import { describe, expect, it } from 'vitest';
import { formatClock, RESUME_DELAY_MS, resumePlan } from './resumePlan';

const NOW = Date.UTC(2026, 10, 19, 12, 0, 0);
const window = (utilization: number, resetsAt: number | null) => ({ utilization, resetsAt });

describe('resumePlan', () => {
  it('resumePlan_semanalAgotada_skip', () => {
    expect(resumePlan({ weekly: window(100, NOW + 1), fiveHour: window(100, NOW + 60_000), now: NOW })).toEqual({ kind: 'skip', reason: 'weekly' });
  });
  it('resumePlan_semanalPorEncimaDe100_skip', () => {
    expect(resumePlan({ weekly: window(130, null), fiveHour: window(100, NOW + 60_000), now: NOW })).toEqual({ kind: 'skip', reason: 'weekly' });
  });
  it('resumePlan_semanalAl99_noEsLaCausa', () => {
    expect(resumePlan({ weekly: window(99, null), fiveHour: window(100, NOW + 60_000), now: NOW }).kind).toBe('schedule');
  });
  it('resumePlan_sinReset_skip', () => {
    expect(resumePlan({ weekly: window(10, null), fiveHour: window(100, null), now: NOW })).toEqual({ kind: 'skip', reason: 'unknown_reset' });
  });
  it('resumePlan_sinVentanaDeCincoHoras_skip', () => {
    expect(resumePlan({ weekly: null, fiveHour: null, now: NOW })).toEqual({ kind: 'skip', reason: 'unknown_reset' });
  });
  it('resumePlan_resetNoFinito_skip', () => {
    expect(resumePlan({ weekly: null, fiveHour: window(100, Number.NaN), now: NOW })).toEqual({ kind: 'skip', reason: 'unknown_reset' });
  });
  it('resumePlan_resetFuturo_resetMasDosMinutos', () => {
    const resetsAt = NOW + 90 * 60_000;
    expect(resumePlan({ weekly: window(5, null), fiveHour: window(100, resetsAt), now: NOW })).toEqual({ kind: 'schedule', atMs: resetsAt + RESUME_DELAY_MS });
  });
  it('resumePlan_resetPasado_ahoraMasDosMinutos', () => {
    expect(resumePlan({ weekly: null, fiveHour: window(100, NOW - 5_000), now: NOW })).toEqual({ kind: 'schedule', atMs: NOW + RESUME_DELAY_MS });
  });
  it('resumePlan_resetJustoAhora_ahoraMasDosMinutos', () => {
    expect(resumePlan({ weekly: null, fiveHour: window(100, NOW), now: NOW })).toEqual({ kind: 'schedule', atMs: NOW + RESUME_DELAY_MS });
  });
  it('resumePlan_margenDeDosMinutos', () => {
    expect(RESUME_DELAY_MS).toBe(120_000);
  });
  it('resumePlan_nowNoFinito_lanza', () => {
    expect(() => resumePlan({ weekly: null, fiveHour: null, now: Number.NaN })).toThrow('NaN');
  });
});

describe('formatClock', () => {
  it('formatClock_horaLocal_hhmmConCeros', () => {
    expect(formatClock(new Date(2026, 10, 19, 15, 2).getTime())).toBe('15:02');
    expect(formatClock(new Date(2026, 10, 19, 4, 7).getTime())).toBe('04:07');
  });
  it('formatClock_medianoche_0000', () => {
    expect(formatClock(new Date(2026, 10, 19, 0, 0).getTime())).toBe('00:00');
  });
  it('formatClock_instanteInvalido_lanzaConElValor', () => {
    expect(() => formatClock(Number.NaN)).toThrow('NaN');
  });
});
