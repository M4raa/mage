import { describe, expect, it } from 'vitest';
import type { UsageInfo } from '@shared/usage';
import { failedUsageEntry, MAX_USAGE_ERROR_CHARS, usageEntryOf, usageWindowOf } from './accountUsage';
import type { UsageAccount } from './accountUsage';

const RESET_MS = Date.UTC(2026, 10, 19, 15, 0, 0);
const claude: UsageAccount = { id: '/h/.claude', provider: 'claude', name: '.claude', billing: 'subscription' };
const usage = (fiveHour: number, sevenDay: number): UsageInfo => ({
  fiveHour: { utilization: fiveHour, resetsAt: RESET_MS }, sevenDay: { utilization: sevenDay, resetsAt: null }, limits: [], apiCreditsMinor: null, fetchedAt: 0,
});

describe('usageWindowOf', () => {
  it('usageWindowOf_fraccion_redondeaAEntero', () => {
    expect(usageWindowOf({ utilization: 36.6, resetsAt: null })).toEqual({ percent: 37, resetsAt: null });
  });
  it('usageWindowOf_resetEnEpochMs_isoUtc', () => {
    expect(usageWindowOf({ utilization: 10, resetsAt: RESET_MS })?.resetsAt).toBe('2026-11-19T15:00:00.000Z');
  });
  it.each([[-5, 0], [0, 0], [100, 100], [180, 100]])('usageWindowOf_%d_acotaA%d', (utilization, expected) => {
    expect(usageWindowOf({ utilization, resetsAt: null })?.percent).toBe(expected);
  });
  it.each([[Number.NaN], [Number.POSITIVE_INFINITY]])('usageWindowOf_porcentajeNoFinito_null', (utilization) => {
    expect(usageWindowOf({ utilization, resetsAt: RESET_MS })).toBeNull();
  });
  it('usageWindowOf_resetNoFinito_resetNull', () => {
    expect(usageWindowOf({ utilization: 10, resetsAt: Number.NaN })).toEqual({ percent: 10, resetsAt: null });
  });
  it('usageWindowOf_resetFueraDeRangoDeFecha_resetNull', () => {
    expect(usageWindowOf({ utilization: 10, resetsAt: 9e15 })).toEqual({ percent: 10, resetsAt: null });
  });
  it('usageWindowOf_sinVentana_null', () => {
    expect(usageWindowOf(undefined)).toBeNull();
  });
});

describe('usageEntryOf', () => {
  it('usageEntryOf_suscripcionDeClaude_ambasVentanas', () => {
    expect(usageEntryOf(claude, usage(42.4, 7))).toEqual({
      accountId: '/h/.claude', provider: 'claude', name: '.claude', billing: 'subscription',
      fiveHour: { percent: 42, resetsAt: '2026-11-19T15:00:00.000Z' }, weekly: { percent: 7, resetsAt: null },
    });
  });
  it('usageEntryOf_suscripcionDeCodex_ambasVentanas', () => {
    expect(usageEntryOf({ ...claude, provider: 'codex' }, usage(1, 2))).toMatchObject({ fiveHour: { percent: 1 }, weekly: { percent: 2 } });
  });
  it('usageEntryOf_cuentaDeApi_ventanasNull', () => {
    expect(usageEntryOf({ ...claude, billing: 'api-key' }, usage(0, 0))).toMatchObject({ billing: 'api-key', fiveHour: null, weekly: null });
  });
  it('usageEntryOf_agy_ventanasNull', () => {
    expect(usageEntryOf({ ...claude, provider: 'agy' }, usage(50, 50))).toMatchObject({ provider: 'agy', fiveHour: null, weekly: null });
  });
  it('usageEntryOf_sinUsoLeido_ventanasNull', () => {
    expect(usageEntryOf(claude, null)).toMatchObject({ fiveHour: null, weekly: null });
  });
});

describe('failedUsageEntry', () => {
  it('failedUsageEntry_error_ensenaElMotivoYNoTraeVentanas', () => {
    expect(failedUsageEntry(claude, new Error('HTTP 401'))).toMatchObject({ accountId: '/h/.claude', fiveHour: null, weekly: null, error: 'usage_unavailable: HTTP 401' });
  });
  it('failedUsageEntry_motivoLargo_seAcota', () => {
    expect(failedUsageEntry(claude, 'x'.repeat(1000)).error).toHaveLength(MAX_USAGE_ERROR_CHARS);
  });
});
