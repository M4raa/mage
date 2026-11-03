import { describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { IpcChannel } from '@shared/ipc';
import { registerSessionIpc, type SessionCommands, type SessionIpcDeps } from './sessionIpc';

type Listener = (event: IpcMainInvokeEvent, arg: unknown) => unknown;

function setup(over: Partial<SessionIpcDeps> = {}) {
  const handlers = new Map<string, Listener>();
  const sessions: SessionCommands = {
    setPermissionMode: vi.fn(), setModel: vi.fn(), setEffort: vi.fn(), stopTask: vi.fn(),
  };
  const coordinator = {
    send: vi.fn().mockReturnValue({ status: 'queued', commandId: 'c1' }),
    interrupt: vi.fn().mockReturnValue([{ id: 'q1', text: 'luego', attachments: [] }]),
    removeQueued: vi.fn().mockReturnValue(null),
    updateQueued: vi.fn().mockReturnValue(null),
    takeQueue: vi.fn().mockReturnValue([]),
    answerPermission: vi.fn().mockReturnValue({ status: 'accepted' }),
    answerElicitation: vi.fn().mockReturnValue({ status: 'rejected', reason: 'already_answered' }),
    stop: vi.fn(),
    close: vi.fn().mockReturnValue({ background: true }),
    snapshot: vi.fn().mockReturnValue({ sessionId: 's1', lastSeq: 3 }),
  };
  const rewind = {
    plan: vi.fn().mockResolvedValue({ unavailable: null }),
    apply: vi.fn().mockResolvedValue({ draft: '' }),
    diverge: vi.fn().mockResolvedValue({ kind: 'codex', threadId: 't' }),
  };
  const deps: SessionIpcDeps = {
    handle: (channel, listener) => {
      if (handlers.has(channel)) throw new Error(`canal registrado dos veces: ${channel}`);
      handlers.set(channel, listener);
    },
    sessions,
    coordinator,
    rewind,
    createSession: vi.fn().mockReturnValue({ sessionId: 's1', configDir: '/cfg' }),
    validateAttachments: vi.fn().mockReturnValue([]),
    newScratchDir: vi.fn().mockReturnValue('/scratch/x'),
    canControl: vi.fn().mockReturnValue(true),
    ...over,
  };
  registerSessionIpc(deps);
  const invoke = (channel: string, arg?: unknown) => {
    const listener = handlers.get(channel);
    if (listener === undefined) throw new Error(`canal sin registrar: ${channel}`);
    return listener({ sender: { id: 7 } } as unknown as IpcMainInvokeEvent, arg);
  };
  return { deps, sessions, coordinator, rewind, handlers, invoke };
}

describe('registerSessionIpc', () => {
  it('registerSessionIpc_registra_losCanalesDeSesionUnaVez', () => {
    const { handlers } = setup();

    expect([...handlers.keys()].sort()).toEqual([
      IpcChannel.SessionAnswerElicitation, IpcChannel.SessionAnswerPermission, IpcChannel.SessionClose, IpcChannel.SessionCreate, IpcChannel.SessionDiverge, IpcChannel.SessionGetScratchDir,
      IpcChannel.SessionInterrupt, IpcChannel.SessionQueueRemove, IpcChannel.SessionQueueTake, IpcChannel.SessionQueueUpdate, IpcChannel.SessionRewindApply, IpcChannel.SessionRewindPlan, IpcChannel.SessionSendMessage, IpcChannel.SessionSetEffort, IpcChannel.SessionSetModel,
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

  it('sendMessage_validaLosAdjuntosEnLaFronteraYDevuelveElRecibo', () => {
    const validated = [{ mediaType: 'image/png' as const, data: 'AA==' }];
    const { coordinator, invoke } = setup({ validateAttachments: vi.fn().mockReturnValue(validated) });

    const receipt = invoke(IpcChannel.SessionSendMessage, { sessionId: 's1', text: 'hola', attachments: [{ mediaType: 'image/png', data: 'AA==' }], commandId: 'c1' });

    expect(receipt).toEqual({ status: 'queued', commandId: 'c1' });
    expect(coordinator.send).toHaveBeenCalledWith({ sessionId: 's1', text: 'hola', attachments: validated, commandId: 'c1' });
  });

  it('cola_interrumpirQuitarYVaciar_vanALaCoordinacion', () => {
    const { coordinator, invoke } = setup();

    expect(invoke(IpcChannel.SessionInterrupt, 's1')).toEqual([{ id: 'q1', text: 'luego', attachments: [] }]);
    invoke(IpcChannel.SessionQueueRemove, { sessionId: 's1', messageId: 'q2' });
    invoke(IpcChannel.SessionQueueTake, 's1');

    expect(coordinator.interrupt).toHaveBeenCalledWith('s1');
    expect(coordinator.removeQueued).toHaveBeenCalledWith('s1', 'q2');
    expect(coordinator.takeQueue).toHaveBeenCalledWith('s1');
  });

  it('answerElicitation_respuestaMalFormada_lanzaSinLlegarALaCoordinacion', () => {
    const { coordinator, invoke } = setup();

    expect(() => invoke(IpcChannel.SessionAnswerElicitation, { sessionId: 's1' })).toThrow();
    expect(coordinator.answerElicitation).not.toHaveBeenCalled();
  });

  it('respuestas_vanALaCoordinacionYDevuelvenSuRecibo', () => {
    const { coordinator, invoke } = setup();

    const permiso = invoke(IpcChannel.SessionAnswerPermission, { sessionId: 's1', requestId: 'r1', decision: { behavior: 'deny', message: 'no' } });
    const elicitation = invoke(IpcChannel.SessionAnswerElicitation, { sessionId: 's1', requestId: 'e1', action: 'decline' });

    expect(permiso).toEqual({ status: 'accepted' });
    expect(elicitation).toEqual({ status: 'rejected', reason: 'already_answered' });
    expect(coordinator.answerPermission).toHaveBeenCalledWith('s1', 'r1', { behavior: 'deny', message: 'no' });
  });

  it('opciones_yParada_vanAlGestorConSusArgumentos', () => {
    const { sessions, coordinator, invoke } = setup();

    invoke(IpcChannel.SessionSetModel, { sessionId: 's1', model: 'haiku' });
    invoke(IpcChannel.SessionSetEffort, { sessionId: 's1', effort: 'low' });
    invoke(IpcChannel.SessionSetPermissionMode, { sessionId: 's1', mode: 'plan' });
    invoke(IpcChannel.SessionStopTask, { sessionId: 's1', taskId: 't1' });
    invoke(IpcChannel.SessionStop, 's1');

    expect(sessions.setModel).toHaveBeenCalledWith('s1', 'haiku');
    expect(sessions.setEffort).toHaveBeenCalledWith('s1', 'low');
    expect(sessions.setPermissionMode).toHaveBeenCalledWith('s1', 'plan');
    expect(sessions.stopTask).toHaveBeenCalledWith('s1', 't1');
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

  it('close_delegaEnLaCoordinacionYDevuelveSiQuedaEnSegundoPlano', () => {
    const { coordinator, invoke } = setup();

    expect(invoke(IpcChannel.SessionClose, 's1')).toEqual({ background: true });
    expect(coordinator.close).toHaveBeenCalledWith('s1');
  });
});

describe('registerSessionIpc — frontera de entrada (F2.6, H3 de la devolución 14)', () => {
  const LISTENING = [
    [IpcChannel.SessionSendMessage, { sessionId: 's1', text: 'hola' }],
    [IpcChannel.SessionAnswerPermission, { sessionId: 's1', requestId: 'r1', decision: { behavior: 'allow' } }],
    [IpcChannel.SessionAnswerElicitation, { sessionId: 's1', requestId: 'e1', action: 'decline' }],
    [IpcChannel.SessionInterrupt, 's1'],
    [IpcChannel.SessionQueueRemove, { sessionId: 's1', messageId: 'q' }],
    [IpcChannel.SessionQueueTake, 's1'],
    [IpcChannel.SessionSetPermissionMode, { sessionId: 's1', mode: 'plan' }],
    [IpcChannel.SessionSetModel, { sessionId: 's1', model: 'haiku' }],
    [IpcChannel.SessionSetEffort, { sessionId: 's1', effort: 'low' }],
    [IpcChannel.SessionStopTask, { sessionId: 's1', taskId: 't' }],
    [IpcChannel.SessionStop, 's1'],
    [IpcChannel.SessionClose, 's1'],
    [IpcChannel.SessionSnapshot, 's1'],
  ] as const;

  it.each(LISTENING)('%s_sesionDeOtraVentana_lanzaSinLlegarAlCoordinador', (channel, arg) => {
    const { coordinator, sessions, deps, invoke } = setup({ canControl: vi.fn().mockReturnValue(false) });

    expect(() => invoke(channel, arg)).toThrow(/no controla la sesión s1/);

    expect(deps.canControl).toHaveBeenCalledWith(7, 's1');
    for (const fn of [...Object.values(coordinator), ...Object.values(sessions)]) expect(fn).not.toHaveBeenCalled();
  });

  it.each(LISTENING)('%s_sesionPropia_pasa', (channel, arg) => {
    const { invoke } = setup();

    expect(() => invoke(channel, arg)).not.toThrow();
  });

  it.each([
    ['respuestaConDecisionRara', IpcChannel.SessionAnswerPermission, { sessionId: 's1', requestId: 'r1', decision: { behavior: 'quizá' } }],
    ['respuestaConUpdatedInputNoObjeto', IpcChannel.SessionAnswerPermission, { sessionId: 's1', requestId: 'r1', decision: { behavior: 'allow', updatedInput: 'rm -rf /' } }],
    ['respuestaSinRequestId', IpcChannel.SessionAnswerPermission, { sessionId: 's1', decision: { behavior: 'allow' } }],
    ['envioConSessionIdNumerico', IpcChannel.SessionSendMessage, { sessionId: 5, text: 'x' }],
    ['envioConCampoDeMas', IpcChannel.SessionSendMessage, { sessionId: 's1', text: 'x', cwd: '/' }],
    ['interrumpirConObjeto', IpcChannel.SessionInterrupt, { sessionId: 's1' }],
    ['pararSinId', IpcChannel.SessionStop, ''],
    ['modeloVacio', IpcChannel.SessionSetModel, { sessionId: 's1', model: '' }],
    ['quitarDeLaColaSinMensaje', IpcChannel.SessionQueueRemove, { sessionId: 's1' }],
  ])('%s_seRechazaAntesDeAutorizarYSinLlegarAlCoordinador', (_name, channel, arg) => {
    const { coordinator, sessions, deps, invoke } = setup();

    expect(() => invoke(channel, arg)).toThrow(new RegExp(channel));

    expect(deps.canControl).not.toHaveBeenCalled();
    for (const fn of [...Object.values(coordinator), ...Object.values(sessions)]) expect(fn).not.toHaveBeenCalled();
  });

  it('answerPermission_updatedInputValido_llegaTalCual', () => {
    const { coordinator, invoke } = setup();

    invoke(IpcChannel.SessionAnswerPermission, { sessionId: 's1', requestId: 'r1', decision: { behavior: 'allow', updatedInput: { answers: { p: 'a' } } } });

    expect(coordinator.answerPermission).toHaveBeenCalledWith('s1', 'r1', { behavior: 'allow', updatedInput: { answers: { p: 'a' } } });
  });

  it('setEffort_esfuerzoVacio_seAcepta', () => {
    const { sessions, invoke } = setup();

    invoke(IpcChannel.SessionSetEffort, { sessionId: 's1', effort: '' });

    expect(sessions.setEffort).toHaveBeenCalledWith('s1', '');
  });
});

describe('registerSessionIpc — directo y edición de la cola (F4.1, F4.2)', () => {
  it('sendMessage_conModoSteer_llegaALaCoordinacionConElModo', () => {
    const { coordinator, invoke } = setup();

    invoke(IpcChannel.SessionSendMessage, { sessionId: 's1', text: 'x', mode: 'steer' });

    expect(coordinator.send).toHaveBeenCalledWith(expect.objectContaining({ mode: 'steer' }));
  });

  it('queueUpdate_vaALaCoordinacionYDevuelveSuResultado', () => {
    const updated = { id: 'm1', text: 'nuevo', attachments: [] };
    const { coordinator, invoke } = setup();
    vi.mocked(coordinator.updateQueued).mockReturnValue(updated as never);

    const result = invoke(IpcChannel.SessionQueueUpdate, { sessionId: 's1', messageId: 'm1', text: 'nuevo' });

    expect(coordinator.updateQueued).toHaveBeenCalledWith('s1', 'm1', 'nuevo');
    expect(result).toBe(updated);
  });

  it('queueUpdate_ventanaQueNoControlaLaSesion_lanzaSinLlegarALaCoordinacion', () => {
    const { coordinator, deps, invoke } = setup({ canControl: vi.fn().mockReturnValue(false) });

    expect(() => invoke(IpcChannel.SessionQueueUpdate, { sessionId: 's1', messageId: 'm1', text: 'x' })).toThrow(/no controla la sesión s1/);

    expect(deps.canControl).toHaveBeenCalledWith(7, 's1');
    expect(coordinator.updateQueued).not.toHaveBeenCalled();
  });
});

describe('registerSessionIpc — rewind (F4.4, F4.5)', () => {
  const point = { userIndex: 0, text: 'hola', nativeId: 'n1' };

  it('rewindPlan_validInput_reachesCoordinator', async () => {
    const { rewind, invoke } = setup();
    const params = { sessionId: 's1', point, action: 'rewind' };

    await invoke(IpcChannel.SessionRewindPlan, params);

    expect(rewind.plan).toHaveBeenCalledWith(params);
  });

  it('rewindApply_otherWindow_rejected', () => {
    const { rewind, invoke } = setup({ canControl: vi.fn().mockReturnValue(false) });
    const params = { sessionId: 's1', point, action: 'rewind', restoreFiles: false, saveCopy: false };

    expect(() => invoke(IpcChannel.SessionRewindApply, params)).toThrow(/no controla la sesión s1/);

    expect(rewind.apply).not.toHaveBeenCalled();
  });

  it('rewindApply_validatesAttachmentsAtTheBoundary', async () => {
    const validated = [{ mediaType: 'image/png' as const, data: 'AA==' }];
    const { rewind, invoke } = setup({ validateAttachments: vi.fn().mockReturnValue(validated) });
    const params = { sessionId: 's1', point, action: 'retry', restoreFiles: false, saveCopy: false, attachments: validated };

    await invoke(IpcChannel.SessionRewindApply, params);

    expect(rewind.apply).toHaveBeenCalledWith({ ...params, attachments: validated });
  });
});
