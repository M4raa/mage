import { describe, expect, it } from 'vitest';
import { nextRunAt, type TaskSchedule } from '@shared/taskSchedule';
import type { TaskRecord } from '@shared/tasks';
import { failedRun, hasActiveSchedule, isDue, LATE_RUN_GRACE_MS, startedRun } from './taskRuns';

const DAILY: TaskSchedule = { kind: 'daily', time: { hour: 9, minute: 0 }, timeZone: 'Europe/Madrid' };
const NOW = Date.parse('2026-06-10T12:00:00Z');
const DAY = 24 * 60 * 60_000;

function task(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1', name: 'n', schedule: DAILY, enabled: true, nextRunAtMs: NOW - 1000, lastRun: null,
    goal: 'g', language: 'es', provider: 'claude', accountDir: '/a', folders: ['/w'], documents: [], capabilities: [],
    createdAtMs: 1, sessionId: 's', conversationId: 'c', verifiedAtMs: 5, verdict: 'verified',
    deliverables: [{ declared: 'a.md', path: '/w/a.md', status: 'ok', bytes: 1, modifiedAtMs: 1, kind: 'md' }],
    ...over,
  };
}

describe('isDue', () => {
  it('isDue_pendienteActivada_true', () => {
    expect(isDue(task(), NOW)).toBe(true);
  });
  it('isDue_desactivada_false', () => {
    expect(isDue(task({ enabled: false }), NOW)).toBe(false);
  });
  it('isDue_sinProgramacion_false', () => {
    expect(isDue(task({ schedule: null }), NOW)).toBe(false);
  });
  it('isDue_futura_false', () => {
    expect(isDue(task({ nextRunAtMs: NOW + 1 }), NOW)).toBe(false);
  });
});

describe('startedRun', () => {
  it('startedRun_diariaPerdidaTresDias_unaSolaYLaSiguienteEnElFuturo', () => {
    const missed = task({ nextRunAtMs: NOW - 3 * DAY });

    const started = startedRun(missed, NOW, missed.nextRunAtMs);

    expect(started.nextRunAtMs).toBe(nextRunAt(DAILY, NOW));
    expect(started.nextRunAtMs).toBeGreaterThan(NOW);
  });
  it('startedRun_dentroDelMargen_noEsTarde', () => {
    const started = startedRun(task(), NOW, NOW - LATE_RUN_GRACE_MS);

    expect(started.lastRun?.late).toBe(false);
  });
  it('startedRun_fueraDelMargen_esTarde', () => {
    const started = startedRun(task(), NOW, NOW - LATE_RUN_GRACE_MS - 1);

    expect(started.lastRun).toEqual({ atMs: NOW, scheduledForMs: NOW - LATE_RUN_GRACE_MS - 1, late: true, outcome: 'started', error: null });
  });
  it('startedRun_unaVezPerdida_sinSiguiente', () => {
    const once: TaskSchedule = { kind: 'once', date: '2026-06-09', time: { hour: 9, minute: 0 }, timeZone: 'Europe/Madrid' };

    const started = startedRun(task({ schedule: once }), NOW, NOW - DAY);

    expect(started.nextRunAtMs).toBeNull();
  });
  it('startedRun_aMano_noMueveLaSiguiente', () => {
    const started = startedRun(task({ nextRunAtMs: NOW + DAY }), NOW, null);

    expect(started.nextRunAtMs).toBe(NOW + DAY);
    expect(started.lastRun).toMatchObject({ scheduledForMs: null, late: false });
  });
  it('startedRun_reiniciaSesionYEntregables', () => {
    const started = startedRun(task(), NOW, NOW);

    expect(started).toMatchObject({ sessionId: null, conversationId: null, deliverables: [], verifiedAtMs: null, verdict: 'pending' });
  });
});

describe('failedRun', () => {
  it('failedRun_conEjecucionPrevia_marcaFalloYCorta', () => {
    const previous = { atMs: 7, scheduledForMs: 5, late: true, outcome: 'started' as const, error: null };

    const failed = failedRun(task({ lastRun: previous }), NOW, 'x'.repeat(600));

    expect(failed.lastRun).toMatchObject({ atMs: 7, scheduledForMs: 5, late: true, outcome: 'failed' });
    expect(failed.lastRun?.error).toHaveLength(500);
  });
  it('failedRun_sinEjecucionPrevia_creaUna', () => {
    const failed = failedRun(task(), NOW, 'boom');

    expect(failed.lastRun).toEqual({ atMs: NOW, scheduledForMs: null, late: false, outcome: 'failed', error: 'boom' });
  });
});

describe('hasActiveSchedule', () => {
  it('hasActiveSchedule_soloDesactivadas_false', () => {
    expect(hasActiveSchedule([task({ enabled: false }), task({ nextRunAtMs: null })])).toBe(false);
  });
  it('hasActiveSchedule_unaActiva_true', () => {
    expect(hasActiveSchedule([task({ enabled: false }), task()])).toBe(true);
  });
});
