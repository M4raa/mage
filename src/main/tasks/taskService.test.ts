import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@shared/i18n/localizedText';
import type { TaskDraft, TaskRecord } from '@shared/tasks';
import { TASK_ARM_TTL_MS, TaskService, type TaskServiceDeps } from './taskService';

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

function errorKey(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof UserFacingError) return err.localized.key;
    throw err;
  }
  throw new Error('no lanzó');
}

describe('TaskService.create', () => {
  it('create_valido_persisteYArma', () => {
    const { service, save } = setup();

    const task = service.create(draft());

    expect(task).toMatchObject({ id: 't1', goal: 'Haz el informe', verdict: 'pending', sessionId: null, conversationId: null, deliverables: [], verifiedAtMs: null });
    expect(save).toHaveBeenCalledWith([task]);
    expect(service.claimForLaunch({ provider: 'claude', accountDir: ACCOUNT, cwd: WORK })?.id).toBe('t1');
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
  it('claimForLaunch_armadaCoincide_laDevuelveYDesarma', () => {
    const { service } = setup();
    service.create(draft());
    const launch = { provider: 'claude', accountDir: ACCOUNT, cwd: WORK };

    expect(service.claimForLaunch(launch)?.id).toBe('t1');
    expect(service.claimForLaunch(launch)).toBeNull();
  });

  it('claimForLaunch_caducada_null', () => {
    const { service, advance } = setup();
    service.create(draft());
    advance(TASK_ARM_TTL_MS + 1);

    expect(service.claimForLaunch({ provider: 'claude', accountDir: ACCOUNT, cwd: WORK })).toBeNull();
  });

  it('claimForLaunch_otroCwd_null', () => {
    const { service } = setup();
    service.create(draft());

    expect(service.claimForLaunch({ provider: 'claude', accountDir: ACCOUNT, cwd: EXTRA })).toBeNull();
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

  it('remove_quitaYDesarma', () => {
    const { service } = setup();
    service.create(draft());

    service.remove('t1');

    expect(service.list()).toEqual([]);
    expect(service.claimForLaunch({ provider: 'claude', accountDir: ACCOUNT, cwd: WORK })).toBeNull();
  });

  it('launchExtrasFor_quitaElCwd', () => {
    const { service } = setup();
    const task = service.create(draft());

    expect(service.launchExtrasFor(task, WORK)).toEqual([EXTRA]);
  });
});
