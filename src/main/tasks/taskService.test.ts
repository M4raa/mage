import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@shared/i18n/localizedText';
import type { TaskDraft, TaskRecord } from '@shared/tasks';
import { TaskService, type TaskServiceDeps } from './taskService';

const WORK = resolve('/work');
const EXTRA = resolve('/extra');
const ACCOUNT = resolve('/acc/claude');

const draft = (over: Partial<TaskDraft> = {}): TaskDraft => ({
  goal: ' Haz el informe ', language: 'es', provider: 'claude', accountDir: ACCOUNT, folders: [WORK, EXTRA], documents: [], capabilities: [], ...over,
});

function setup(over: Partial<TaskServiceDeps> = {}, initial: TaskRecord[] = []) {
  let clock = 1000;
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
    expect(task.verifiedAtMs).toBe(1000);
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
