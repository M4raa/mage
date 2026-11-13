import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@shared/i18n/localizedText';
import type { TaskSchedule } from '@shared/taskSchedule';
import type { TaskDraft, TaskRecord } from '@shared/tasks';
import { TaskService, type TaskServiceDeps } from './taskService';

const WORK = resolve('/work');
const EXTRA = resolve('/extra');
const ACCOUNT = resolve('/acc/claude');

const MADRID = 'Europe/Madrid';
const T0 = Date.parse('2026-06-10T06:00:00Z');
const DAILY_9: TaskSchedule = { kind: 'daily', time: { hour: 9, minute: 0 }, timeZone: MADRID };
const NEXT_DAILY_9 = Date.parse('2026-06-10T07:00:00Z');

const draft = (over: Partial<TaskDraft> = {}): TaskDraft => ({
  name: 'Informe', schedule: null,
  goal: ' Haz el informe ', language: 'es', provider: 'claude', accountDir: ACCOUNT, folders: [WORK, EXTRA], documents: [], capabilities: [], ...over,
});

function setup(over: Partial<TaskServiceDeps> = {}, initial: TaskRecord[] = [], startMs = T0) {
  let clock = startMs;
  let counter = 0;
  const save = vi.fn();
  const deps: TaskServiceDeps = {
    load: () => initial,
    save,
    now: () => clock,
    newId: () => `t${++counter}`,
    listAccounts: () => [{ provider: 'claude', configDir: ACCOUNT }, { provider: 'codex', configDir: resolve('/acc/codex') }],
    isDirectory: () => true,
    isFile: () => true,
    deliverableFs: { stat: () => ({ isFile: true, size: 5, mtimeMs: 7 }), canRead: () => true },
    caseInsensitive: false,
    nativeIdOf: () => null,
    ...over,
  };
  return { service: new TaskService(deps), save, advance: (ms: number) => void (clock += ms) };
}

function userFacing(fn: () => unknown): UserFacingError {
  try {
    fn();
  } catch (err) {
    if (err instanceof UserFacingError) return err;
    throw err;
  }
  throw new Error('no lanzó');
}

const errorKey = (fn: () => unknown): string => userFacing(fn).localized.key;

describe('TaskService.create', () => {
  it('create_valido_persiste', () => {
    const { service, save } = setup();

    const task = service.create(draft());

    expect(task).toMatchObject({ id: 't1', goal: 'Haz el informe', verdict: 'pending', sessionId: null, conversationId: null, deliverables: [], verifiedAtMs: null });
    expect(save).toHaveBeenCalledWith([task]);
  });

  it('create_objetivoVacio_errorGoalEmpty', () => {
    const { service } = setup();

    expect(errorKey(() => service.create(draft({ goal: '   ' })))).toBe('errors.tasks.goalEmpty');
  });

  it('create_cuentaDeOtroProveedor_errorUnknownAccount', () => {
    const { service } = setup();

    expect(errorKey(() => service.create(draft({ provider: 'codex' })))).toBe('errors.tasks.unknownAccount');
  });

  it('create_carpetaRelativa_errorNotAbsolute', () => {
    const { service } = setup();

    expect(errorKey(() => service.create(draft({ folders: ['relativa'] })))).toBe('errors.tasks.notAbsolute');
  });

  it('create_carpetaInexistente_errorFolderMissing', () => {
    const { service } = setup({ isDirectory: () => false });

    expect(errorKey(() => service.create(draft()))).toBe('errors.tasks.folderMissing');
  });

  it('create_duplicadasMayusculas_seQuitan', () => {
    const { service } = setup({ caseInsensitive: true });

    const task = service.create(draft({ folders: [WORK, WORK.toUpperCase()], documents: [resolve('/d/a.pdf'), resolve('/D/A.PDF')] }));

    expect(task.folders).toEqual([WORK]);
    expect(task.documents).toEqual([resolve('/d/a.pdf')]);
  });
});

