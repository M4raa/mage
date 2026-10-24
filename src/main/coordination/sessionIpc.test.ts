import { describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { registerSessionIpc, type SessionCommands, type SessionIpcDeps } from './sessionIpc';

type Listener = (event: IpcMainInvokeEvent, arg: unknown) => unknown;

function setup(over: Partial<SessionIpcDeps> = {}) {
  const handlers = new Map<string, Listener>();
  const sessions: SessionCommands = {
    sendMessage: vi.fn(), answerPermission: vi.fn(), answerElicitation: vi.fn(), interrupt: vi.fn(),
    setPermissionMode: vi.fn(), setModel: vi.fn(), setEffort: vi.fn(), stopTask: vi.fn(),
  };
  const coordinator = { stop: vi.fn(), snapshot: vi.fn().mockReturnValue({ sessionId: 's1', lastSeq: 3 }) };
  const deps: SessionIpcDeps = {
    handle: (channel, listener) => {
      if (handlers.has(channel)) throw new Error(`canal registrado dos veces: ${channel}`);
      handlers.set(channel, listener);
    },
    sessions,
    coordinator,
    createSession: vi.fn().mockReturnValue({ sessionId: 's1', configDir: '/cfg' }),
    validateAttachments: vi.fn().mockReturnValue([]),
    newScratchDir: vi.fn().mockReturnValue('/scratch/x'),
    ...over,
  };
  registerSessionIpc(deps);
  const invoke = (channel: string, arg?: unknown) => {
    const listener = handlers.get(channel);
    if (listener === undefined) throw new Error(`canal sin registrar: ${channel}`);
    return listener({ sender: { id: 7 } } as unknown as IpcMainInvokeEvent, arg);
  };
  return { deps, sessions, coordinator, handlers, invoke };
}

describe('registerSessionIpc', () => {
  it('registerSessionIpc_registra_losCanalesDeSesionUnaVez', () => {
    const { handlers } = setup();

    expect([...handlers.keys()].sort()).toEqual([
      IpcChannel.SessionAnswerElicitation, IpcChannel.SessionAnswerPermission, IpcChannel.SessionCreate, IpcChannel.SessionGetScratchDir,
      IpcChannel.SessionInterrupt, IpcChannel.SessionSendMessage, IpcChannel.SessionSetEffort, IpcChannel.SessionSetModel,
      IpcChannel.SessionSetPermissionMode, IpcChannel.SessionSnapshot, IpcChannel.SessionStop, IpcChannel.SessionStopTask,
    ].sort());
  });

  it('create_delegaEnCreateSession_conElEventoYLosParametros', () => {
    const { deps, invoke } = setup();
    const params = { accountDir: '/a', cwd: '/p', provider: 'claude' };

    const result = invoke(IpcChannel.SessionCreate, params);

    expect(result).toEqual({ sessionId: 's1', configDir: '/cfg' });
    expect(deps.createSession).toHaveBeenCalledWith(expect.objectContaining({ sender: { id: 7 } }), params);
  });

  it('sendMessage_validaLosAdjuntosEnLaFrontera', () => {
    const validated = [{ mediaType: 'image/png', dataBase64: 'AA==' }];
    const { sessions, invoke } = setup({ validateAttachments: vi.fn().mockReturnValue(validated) });

    invoke(IpcChannel.SessionSendMessage, { sessionId: 's1', text: 'hola', attachments: [{ raro: true }] });

    expect(sessions.sendMessage).toHaveBeenCalledWith('s1', 'hola', validated);
  });

  it('answerElicitation_respuestaMalFormada_lanzaSinLlegarALaSesion', () => {
    const { sessions, invoke } = setup();

    expect(() => invoke(IpcChannel.SessionAnswerElicitation, { sessionId: 's1' })).toThrow();
    expect(sessions.answerElicitation).not.toHaveBeenCalled();
  });

  it('opciones_yParada_vanAlGestorConSusArgumentos', () => {
    const { sessions, coordinator, invoke } = setup();

    invoke(IpcChannel.SessionSetModel, { sessionId: 's1', model: 'haiku' });
    invoke(IpcChannel.SessionSetEffort, { sessionId: 's1', effort: 'low' });
    invoke(IpcChannel.SessionSetPermissionMode, { sessionId: 's1', mode: 'plan' });
    invoke(IpcChannel.SessionStopTask, { sessionId: 's1', taskId: 't1' });
    invoke(IpcChannel.SessionAnswerPermission, { sessionId: 's1', requestId: 'r1', decision: { behavior: 'deny', message: 'no' } });
    invoke(IpcChannel.SessionInterrupt, 's1');
    invoke(IpcChannel.SessionStop, 's1');

    expect(sessions.setModel).toHaveBeenCalledWith('s1', 'haiku');
    expect(sessions.setEffort).toHaveBeenCalledWith('s1', 'low');
    expect(sessions.setPermissionMode).toHaveBeenCalledWith('s1', 'plan');
    expect(sessions.stopTask).toHaveBeenCalledWith('s1', 't1');
    expect(sessions.answerPermission).toHaveBeenCalledWith('s1', 'r1', { behavior: 'deny', message: 'no' });
    expect(sessions.interrupt).toHaveBeenCalledWith('s1');
    expect(coordinator.stop).toHaveBeenCalledWith('s1');
  });

  it('snapshot_vaALaCoordinacion', () => {
    const { coordinator, invoke } = setup();

    expect(invoke(IpcChannel.SessionSnapshot, 's1')).toEqual({ sessionId: 's1', lastSeq: 3 });
    expect(coordinator.snapshot).toHaveBeenCalledWith('s1');
  });

  it('getScratchDir_devuelveLaCarpetaNueva', () => {
    const { invoke } = setup();

    expect(invoke(IpcChannel.SessionGetScratchDir)).toBe('/scratch/x');
  });
});
