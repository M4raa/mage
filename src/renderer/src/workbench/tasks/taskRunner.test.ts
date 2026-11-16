import { describe, expect, it, vi } from 'vitest';
import type { TaskDraft, TaskRecord } from '@shared/tasks';
import { saveTaskForm, startScheduledRuns, type ScheduledRunsDeps } from './taskRunner';

const task = (id: string): TaskRecord => ({ id } as TaskRecord);
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(batches: readonly (readonly TaskRecord[])[], over: Partial<ScheduledRunsDeps> = {}) {
  const log: string[] = [];
  const queue = [...batches];
  let fire: () => void = () => undefined;
  const deps: ScheduledRunsDeps = {
    takeDue: async () => queue.shift() ?? [],
    launch: async (t) => { log.push(`launch:${t.id}`); return 'tab'; },
    reportFailed: async (id, error) => { log.push(`failed:${id}:${error}`); },
    reload: async () => { log.push('reload'); },
    onDue: (listener) => { fire = listener; return () => undefined; },
    reportError: () => { log.push('reportError'); },
    describe: (err) => String(err),
    ...over,
  };
  return { deps, log, fire: () => fire() };
}

describe('startScheduledRuns', () => {
  it('startScheduledRuns_alArrancar_lanzaLasPendientes', async () => {
    const { deps, log } = setup([[task('a')]]);

    startScheduledRuns(deps);
    await flush();

    expect(log).toEqual(['launch:a', 'reload']);
  });

  it('startScheduledRuns_dosAvisos_lanzaEnSerieYEnOrden', async () => {
    const { deps, log, fire } = setup([[], [task('a'), task('b')], [task('c')]], {
      launch: async (t) => { log.push(`start:${t.id}`); await flush(); log.push(`end:${t.id}`); return 'tab'; },
    });

    startScheduledRuns(deps);
    fire();
    fire();

    await vi.waitFor(() => expect(log.filter((line) => line !== 'reload')).toEqual(['start:a', 'end:a', 'start:b', 'end:b', 'start:c', 'end:c']));
  });

  it('startScheduledRuns_unaFalla_laRegistraYSigue', async () => {
    const { deps, log } = setup([[task('a'), task('b')]], {
      launch: async (t) => { if (t.id === 'a') throw new Error('boom'); log.push(`launch:${t.id}`); return 'tab'; },
    });

    startScheduledRuns(deps);
    await flush();

    expect(log).toEqual(['failed:a:Error: boom', 'reportError', 'launch:b', 'reload']);
  });

  it('startScheduledRuns_sinPendientes_noRecarga', async () => {
    const reload = vi.fn(async () => undefined);
    const { deps } = setup([[]], { reload });

    startScheduledRuns(deps);
    await flush();

    expect(reload).not.toHaveBeenCalled();
  });
});

describe('saveTaskForm', () => {
  const draft = (schedule: TaskDraft['schedule']): TaskDraft => ({ name: 'n', schedule, goal: 'g', language: 'es', provider: 'claude', accountDir: '/a', folders: ['/f'], documents: [], capabilities: [] });
  const daily: TaskDraft['schedule'] = { kind: 'daily', time: { hour: 9, minute: 0 }, timeZone: 'Europe/Madrid' };
  const deps = () => ({ edit: vi.fn(async () => undefined), create: vi.fn(async () => undefined), start: vi.fn(async () => undefined) });

  it('saveTaskForm_editando_edita', async () => {
    const d = deps();

    await expect(saveTaskForm({ editingId: 't1', draft: draft(daily) }, d)).resolves.toBe('saved');

    expect(d.edit).toHaveBeenCalledOnce();
    expect(d.create).not.toHaveBeenCalled();
  });

  it('saveTaskForm_programada_soloCrea', async () => {
    const d = deps();

    await expect(saveTaskForm({ editingId: null, draft: draft(daily) }, d)).resolves.toBe('saved');

    expect(d.create).toHaveBeenCalledOnce();
    expect(d.start).not.toHaveBeenCalled();
  });

  it('saveTaskForm_ahora_arranca', async () => {
    const d = deps();

    await expect(saveTaskForm({ editingId: null, draft: draft(null) }, d)).resolves.toBe('started');

    expect(d.start).toHaveBeenCalledOnce();
    expect(d.create).not.toHaveBeenCalled();
  });
});
