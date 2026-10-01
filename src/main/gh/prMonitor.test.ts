import { describe, expect, it, vi } from 'vitest';
import { EMPTY_CHECK_SUMMARY, type GhCheckSummary, type GhPrState, type GhPrUpdate, type GhSnapshot } from '@shared/gh';
import { ciJustFinished, nextPollDelayMs, POLL_IDLE_MS, POLL_PENDING_MS, PrMonitor, type PrMonitorDeps } from './prMonitor';

function pr(state: GhPrState, summary: Partial<GhCheckSummary> = {}): GhSnapshot {
  const full = { ...EMPTY_CHECK_SUMMARY, ...summary };
  const checks = Object.values(full).some((n) => n > 0) ? [{ name: 'check', workflow: 'check', state: 'pass' as const, url: null, startedAt: null, completedAt: null }] : [];
  return {
    kind: 'pr',
    pr: { number: 1, title: 't', url: 'https://github.com/a/b/pull/1', state, isDraft: false, headRefName: 'f', headSha: 's', baseRefName: 'main', mergeable: 'mergeable', mergeStateStatus: 'CLEAN', reviewDecision: null, autoMerge: false, checks, summary: full },
  };
}

const PARAMS = { key: 'tab-1', cwd: '/r', accountDir: '/acc', number: 1 };

// Temporizadores falsos sin reloj: se ejecutan a mano y se ve con que retraso se programaron.
function harness(snapshots: GhSnapshot[]) {
  const timers: { fn: () => void; ms: number }[] = [];
  const updates: GhPrUpdate[] = [];
  const deps: PrMonitorDeps = {
    fetch: vi.fn(async () => snapshots.shift() ?? pr('open')),
    emit: (update) => updates.push(update),
    setTimer: (fn, ms) => timers.push({ fn, ms }),
    clearTimer: vi.fn(),
    onError: vi.fn(),
  };
  return { monitor: new PrMonitor(deps), deps, timers, updates };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('nextPollDelayMs', () => {
  it('nextPollDelayMs_pendientes60sReposo5minFusionadoPara', () => {
    expect(nextPollDelayMs(pr('open', { pending: 1 }))).toBe(POLL_PENDING_MS);
    expect(nextPollDelayMs(pr('open', { pass: 2 }))).toBe(POLL_IDLE_MS);
    expect(nextPollDelayMs(pr('merged'))).toBeNull();
    expect(nextPollDelayMs(pr('closed'))).toBeNull();
    expect(nextPollDelayMs({ kind: 'off', reason: 'error' })).toBe(POLL_IDLE_MS);
  });
});

describe('ciJustFinished', () => {
  it('ciJustFinished_dePendienteATerminado_true', () => {
    expect(ciJustFinished(pr('open', { pending: 1, pass: 1 }), pr('open', { pass: 1, fail: 1 }))).toBe(true);
  });

  it('ciJustFinished_primerSondeoOSinCambio_false', () => {
    expect(ciJustFinished(null, pr('open', { pass: 1 }))).toBe(false);
    expect(ciJustFinished(pr('open', { pass: 1 }), pr('open', { pass: 1 }))).toBe(false);
    expect(ciJustFinished(pr('open', { pending: 1 }), pr('open', { pending: 1 }))).toBe(false);
  });
});

describe('PrMonitor', () => {
  it('watch_sondeaYReprogramaSegunLosChecks', async () => {
    const { monitor, timers, updates } = harness([pr('open', { pending: 1 }), pr('open', { pass: 1 })]);

    monitor.watch(PARAMS);
    await flush();
    timers[0]!.fn();
    await flush();

    expect(timers.map((t) => t.ms)).toEqual([POLL_PENDING_MS, POLL_IDLE_MS]);
    expect(updates.map((u) => u.ciFinished)).toEqual([false, true]);
  });

  it('watch_prFusionado_dejaDeVigilar', async () => {
    const { monitor, timers, updates } = harness([pr('merged')]);

    monitor.watch(PARAMS);
    await flush();

    expect(updates).toHaveLength(1);
    expect(timers).toHaveLength(0);
  });

  it('watch_otraVezElMismo_sondeaYaSinDuplicar', async () => {
    const { monitor, deps, timers } = harness([]);

    monitor.watch(PARAMS);
    await flush();
    monitor.watch(PARAMS);
    await flush();

    expect(deps.fetch).toHaveBeenCalledTimes(2);
    expect(deps.clearTimer).toHaveBeenCalledTimes(1);
    expect(timers).toHaveLength(2);
  });

  it('unwatch_conLecturaEnVuelo_noEmiteNiReprograma', async () => {
    const { monitor, timers, updates } = harness([]);

    monitor.watch(PARAMS);
    monitor.unwatch(PARAMS.key);
    await flush();

    expect(updates).toHaveLength(0);
    expect(timers).toHaveLength(0);
  });

  it('watch_fetchLanza_registraYEmiteError', async () => {
    const { monitor, deps, updates } = harness([]);
    vi.mocked(deps.fetch).mockRejectedValueOnce(new Error('red'));

    monitor.watch(PARAMS);
    await flush();

    expect(deps.onError).toHaveBeenCalledTimes(1);
    expect(updates[0]?.snapshot).toEqual({ kind: 'off', reason: 'error' });
  });

  it('unwatchPrefix_soloLasDeEsaVentana', async () => {
    const { monitor, deps } = harness([]);
    monitor.watch({ ...PARAMS, key: '1:tab-1' });
    monitor.watch({ ...PARAMS, key: '2:tab-1' });
    await flush();

    monitor.unwatchPrefix('1:');
    monitor.watch({ ...PARAMS, key: '2:tab-1' });
    await flush();

    expect(deps.clearTimer).toHaveBeenCalledTimes(2);
    expect(deps.fetch).toHaveBeenCalledTimes(3);
  });
});
