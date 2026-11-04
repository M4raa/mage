import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@shared/ipc';
import { TASK_LIMITS, type TaskRecord } from '@shared/tasks';
import { registerTaskIpc } from './taskIpc';
import type { TaskService } from './taskService';

type Listener = (event: unknown, arg: unknown) => unknown;

const DONE: TaskRecord = {
  id: 't1', goal: 'g', language: 'es', provider: 'claude', accountDir: '/a', folders: ['/w'], documents: [], capabilities: [],
  createdAtMs: 1, sessionId: null, conversationId: null, verifiedAtMs: 2, verdict: 'incomplete',
  deliverables: [
    { declared: 'a.md', path: '/w/a.md', status: 'ok', bytes: 1, modifiedAtMs: 1, kind: 'md' },
    { declared: 'b.md', path: '/w/b.md', status: 'missing', bytes: null, modifiedAtMs: null, kind: 'md' },
  ],
};

function setup(overrides: { save?: string | null; picked?: readonly string[] } = {}) {
  const handlers = new Map<string, Listener>();
  const service = { list: vi.fn(() => [DONE]), create: vi.fn(), verify: vi.fn(), remove: vi.fn() };
  const showSaveDialog = vi.fn(async () => (overrides.save === undefined ? '/out/a.md' : overrides.save));
  const copyFile = vi.fn();
  const pickPaths = vi.fn(async () => overrides.picked ?? []);
  registerTaskIpc({
    handle: (channel, listener) => void handlers.set(channel, listener),
    service: () => service as unknown as TaskService,
    pickPaths, showSaveDialog, copyFile,
  });
  const call = (channel: string, arg?: unknown): unknown => (handlers.get(channel) as Listener)(null, arg);
  return { handlers, service, call, showSaveDialog, copyFile, pickPaths };
}

const DRAFT = { goal: 'x', language: 'es', provider: 'claude', accountDir: '/a', folders: ['/w'], documents: [], capabilities: [] };

describe('registerTaskIpc', () => {
  it('register_registraLosSieteCanales', () => {
    const { handlers } = setup();

    expect([...handlers.keys()].sort()).toEqual([
      IpcChannel.TasksCreate, IpcChannel.TasksList, IpcChannel.TasksPickDocuments, IpcChannel.TasksPickFolders,
      IpcChannel.TasksRemove, IpcChannel.TasksSaveCopy, IpcChannel.TasksVerify,
    ].sort());
  });

  it('create_payloadInvalido_lanzaConCanal', () => {
    const { call, service } = setup();

    expect(() => call(IpcChannel.TasksCreate, { ...DRAFT, provider: 'agy' })).toThrow(/tasks:create.*"agy"/);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('create_payloadValido_delegaEnElServicio', () => {
    const { call, service } = setup();

    call(IpcChannel.TasksCreate, DRAFT);

    expect(service.create).toHaveBeenCalledWith(DRAFT);
  });

  it('verify_demasiadas_lanza', () => {
    const { call, service } = setup();
    const declared = Array.from({ length: TASK_LIMITS.maxDeliverables + 1 }, (_, i) => `f${i}`);

    expect(() => call(IpcChannel.TasksVerify, { taskId: 't1', declared })).toThrow(/tasks:verify/);
    expect(service.verify).not.toHaveBeenCalled();
  });

  it('saveCopy_noEsEntregable_error', async () => {
    const { call, copyFile } = setup();

    await expect(call(IpcChannel.TasksSaveCopy, { taskId: 't1', path: '/w/b.md' })).rejects.toThrow();
    await expect(call(IpcChannel.TasksSaveCopy, { taskId: 't1', path: '/otro.md' })).rejects.toThrow();
    expect(copyFile).not.toHaveBeenCalled();
  });

  it('saveCopy_cancelado_false', async () => {
    const { call, copyFile } = setup({ save: null });

    await expect(call(IpcChannel.TasksSaveCopy, { taskId: 't1', path: '/w/a.md' })).resolves.toBe(false);
    expect(copyFile).not.toHaveBeenCalled();
  });

  it('saveCopy_entregableOk_copiaYDevuelveTrue', async () => {
    const { call, copyFile, showSaveDialog } = setup();

    await expect(call(IpcChannel.TasksSaveCopy, { taskId: 't1', path: '/w/a.md' })).resolves.toBe(true);
    expect(showSaveDialog).toHaveBeenCalledWith('a.md');
    expect(copyFile).toHaveBeenCalledWith('/w/a.md', '/out/a.md');
  });

  it('pickFolders_cancelado_vacio', async () => {
    const { call, pickPaths } = setup();

    await expect(call(IpcChannel.TasksPickFolders)).resolves.toEqual([]);
    expect(pickPaths).toHaveBeenCalledWith('folders');
  });
});