describe('TaskService programación', () => {
  const dueTask = (id: string, nextRunAtMs: number | null, over: Partial<TaskRecord> = {}): TaskRecord => ({
    ...draft({ name: id, schedule: DAILY_9, goal: 'g', folders: [WORK] }),
    id, enabled: true, nextRunAtMs, lastRun: null, createdAtMs: 1, sessionId: 's', conversationId: 'c',
    deliverables: [], verifiedAtMs: null, verdict: 'pending', ...over,
  });

  it('create_sinNombre_errorNombre', () => {
    const { service } = setup();

    expect(errorKey(() => service.create(draft({ name: '  ' })))).toBe('errors.tasks.nameEmpty');
  });

  it('create_nombreLargo_errorNombre', () => {
    const { service } = setup();

    expect(errorKey(() => service.create(draft({ name: 'x'.repeat(81) })))).toBe('errors.tasks.nameTooLong');
  });

  it('create_unaVezPasada_errorFecha', () => {
    const { service } = setup();
    const past: TaskSchedule = { kind: 'once', date: '2026-06-09', time: { hour: 9, minute: 0 }, timeZone: MADRID };

    expect(errorKey(() => service.create(draft({ schedule: past })))).toBe('errors.tasks.scheduleInPast');
  });

  it('create_programada_calculaLaSiguiente', () => {
    const { service } = setup();

    const task = service.create(draft({ schedule: DAILY_9 }));

    expect(task).toMatchObject({ enabled: true, nextRunAtMs: NEXT_DAILY_9, lastRun: null });
  });

  it('edit_cambiaProgramacion_recalculaYConservaLaSesion', () => {
    const { service } = setup();
    service.create(draft({ schedule: DAILY_9 }));
    service.bindSession('t1', 's1', 'claude');
    const weekly: TaskSchedule = { kind: 'weekly', weekday: 3, time: { hour: 10, minute: 0 }, timeZone: MADRID };

    const edited = service.edit('t1', draft({ name: 'Nuevo', schedule: weekly }));

    expect(edited).toMatchObject({ id: 't1', name: 'Nuevo', sessionId: 's1', nextRunAtMs: Date.parse('2026-06-10T08:00:00Z') });
  });

  it('setEnabled_false_sinSiguiente', () => {
    const { service } = setup();
    service.create(draft({ schedule: DAILY_9 }));

    expect(service.setEnabled('t1', false)).toMatchObject({ enabled: false, nextRunAtMs: null });
  });

  it('setEnabled_true_recalculaDesdeAhora', () => {
    const { service, advance } = setup();
    service.create(draft({ schedule: DAILY_9 }));
    service.setEnabled('t1', false);
    advance(2 * 60 * 60_000);

    const task = service.setEnabled('t1', true);

    expect(task.nextRunAtMs).toBe(Date.parse('2026-06-11T07:00:00Z'));
  });

  it('takeDue_dosPendientesYUnaFutura_devuelveDosYGuardaUnaVez', () => {
    const initial = [dueTask('b', T0 - 10), dueTask('a', T0 - 20), dueTask('c', T0 + 5000)];
    const { service, save } = setup({}, initial);

    const taken = service.takeDue();

    expect(taken.map((t) => t.id)).toEqual(['a', 'b']);
    expect(taken.every((t) => t.nextRunAtMs === NEXT_DAILY_9 && t.lastRun?.outcome === 'started')).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('takeDue_segundaLlamada_vacia', () => {
    const { service, save } = setup({}, [dueTask('a', T0 - 10)]);
    service.takeDue();
    save.mockClear();

    expect(service.takeDue()).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it('runNow_noMueveLaSiguiente', () => {
    const { service } = setup({}, [dueTask('a', NEXT_DAILY_9)]);

    const task = service.runNow('a');

    expect(task.nextRunAtMs).toBe(NEXT_DAILY_9);
    expect(task.lastRun).toMatchObject({ scheduledForMs: null, outcome: 'started' });
  });

  it('reportRunFailed_guardaElError', () => {
    const { service } = setup({}, [dueTask('a', NEXT_DAILY_9)]);

    expect(service.reportRunFailed('a', 'boom').lastRun).toMatchObject({ outcome: 'failed', error: 'boom' });
  });

  it('hasDue_sinPendientes_false', () => {
    const { service } = setup({}, [dueTask('a', NEXT_DAILY_9)]);

    expect(service.hasDue()).toBe(false);
  });
});

describe('TaskService.claimForLaunch', () => {
  it('claimForLaunch_taskIdCoincide_laDevuelve', () => {
    const { service } = setup();
    service.create(draft());

    expect(service.claimForLaunch({ provider: 'claude', accountDir: ACCOUNT, cwd: WORK, taskId: 't1' })?.id).toBe('t1');
  });

  it('claimForLaunch_taskIdConOtroCwd_laDevuelve', () => {
    const { service } = setup();
    service.create(draft());

    expect(service.claimForLaunch({ provider: 'claude', accountDir: ACCOUNT, cwd: EXTRA, taskId: 't1' })?.id).toBe('t1');
  });

  it('claimForLaunch_sinTaskId_null', () => {
    const { service } = setup();
    service.create(draft());

    expect(service.claimForLaunch({ provider: 'claude', accountDir: ACCOUNT, cwd: WORK })).toBeNull();
  });

  it('claimForLaunch_taskIdDesconocido_errorUnknownTask', () => {
    const { service } = setup();
    service.create(draft());

    const err = userFacing(() => service.claimForLaunch({ provider: 'claude', accountDir: ACCOUNT, cwd: WORK, taskId: 'nope' }));

    expect(err.localized.key).toBe('errors.tasks.unknownTask');
    expect(err.localized.values).toEqual({ taskId: 'nope' });
  });

  it('claimForLaunch_taskIdDeOtraCuenta_lanzaConLosValores', () => {
    const { service } = setup();
    service.create(draft());
    const other = resolve('/acc/otra');

    expect(() => service.claimForLaunch({ provider: 'claude', accountDir: other, cwd: WORK, taskId: 't1' })).toThrow(JSON.stringify(other).slice(1, -1));
  });

  it('claimForLaunch_taskIdDeOtroProveedor_lanza', () => {
    const { service } = setup();
    service.create(draft());

    expect(() => service.claimForLaunch({ provider: 'codex', accountDir: ACCOUNT, cwd: WORK, taskId: 't1' })).toThrow('codex');
  });

  it('claimForLaunch_taskIdVacio_lanza', () => {
    const { service } = setup();

    expect(() => service.claimForLaunch({ provider: 'claude', accountDir: ACCOUNT, cwd: WORK, taskId: '' })).toThrow('""');
  });

  it('claimForLaunch_resume_porConversationId', () => {
    const { service } = setup();
    service.create(draft());
    service.bindSession('t1', 'native-1', 'claude');

    const claimed = service.claimForLaunch({ provider: 'claude', accountDir: ACCOUNT, cwd: WORK, resumeSessionId: 'native-1' });

    expect(claimed?.id).toBe('t1');
    expect(service.claimForLaunch({ provider: 'claude', accountDir: ACCOUNT, cwd: WORK, resumeSessionId: 'otra' })).toBeNull();
  });
});

describe('TaskService.bindSession y list', () => {
  it('bindSession_claude_fijaConversationId', () => {
    const { service } = setup();
    service.create(draft());

    expect(service.bindSession('t1', 's1', 'claude')).toMatchObject({ sessionId: 's1', conversationId: 's1' });
  });

  it('bindSession_codex_dejaConversationIdNull', () => {
    const { service } = setup();
    service.create(draft());

    expect(service.bindSession('t1', 's1', 'codex')).toMatchObject({ sessionId: 's1', conversationId: null });
  });

  it('bindSession_idDesconocido_errorUnknownTask', () => {
    const { service } = setup();

    expect(errorKey(() => service.bindSession('nope', 's', 'claude'))).toBe('errors.tasks.unknownTask');
  });

  it('list_codexConNativo_rellenaConversationIdYPersisteUnaVez', () => {
    const { service, save } = setup({ nativeIdOf: (id) => (id === 's1' ? 'thread-9' : null) });
    service.create(draft({ provider: 'claude' }));
    service.bindSession('t1', 's1', 'codex');
    save.mockClear();

    expect(service.list()[0]?.conversationId).toBe('thread-9');
    expect(service.list()[0]?.conversationId).toBe('thread-9');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('list_variasTareas_masRecientePrimero', () => {
    const { service, advance } = setup();
    service.create(draft());
    advance(10);
    service.create(draft());

    expect(service.list().map((t) => t.id)).toEqual(['t2', 't1']);
  });
});

describe('TaskService.verify, remove y launchExtrasFor', () => {
  it('verify_guardaChecksYVeredicto', () => {
    const { service } = setup();
    service.create(draft());

    const task = service.verify('t1', ['report.md']);

    expect(task.verdict).toBe('verified');
    expect(task.verifiedAtMs).toBe(T0);
    expect(task.deliverables).toHaveLength(1);
    expect(task.deliverables[0]).toMatchObject({ status: 'ok', path: resolve(WORK, 'report.md') });
  });

  it('remove_quita', () => {
    const { service } = setup();
    service.create(draft());

    service.remove('t1');

    expect(service.list()).toEqual([]);
  });

  it('launchExtrasFor_quitaElCwd', () => {
    const { service } = setup();
    const task = service.create(draft());

    expect(service.launchExtrasFor(task, WORK)).toEqual([EXTRA]);
  });
});
