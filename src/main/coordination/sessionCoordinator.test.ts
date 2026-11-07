import { describe, expect, it, vi } from 'vitest';
import type { CreateSessionParams, SessionEventPayload } from '@shared/ipc';
import type { MageEvent, SteerOutcome } from '@shared/events';
import { foreignText, UserFacingError } from '@shared/i18n/localizedText';
import type { NativeSessionRef } from '@shared/coordination';
import { CREATE_PR_PROMPT } from '@shared/permissionPolicy';
import { SessionCoordinator, type ConversationHold, type ConversationIdentityIndex, type CoordinatedSessions, type SequencedSessionEvent } from './sessionCoordinator';

const ACCOUNT = '/home/u/.claude';

// Gestor de sesiones falso: guarda el sumidero de cada sesion para emitir eventos a mano.
function harness(options: { index?: Partial<ConversationIdentityIndex>; emitOnStart?: MageEvent; rules?: Record<string, readonly string[]>; hold?: ConversationHold } = {}) {
  const sinks = new Map<string, (payload: SessionEventPayload) => void>();
  let next = 0;
  const sessions: CoordinatedSessions = {
    create: vi.fn((params: CreateSessionParams, sink: (payload: SessionEventPayload) => void) => {
      const id = params.resumeSessionId !== undefined && params.provider === 'claude' ? params.resumeSessionId : `s${++next}`;
      sinks.set(id, sink);
      if (options.emitOnStart !== undefined) sink({ sessionId: id, event: options.emitOnStart });
      return id;
    }),
    stop: vi.fn(),
    sendMessage: vi.fn(),
    steerMessage: vi.fn(),
    engineRequest: vi.fn(),
    interrupt: vi.fn(),
    answerPermission: vi.fn(),
    answerElicitation: vi.fn(),
    stopOwnedBy: vi.fn().mockReturnValue([]),
    stopByConfigDir: vi.fn().mockReturnValue([]),
    stopAll: vi.fn(),
  };
  const saved = new Map<string, number>();
  const index: ConversationIdentityIndex = {
    resolveConversation: vi.fn((ref: NativeSessionRef) => ({ conversationId: `conv-${ref.nativeId}`, lastSeq: saved.get(`conv-${ref.nativeId}`) ?? 0 })),
    recordLastSeq: vi.fn((id: string, seq: number) => { saved.set(id, seq); }),
    ...options.index,
  };
  const log = vi.fn();
  let clock = 1_000;
  let ids = 0;
  // Lo diferido (respuestas automáticas) se ejecuta a mano con `flush`, como haría la microtarea.
  const deferred: (() => void)[] = [];
  const alwaysAllowTools = vi.fn((key: string): readonly string[] => options.rules?.[key] ?? []);
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const setTimer = (fn: () => void, ms: number) => {
    const timer = { fn, ms, cancelled: false };
    timers.push(timer);
    return () => { timer.cancelled = true; };
  };
  const coordinator = new SessionCoordinator({
    sessions, index, now: () => ++clock, log, newId: () => `cmd-${++ids}`, alwaysAllowTools, defer: (fn) => deferred.push(fn), setTimer,
    ...(options.hold === undefined ? {} : { conversationHold: options.hold }),
  });
  const flush = () => { while (deferred.length > 0) deferred.shift()!(); };
  const received: SequencedSessionEvent[] = [];
  const create = (params: Partial<CreateSessionParams> = {}, ownerId?: number) =>
    coordinator.create({ accountDir: ACCOUNT, cwd: '/p', provider: 'claude', ...params } as CreateSessionParams, (p) => received.push(p), ownerId);
  const emit = (sessionId: string, event: MageEvent, as = sessionId) => sinks.get(sessionId)?.({ sessionId: as, event });
  return { coordinator, sessions, index, saved, log, received, create, emit, flush, alwaysAllowTools, timers };
}

const state = (value: 'idle' | 'running'): MageEvent => ({ kind: 'session_state', state: value });
const init = (sessionId: string): MageEvent => ({ kind: 'session_init', sessionId, model: 'm', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], pluginErrors: [] });

describe('SessionCoordinator — secuencia e identidades (F2.1)', () => {
  it('relay_variosEventos_secuenciaMonotonaConHoraYConversacion', () => {
    const h = harness();
    const id = h.create();

    h.emit(id, state('running'));
    h.emit(id, { kind: 'stream_delta', text: 'hola' });

    expect(h.received.map((p) => [p.seq, p.conversationId, p.sessionId])).toEqual([[1, `conv-${id}`, id], [2, `conv-${id}`, id]]);
    expect(h.received[1]!.at).toBeGreaterThan(h.received[0]!.at);
  });

  it('create_claudeNueva_ligaLaConversacionConSuIdYLaCuentaEfectiva', () => {
    const h = harness();

    const id = h.create({ accountDir: `${ACCOUNT}/mage-private` });

    expect(h.index.resolveConversation).toHaveBeenCalledWith({ provider: 'claude', accountDir: `${ACCOUNT}/mage-private`, nativeId: id });
    expect(h.coordinator.snapshot(id)).toEqual({ sessionId: id, provider: 'claude', conversationId: `conv-${id}`, nativeRef: { provider: 'claude', accountDir: `${ACCOUNT}/mage-private`, nativeId: id }, lastSeq: 0, state: 'starting', queue: [], pending: [], background: false });
  });

  it('create_codexNueva_sinConversacionHastaSuSessionInit', () => {
    const h = harness();
    const id = h.create({ provider: 'codex' });
    h.emit(id, { kind: 'models_available', models: [] });

    h.emit(id, init('thread-9'));

    expect(h.received.map((p) => p.conversationId)).toEqual([null, 'conv-thread-9']);
    expect(h.coordinator.snapshot(id).nativeRef).toEqual({ provider: 'codex', accountDir: ACCOUNT, nativeId: 'thread-9' });
  });

  it('create_codexReanudada_ligaConElHiloQueReanuda', () => {
    const h = harness();

    const id = h.create({ provider: 'codex', resumeSessionId: 'thread-7' });

    expect(h.coordinator.conversationIdOf(id)).toBe('conv-thread-7');
  });

  it('bind_conversacionConSecuenciaGuardada_continuaDesdeEsa', () => {
    const h = harness();
    h.saved.set('conv-abc', 40);
    const id = h.create({ resumeSessionId: 'abc' });

    h.emit(id, state('running'));

    expect(h.received[0]!.seq).toBe(41);
  });

  it('eventoDuranteElArranque_tieneSecuencia', () => {
    const h = harness({ emitOnStart: { kind: 'notice', localized: foreignText('arrancando') } as MageEvent });

    h.create();

    expect(h.received.map((p) => p.seq)).toEqual([1]);
  });

  it('snapshot_estadoDelMotor_yReinicio', () => {
    const h = harness();
    const id = h.create();

    h.emit(id, state('running'));
    expect(h.coordinator.snapshot(id).state).toBe('running');
    h.emit(id, { kind: 'session_restarting', attempt: 1, delayMs: 10 } as MageEvent);
    expect(h.coordinator.snapshot(id).state).toBe('restarting');
    h.emit(id, state('idle'));
    expect(h.coordinator.snapshot(id)).toMatchObject({ state: 'idle', lastSeq: 3 });
  });

  it('snapshot_proveedorSinSessionState_estadoPorElTurno', () => {
    // Codex no emite `session_state`: sin esto la instantánea se quedaba en `starting` para siempre.
    const h = harness();
    const id = h.create({ provider: 'codex' });

    h.emit(id, init('thread-1'));
    expect(h.coordinator.snapshot(id).state).toBe('idle');
    h.emit(id, { kind: 'stream_delta', text: 'ho' });
    expect(h.coordinator.snapshot(id).state).toBe('running');
    h.emit(id, { kind: 'result', result: { isError: false, subtype: 'completed', numTurns: null } });
    expect(h.coordinator.snapshot(id).state).toBe('idle');
  });

  it('snapshot_esperandoRespuesta_unDeltaNoLoPisa', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, { kind: 'session_state', state: 'requires_action' });

    h.emit(id, { kind: 'stream_delta', text: 'x' });

    expect(h.coordinator.snapshot(id).state).toBe('requires_action');
  });

  it('conversationReset_elResetSaleConLaViejaYLoSiguienteConLaNueva', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, state('running'));

    h.emit(id, { kind: 'conversation_reset', newSessionId: 'nuevo' });
    h.emit(id, state('idle'), 'nuevo');

    expect(h.received.map((p) => [p.sessionId, p.conversationId, p.seq])).toEqual([
      [id, `conv-${id}`, 1], [id, `conv-${id}`, 2], ['nuevo', 'conv-nuevo', 3],
    ]);
    expect(h.index.recordLastSeq).toHaveBeenCalledWith(`conv-${id}`, 2);
    expect(h.coordinator.snapshot('nuevo').conversationId).toBe('conv-nuevo');
    expect(() => h.coordinator.snapshot(id)).toThrow(`Sesion inexistente: ${id}`);
  });

  it('stop_guardaLaSecuenciaYDejaDeSeguirla', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, state('running'));

    h.coordinator.stop(id);

    expect(h.sessions.stop).toHaveBeenCalledWith(id);
    expect(h.index.recordLastSeq).toHaveBeenCalledWith(`conv-${id}`, 1);
    expect(() => h.coordinator.snapshot(id)).toThrow(/inexistente/);
  });

  it('stop_gestorLanza_noDejaDeSeguirlaNiGuarda', () => {
    const h = harness();
    const id = h.create();
    vi.mocked(h.sessions.stop).mockImplementation(() => { throw new Error(`Sesion inexistente: ${id}`); });

    expect(() => h.coordinator.stop(id)).toThrow(/inexistente/);
    expect(h.coordinator.snapshot(id).sessionId).toBe(id);
    expect(h.index.recordLastSeq).not.toHaveBeenCalled();
  });

  it('stopOwnedBy_soloSueltaLasQueParoElGestor', () => {
    const h = harness();
    const mine = h.create({}, 7);
    const other = h.create({}, 8);
    vi.mocked(h.sessions.stopOwnedBy).mockReturnValue([mine]);

    expect(h.coordinator.stopOwnedBy(7)).toEqual([mine]);

    expect(() => h.coordinator.snapshot(mine)).toThrow(/inexistente/);
    expect(h.coordinator.snapshot(other).sessionId).toBe(other);
  });

  it('stopAll_guardaLaSecuenciaDeTodas', () => {
    const h = harness();
    const a = h.create();
    const b = h.create();
    h.emit(a, state('running'));

    h.coordinator.stopAll();

    expect(h.sessions.stopAll).toHaveBeenCalled();
    expect(h.index.recordLastSeq).toHaveBeenCalledWith(`conv-${a}`, 1);
    expect(h.index.recordLastSeq).toHaveBeenCalledWith(`conv-${b}`, 0);
  });

  it('indiceFalla_losEventosSiguenSinConversacionYQuedaTrazado', () => {
    const h = harness({ index: { resolveConversation: () => { throw new Error('EBUSY'); } } });
    const id = h.create();

    h.emit(id, state('running'));

    expect(h.received[0]).toMatchObject({ seq: 1, conversationId: null });
    expect(h.log).toHaveBeenCalledWith('warn', 'No se pudo ligar la sesion a su conversacion', expect.objectContaining({ error: 'EBUSY' }));
  });

  it('snapshot_sesionDesconocida_lanzaConElId', () => {
    expect(() => harness().coordinator.snapshot('nadie')).toThrow('Sesion inexistente: nadie');
  });

  it('snapshot_sesionDesconocida_lanzaUnErrorDeCaraAlUsuarioConLaClave', () => {
    const act = (): unknown => harness().coordinator.snapshot('nadie');

    expect(act).toThrow(UserFacingError);
    try { act(); } catch (err) {
      expect((err as UserFacingError).localized).toEqual({ key: 'errors.engine.sessionMissing', values: { sessionId: 'nadie' } });
    }
  });
});

describe('SessionCoordinator — cola de mensajes en main (F2.2)', () => {
  const result: MageEvent = { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } };
  const kinds = (h: ReturnType<typeof harness>) => h.received.map((p) => p.event.kind);

  it('send_sinTurno_vaAlMotorYQuedaEnMarcha', () => {
    const h = harness();
    const id = h.create();

    const receipt = h.coordinator.send({ sessionId: id, text: 'hola', commandId: 'c1' });

    expect(receipt).toEqual({ status: 'accepted', commandId: 'c1' });
    expect(h.sessions.sendMessage).toHaveBeenCalledWith(id, 'hola', [], undefined);
    expect(h.coordinator.snapshot(id).state).toBe('running');
  });

  it('send_dosSeguidosSinEventosEntreMedias_elSegundoEspera', () => {
    // La carrera que la cola del renderer no podia cerrar: dos envíos antes de que el motor diga nada.
    const h = harness();
    const id = h.create();

    const first = h.coordinator.send({ sessionId: id, text: 'ALFA', commandId: 'a' });
    const second = h.coordinator.send({ sessionId: id, text: 'BETA', commandId: 'b' });

    expect([first.status, second.status]).toEqual(['accepted', 'queued']);
    expect(h.sessions.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.coordinator.snapshot(id).queue).toEqual([{ id: 'b', text: 'BETA', attachments: [] }]);
  });

  it('send_conTurnoEnMarcha_encolaYEmiteLaColaConSecuencia', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, state('running'));

    h.coordinator.send({ sessionId: id, text: 'luego', commandId: 'c1', attachments: [{ mediaType: 'image/png', data: 'AA==' }] });

    expect(h.received.at(-1)).toMatchObject({ seq: 2, event: { kind: 'queue_changed', queue: [{ id: 'c1', text: 'luego', attachments: [{ mediaType: 'image/png', data: 'AA==' }] }] } });
    expect(h.sessions.sendMessage).not.toHaveBeenCalled();
  });

  it('send_esperandoPermiso_tambienEspera', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, { kind: 'permission_request', request: { requestId: 'r', toolUseId: 't', toolName: 'Bash', input: {}, description: null, isQuestion: false } } as unknown as MageEvent);

    expect(h.coordinator.send({ sessionId: id, text: 'x', commandId: 'c' }).status).toBe('queued');
  });

  it('result_conCola_sacaSoloElPrimeroYLoAnuncia', () => {
    const h = harness();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: 'ALFA', commandId: 'a' });
    h.coordinator.send({ sessionId: id, text: 'BETA', commandId: 'b' });
    h.coordinator.send({ sessionId: id, text: 'GAMMA', commandId: 'g' });

    h.emit(id, result);

    expect(vi.mocked(h.sessions.sendMessage).mock.calls.map((c) => c[1])).toEqual(['ALFA', 'BETA']);
    expect(kinds(h).slice(-3)).toEqual(['result', 'queued_message_sent', 'queue_changed']);
    expect(h.received.at(-2)?.event).toEqual({ kind: 'queued_message_sent', message: { id: 'b', text: 'BETA', attachments: [] } });
    expect(h.coordinator.snapshot(id)).toMatchObject({ state: 'running', queue: [{ id: 'g' }] });
  });

  it('result_variosTurnos_salenEnOrdenUnoPorTurno', () => {
    const h = harness();
    const id = h.create();
    for (const text of ['ALFA', 'BETA', 'GAMMA']) h.coordinator.send({ sessionId: id, text, commandId: text });

    h.emit(id, result);
    h.emit(id, result);
    h.emit(id, result);

    expect(vi.mocked(h.sessions.sendMessage).mock.calls.map((c) => c[1])).toEqual(['ALFA', 'BETA', 'GAMMA']);
    expect(h.coordinator.snapshot(id)).toMatchObject({ state: 'idle', queue: [] });
  });

  it('send_mismoCommandId_mismoReciboSinEnviarDosVeces', () => {
    const h = harness();
    const id = h.create();

    const first = h.coordinator.send({ sessionId: id, text: 'hola', commandId: 'c1' });
    const retry = h.coordinator.send({ sessionId: id, text: 'hola', commandId: 'c1' });

    expect(retry).toBe(first);
    expect(h.sessions.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.coordinator.snapshot(id).queue).toEqual([]);
  });

  it('send_sinCommandId_generaUno', () => {
    const h = harness();
    const id = h.create();

    expect(h.coordinator.send({ sessionId: id, text: 'hola' })).toEqual({ status: 'accepted', commandId: 'cmd-1' });
  });

  it('send_motorLanza_propagaSinCambiarEstadoNiRecordarElRecibo', () => {
    const h = harness();
    const id = h.create();
    vi.mocked(h.sessions.sendMessage).mockImplementationOnce(() => { throw new Error('stdin cerrado'); });

    expect(() => h.coordinator.send({ sessionId: id, text: 'hola', commandId: 'c1' })).toThrow('stdin cerrado');
    expect(h.coordinator.snapshot(id).state).toBe('starting');
    expect(h.coordinator.send({ sessionId: id, text: 'hola', commandId: 'c1' }).status).toBe('accepted');
  });

  it('interrupt_vaciaLaColaAntesDeInterrumpir_yElResultYaNoSacaNada', () => {
    const h = harness();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: 'ALFA', commandId: 'a' });
    h.coordinator.send({ sessionId: id, text: 'BETA', commandId: 'b' });

    const taken = h.coordinator.interrupt(id);
    h.emit(id, result);

    expect(taken).toEqual([{ id: 'b', text: 'BETA', attachments: [] }]);
    expect(h.sessions.interrupt).toHaveBeenCalledWith(id);
    expect(h.sessions.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.coordinator.snapshot(id).queue).toEqual([]);
  });

  it('removeQueued_quitaYDevuelve_oNullSiYaNoEsta', () => {
    const h = harness();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: 'ALFA', commandId: 'a' });
    h.coordinator.send({ sessionId: id, text: 'BETA', commandId: 'b' });

    expect(h.coordinator.removeQueued(id, 'b')).toEqual({ id: 'b', text: 'BETA', attachments: [] });
    expect(h.coordinator.removeQueued(id, 'b')).toBeNull();
    expect(h.received.at(-1)?.event).toEqual({ kind: 'queue_changed', queue: [] });
  });

  it('takeQueue_colaVacia_noEmiteNada', () => {
    const h = harness();
    const id = h.create();

    expect(h.coordinator.takeQueue(id)).toEqual([]);
    expect(h.received).toEqual([]);
  });

  it('drain_motorLanza_anunciaElFalloYQuedaEnReposo', () => {
    const h = harness();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: 'ALFA', commandId: 'a' });
    h.coordinator.send({ sessionId: id, text: 'BETA', commandId: 'b' });
    vi.mocked(h.sessions.sendMessage).mockImplementationOnce(() => { throw new Error('proceso muerto'); });

    h.emit(id, result);

    expect(h.received.at(-2)?.event).toEqual({ kind: 'queued_message_failed', message: { id: 'b', text: 'BETA', attachments: [] }, localized: foreignText('proceso muerto') });
    expect(h.coordinator.snapshot(id)).toMatchObject({ state: 'idle', queue: [] });
  });

  it('drain_envioFalla_queuedMessageFailedConLocalized', () => {
    const own = foreignText('motivo propio');
    const failureOf = (thrown: Error) => {
      const h = harness();
      const id = h.create();
      h.coordinator.send({ sessionId: id, text: 'ALFA', commandId: 'a' });
      h.coordinator.send({ sessionId: id, text: 'BETA', commandId: 'b' });
      vi.mocked(h.sessions.sendMessage).mockImplementationOnce(() => { throw thrown; });
      h.emit(id, result);
      return h.received.map((p) => p.event).find((e) => e.kind === 'queued_message_failed');
    };

    expect(failureOf(new Error('x'))).toMatchObject({ localized: foreignText('x') });
    expect(failureOf(new UserFacingError(own))).toMatchObject({ localized: own });
  });

  it('error_delMotor_dejaDeContarComoTurnoEnMarcha', () => {
    // Mismo criterio que el chat del renderer: tras un error, Enter envía en vez de encolar.
    const h = harness();
    const id = h.create();
    h.emit(id, state('running'));
    h.emit(id, { kind: 'error', localized: foreignText('falló') });

    expect(h.coordinator.send({ sessionId: id, text: 'otra vez', commandId: 'c' }).status).toBe('accepted');
  });

  it('send_sesionDesconocida_lanzaConElId', () => {
    expect(() => harness().coordinator.send({ sessionId: 'nadie', text: 'x' })).toThrow('Sesion inexistente: nadie');
  });
});

describe('SessionCoordinator — permisos, preguntas y elicitations: contestar una vez (F2.3)', () => {
  const permission = (requestId: string): MageEvent =>
    ({ kind: 'permission_request', request: { requestId, toolUseId: `t-${requestId}`, toolName: 'Write', input: { file_path: 'a.txt' }, description: null } }) as unknown as MageEvent;
  const elicitation = (requestId: string): MageEvent =>
    ({ kind: 'elicitation_request', request: { requestId, server: 'bench', mode: 'form', message: '¿Seguro?', requestedSchema: {} } }) as unknown as MageEvent;
  const allow = { behavior: 'allow' } as const;

  it('answerPermission_pendiente_llegaAlMotorYSeAnunciaATodos', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, permission('r1'));

    const receipt = h.coordinator.answerPermission(id, 'r1', allow);

    expect(receipt).toEqual({ status: 'accepted' });
    expect(h.sessions.answerPermission).toHaveBeenCalledWith(id, 'r1', allow);
    expect(h.received.at(-1)?.event).toEqual({ kind: 'permission_resolved', requestId: 'r1', behavior: 'allow' });
    expect(h.coordinator.snapshot(id)).toMatchObject({ state: 'running', pending: [] });
  });

  it('answerPermission_dosRespuestas_unSoloEfecto', () => {
    // Dos clientes (o un doble clic) contestan la misma petición: gana la primera y la otra no llega al motor.
    const h = harness();
    const id = h.create();
    h.emit(id, permission('r1'));

    const first = h.coordinator.answerPermission(id, 'r1', allow);
    const second = h.coordinator.answerPermission(id, 'r1', { behavior: 'deny', message: 'no' });

    expect([first.status, second]).toEqual(['accepted', { status: 'rejected', reason: 'already_answered' }]);
    expect(h.sessions.answerPermission).toHaveBeenCalledTimes(1);
    expect(h.received.filter((p) => p.event.kind === 'permission_resolved')).toHaveLength(1);
  });

  it('answerPermission_cancelada_oDeUnTurnoAcabado_seRechaza', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, permission('r1'));
    h.emit(id, permission('r2'));
    h.emit(id, { kind: 'permission_cancelled', requestId: 'r1' });
    h.emit(id, { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } });

    expect(h.coordinator.answerPermission(id, 'r1', allow).status).toBe('rejected');
    expect(h.coordinator.answerPermission(id, 'r2', allow).status).toBe('rejected');
    expect(h.sessions.answerPermission).not.toHaveBeenCalled();
  });

  it('answerPermission_unaDeDos_siguePidiendoRespuesta', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, permission('r1'));
    h.emit(id, permission('r2'));

    h.coordinator.answerPermission(id, 'r1', allow);

    expect(h.coordinator.snapshot(id)).toMatchObject({ state: 'requires_action', pending: [{ kind: 'permission', request: { requestId: 'r2' } }] });
  });

  it('permissionRequest_reenviado_noSeDuplica', () => {
    const h = harness();
    const id = h.create();

    h.emit(id, permission('r1'));
    h.emit(id, permission('r1'));

    expect(h.coordinator.snapshot(id).pending).toHaveLength(1);
  });

  it('answerPermission_motorLanza_propagaYNoVuelveAPendientes', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, permission('r1'));
    vi.mocked(h.sessions.answerPermission).mockImplementationOnce(() => { throw new Error('Permiso desconocido o ya resuelto: requestId=r1'); });

    expect(() => h.coordinator.answerPermission(id, 'r1', allow)).toThrow(/ya resuelto/);
    expect(h.coordinator.answerPermission(id, 'r1', allow).status).toBe('rejected');
  });

  it('answerElicitation_unaVez_yLaResolucionDeLaSesionLaCierra', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, elicitation('e1'));
    const answer = { sessionId: id, requestId: 'e1', action: 'accept' as const, content: {} };

    const first = h.coordinator.answerElicitation(answer);
    const second = h.coordinator.answerElicitation(answer);
    h.emit(id, { kind: 'elicitation_resolved', requestId: 'e1', action: 'accept' });

    expect([first.status, second.status]).toEqual(['accepted', 'rejected']);
    expect(h.sessions.answerElicitation).toHaveBeenCalledTimes(1);
    expect(h.coordinator.snapshot(id)).toMatchObject({ pending: [], state: 'running' });
  });

  it('answerElicitation_unPermisoConEseId_noLoContesta', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, permission('x'));

    expect(h.coordinator.answerElicitation({ sessionId: id, requestId: 'x', action: 'decline' }).status).toBe('rejected');
    expect(h.coordinator.answerPermission(id, 'x', allow).status).toBe('accepted');
  });

  it('answerPermission_pregunta_anunciaSusRespuestas', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, permission('q1'));

    h.coordinator.answerPermission(id, 'q1', { behavior: 'allow', updatedInput: { questions: [], answers: { '¿Color?': 'Azul' } } });

    expect(h.received.at(-1)?.event).toEqual({ kind: 'permission_resolved', requestId: 'q1', behavior: 'allow', answers: { '¿Color?': 'Azul' } });
  });

  it('answerPermission_sesionDesconocida_lanzaConElId', () => {
    expect(() => harness().coordinator.answerPermission('nadie', 'r', allow)).toThrow('Sesion inexistente: nadie');
  });
});

describe('SessionCoordinator — respuestas automáticas en main (F2.4, H1 de la devolución 14)', () => {
  const request = (requestId: string, toolName: string, input: Record<string, unknown>, extra: Record<string, unknown> = {}): MageEvent =>
    ({ kind: 'permission_request', request: { requestId, toolUseId: `t-${requestId}`, toolName, input, description: null, requiresUserInteraction: false, displayName: null, ...extra } }) as unknown as MageEvent;
  const forcePush = (requestId = 'r1') => request(requestId, 'Bash', { command: 'git push --force' });
  const result: MageEvent = { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } };
  const behaviors = (h: ReturnType<typeof harness>) => vi.mocked(h.sessions.answerPermission).mock.calls.map(([, , d]) => d.behavior);
  const kinds = (h: ReturnType<typeof harness>) => h.received.map((p) => p.event.kind);

  it('permissionRequest_reglaSiempre_seContestaEnMainSinAnunciarla', () => {
    const h = harness({ rules: { 'conv-s1': ['Write'] } });
    const id = h.create({ provider: 'codex', resumeSessionId: 's1' });

    h.emit(id, request('r1', 'Write', { file_path: 'a.txt' }));
    h.flush();

    expect(h.sessions.answerPermission).toHaveBeenCalledWith(id, 'r1', { behavior: 'allow' });
    expect(kinds(h)).toEqual(['permission_auto_answered']);
    expect(h.received[0]!.event).toEqual({ kind: 'permission_auto_answered', requestId: 'r1', toolName: 'Write', behavior: 'allow', blocked: null });
    expect(h.coordinator.snapshot(id).pending).toEqual([]);
  });

  it('permissionRequest_reglaBashEnElTurnoDePr_soloDeniega', () => {
    // El caso de la sonda de dirección: allow nunca antes que deny; aquí ni siquiera hay allow.
    const h = harness();
    const id = h.create();
    h.alwaysAllowTools.mockReturnValue(['Bash']);
    h.coordinator.send({ sessionId: id, text: `${CREATE_PR_PROMPT} Rama: x` });

    h.emit(id, forcePush());
    h.flush();

    expect(behaviors(h)).toEqual(['deny']);
    expect(vi.mocked(h.sessions.answerPermission).mock.calls[0]![2]).toEqual({ behavior: 'deny', message: expect.stringContaining('git push --force') as unknown });
    expect(h.received.at(-1)!.event).toMatchObject({ kind: 'permission_auto_answered', behavior: 'deny', blocked: 'git push --force' });
    expect(kinds(h)).not.toContain('permission_request');
  });

  it('result_desarmaLaBarrera_elSiguienteTurnoPregunta', () => {
    const h = harness();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: CREATE_PR_PROMPT });
    h.emit(id, result);
    h.coordinator.send({ sessionId: id, text: 'otra cosa' });

    h.emit(id, forcePush());
    h.flush();

    expect(h.sessions.answerPermission).not.toHaveBeenCalled();
    expect(h.coordinator.snapshot(id).pending).toHaveLength(1);
  });

  it('drain_mensajeEncoladoConElPromptDePr_armaLaBarrera', () => {
    const h = harness();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: 'primero' });
    h.coordinator.send({ sessionId: id, text: CREATE_PR_PROMPT });
    h.emit(id, result);

    h.emit(id, forcePush());
    h.flush();

    expect(behaviors(h)).toEqual(['deny']);
  });

  it('permissionRequest_reglaFueraDelProyectoOPregunta_seAnuncia', () => {
    const h = harness();
    const id = h.create();
    h.alwaysAllowTools.mockReturnValue(['Bash', 'AskUserQuestion']);
    const question = { questions: [{ question: '¿Cuál?', header: 'h', options: [{ label: 'a', description: '' }, { label: 'b', description: '' }], multiSelect: false }] };

    h.emit(id, request('r1', 'Bash', { command: 'ls' }, { outsideProject: true }));
    h.emit(id, request('r2', 'AskUserQuestion', question));
    h.flush();

    expect(h.sessions.answerPermission).not.toHaveBeenCalled();
    expect(h.coordinator.snapshot(id).pending.map((p) => p.request.requestId)).toEqual(['r1', 'r2']);
  });

  it('permissionRequest_reglasIlegibles_preguntaYQuedaTrazado', () => {
    const h = harness();
    const id = h.create();
    h.alwaysAllowTools.mockImplementation(() => { throw new Error('EACCES'); });

    h.emit(id, request('r1', 'Write', {}));

    expect(h.coordinator.snapshot(id).pending).toHaveLength(1);
    expect(h.log).toHaveBeenCalledWith('warn', expect.stringContaining('reglas'), expect.objectContaining({ error: 'EACCES' }));
  });

  it('respuestaAutomatica_motorLanza_quedaTrazadaYNoSeAnuncia', () => {
    const h = harness();
    const id = h.create();
    h.alwaysAllowTools.mockReturnValue(['Write']);
    vi.mocked(h.sessions.answerPermission).mockImplementationOnce(() => { throw new Error('Permiso desconocido'); });

    h.emit(id, request('r1', 'Write', {}));
    h.flush();

    expect(h.log).toHaveBeenCalledWith('warn', expect.stringContaining('automática'), expect.objectContaining({ requestId: 'r1', error: 'Permiso desconocido' }));
    expect(kinds(h)).not.toContain('permission_auto_answered');
  });

  it('respuestaAutomatica_sesionParadaAntesDeContestar_noLlegaAlMotor', () => {
    const h = harness();
    const id = h.create();
    h.alwaysAllowTools.mockReturnValue(['Write']);
    h.emit(id, request('r1', 'Write', {}));

    h.coordinator.stop(id);
    h.flush();

    expect(h.sessions.answerPermission).not.toHaveBeenCalled();
  });

  it('permissionRequest_reglaDeWritePeroLlegaBash_seAnunciaYNoSeContesta', () => {
    // H1b de la devolución 15: la regla es POR HERRAMIENTA; otra herramienta sigue preguntando.
    const h = harness({ rules: { 'conv-s1': ['Write'] } });
    const id = h.create({ provider: 'codex', resumeSessionId: 's1' });

    h.emit(id, request('r1', 'Bash', { command: 'ls' }));
    h.flush();

    expect(h.sessions.answerPermission).not.toHaveBeenCalled();
    expect(kinds(h)).toEqual(['permission_request']);
    expect(h.coordinator.snapshot(id).pending.map((p) => p.request.requestId)).toEqual(['r1']);
  });

  it('respuestaAutomatica_runtimeEmiteRequiresActionDespuesDeLaPeticion_elEstadoNoQuedaEnRequiresAction', () => {
    // El runtime emite `requires_action` justo DESPUÉS de la petición y reanuda (`running`) al recibir la
    // respuesta. Contestar dentro de la propia petición dejaría `running` ANTES de `requires_action`.
    const h = harness({ rules: { 'conv-s1': ['Write'] } });
    const id = h.create({ provider: 'codex', resumeSessionId: 's1' });
    vi.mocked(h.sessions.answerPermission).mockImplementation((sessionId) => h.emit(sessionId, state('running')));

    h.emit(id, request('r1', 'Write', { file_path: 'a.txt' }));
    h.emit(id, { kind: 'session_state', state: 'requires_action' });
    h.flush();

    expect(h.coordinator.snapshot(id).state).toBe('running');
  });

  it('answerPermission_motorLanza_anunciaLaCancelacion', () => {
    // H4: los demás clientes cierran su tarjeta aunque el motor rechace la respuesta.
    const h = harness();
    const id = h.create();
    h.emit(id, request('r1', 'Write', {}));
    vi.mocked(h.sessions.answerPermission).mockImplementationOnce(() => { throw new Error('ya resuelto'); });

    expect(() => h.coordinator.answerPermission(id, 'r1', { behavior: 'allow' })).toThrow(/ya resuelto/);
    expect(h.received.at(-1)!.event).toEqual({ kind: 'permission_cancelled', requestId: 'r1' });
  });
});

describe('SessionCoordinator — cierre y segundo plano en main (F2.4)', () => {
  const result: MageEvent = { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } };
  const forcePush: MageEvent = { kind: 'permission_request', request: { requestId: 'r1', toolUseId: 't1', toolName: 'Bash', input: { command: 'git push --force' }, description: null, requiresUserInteraction: false, displayName: null } };

  it('close_sinTurno_paraLaSesion', () => {
    const h = harness();
    const id = h.create();

    expect(h.coordinator.close(id)).toEqual({ background: false });
    expect(h.sessions.stop).toHaveBeenCalledWith(id);
    expect(() => h.coordinator.snapshot(id)).toThrow(`Sesion inexistente: ${id}`);
  });

  it('close_conTurnoEnMarcha_segundoPlanoYLaColaNoSaleAlAcabar', () => {
    // Cierra la ventana: descartar la cola y pasar a segundo plano es un solo paso.
    const h = harness();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: 'primero' });
    h.coordinator.send({ sessionId: id, text: 'segundo' });

    const receipt = h.coordinator.close(id);
    h.emit(id, result);

    expect(receipt).toEqual({ background: true });
    expect(h.sessions.stop).not.toHaveBeenCalled();
    expect(h.sessions.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.coordinator.snapshot(id)).toMatchObject({ background: true, queue: [], state: 'idle' });
    expect(h.timers.map((t) => t.ms)).toEqual([7 * 24 * 60 * 60 * 1000]);
  });

  it('close_esperandoPermiso_segundoPlano', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, { kind: 'permission_request', request: { requestId: 'r0', toolUseId: 't0', toolName: 'Write', input: {}, description: null, requiresUserInteraction: false, displayName: null } });

    expect(h.coordinator.close(id).background).toBe(true);
  });

  it('pestañaCerrada_reglaBashEnElTurnoDePr_soloDeniega', () => {
    // El caso de la sonda con la pestaña cerrada: la sesión sigue en main y la barrera también.
    const h = harness();
    const id = h.create();
    h.alwaysAllowTools.mockReturnValue(['Bash']);
    h.coordinator.send({ sessionId: id, text: CREATE_PR_PROMPT });
    h.coordinator.close(id);

    h.emit(id, forcePush);
    h.flush();

    expect(vi.mocked(h.sessions.answerPermission).mock.calls.map(([, , d]) => d.behavior)).toEqual(['deny']);
  });

  it('caducidad_avisaYParaLaSesion', () => {
    const h = harness();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: 'largo' });
    h.coordinator.close(id);

    h.timers[0]!.fn();

    expect(h.received.at(-1)!.event).toEqual({ kind: 'background_expired' });
    expect(h.sessions.stop).toHaveBeenCalledWith(id);
  });

  it('stop_enSegundoPlano_cancelaLaCaducidad', () => {
    const h = harness();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: 'largo' });
    h.coordinator.close(id);

    h.coordinator.stop(id);

    expect(h.timers[0]!.cancelled).toBe(true);
  });

  it('close_sesionDesconocida_lanzaConElId', () => {
    expect(() => harness().coordinator.close('nada')).toThrow('Sesion inexistente: nada');
  });
});

describe('SessionCoordinator — bloqueo de la conversación en segundo plano (#55, F2.8)', () => {
  const result: MageEvent = { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } };
  const withHold = () => {
    const hold = { hold: vi.fn(), release: vi.fn() };
    return { h: harness({ hold }), hold };
  };

  it('close_conTurno_laSesionSujetaSuConversacion', () => {
    const { h, hold } = withHold();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: 'largo' });

    h.coordinator.close(id);

    expect(hold.hold).toHaveBeenCalledWith(id, { provider: 'claude', accountDir: ACCOUNT, nativeId: id });
  });

  it('result_enSegundoPlano_laSueltaAlQuedarseSinTurno', () => {
    const { h, hold } = withHold();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: 'largo' });
    h.coordinator.close(id);

    h.emit(id, result);

    expect(hold.release).toHaveBeenCalledWith(id);
  });

  it('result_conPestana_noSueltaNada', () => {
    const { h, hold } = withHold();
    const id = h.create();
    h.coordinator.send({ sessionId: id, text: 'corto' });

    h.emit(id, result);

    expect(hold.release).not.toHaveBeenCalled();
  });

  it('close_sinTurno_noSujetaYAlPararLaSuelta', () => {
    const { h, hold } = withHold();
    const id = h.create();

    h.coordinator.close(id);

    expect(hold.hold).not.toHaveBeenCalled();
    expect(hold.release).toHaveBeenCalledWith(id);
  });

  it('stopAll_alSalir_sueltaTodas', () => {
    const { h, hold } = withHold();
    const a = h.create();
    const b = h.create();

    h.coordinator.stopAll();

    expect(hold.release.mock.calls.map(([id]) => id).sort()).toEqual([a, b].sort());
  });
});

describe('SessionCoordinator — varios clientes por sesión (F2.6, H2 de la devolución 14)', () => {
  const request = (requestId: string, toolName = 'Write'): MageEvent =>
    ({ kind: 'permission_request', request: { requestId, toolUseId: `t-${requestId}`, toolName, input: {}, description: null, requiresUserInteraction: false, displayName: null } }) as unknown as MageEvent;
  const listener = () => {
    const events: SequencedSessionEvent[] = [];
    const onClosed = vi.fn();
    return { events, onClosed, listener: { sink: (e: SequencedSessionEvent) => { events.push(e); }, onClosed } };
  };

  it('subscribe_otroCliente_recibeLosMismosEventosConLaMismaSecuencia', () => {
    const h = harness();
    const id = h.create();
    const other = listener();
    h.coordinator.subscribe(id, other.listener);

    h.emit(id, state('running'));
    h.emit(id, state('idle'));

    expect(other.events.map((e) => [e.seq, e.event.kind])).toEqual(h.received.map((e) => [e.seq, e.event.kind]));
    expect(other.events).toEqual(h.received);
  });

  it('subscribe_conEventosPrevios_laInstantaneaYLosSiguientesNoDejanHuecoNiRepiten', () => {
    const h = harness();
    const id = h.create();
    h.emit(id, state('running'));
    const other = listener();

    const { snapshot } = h.coordinator.subscribe(id, other.listener);
    h.emit(id, state('idle'));

    expect(snapshot.lastSeq).toBe(1);
    expect(other.events.map((e) => e.seq)).toEqual([2]);
  });

  it('subscriberCount_afterCreate_isZero', () => {
    const h = harness();

    expect(h.coordinator.subscriberCount(h.create())).toBe(0);
  });

  it('subscriberCount_twoSubscribersThenOneLeaves_isOne', () => {
    const h = harness();
    const id = h.create();
    const first = h.coordinator.subscribe(id, listener().listener);
    h.coordinator.subscribe(id, listener().listener);

    first.unsubscribe();

    expect(h.coordinator.subscriberCount(id)).toBe(1);
  });

  it('subscriberCount_unknownSession_throws', () => {
    const h = harness();

    expect(() => h.coordinator.subscriberCount('nope')).toThrow();
  });

  it('unsubscribe_dejaDeRecibir_yEsIdempotente', () => {
    const h = harness();
    const id = h.create();
    const other = listener();
    const { unsubscribe } = h.coordinator.subscribe(id, other.listener);

    unsubscribe();
    unsubscribe();
    h.emit(id, state('running'));

    expect(other.events).toEqual([]);
    expect(h.received).toHaveLength(1);
  });

  it('subscribe_unSumideroQueLanza_noCortaAlRestoYQuedaTrazado', () => {
    const h = harness();
    const id = h.create();
    const good = listener();
    h.coordinator.subscribe(id, { sink: () => { throw new Error('socket roto'); }, onClosed: () => undefined });
    h.coordinator.subscribe(id, good.listener);

    h.emit(id, state('running'));

    expect(h.received).toHaveLength(1);
    expect(good.events).toHaveLength(1);
    expect(h.log).toHaveBeenCalledWith('warn', expect.stringContaining('fallo al recibir'), expect.objectContaining({ error: 'socket roto', seq: 1 }));
  });

  it('subscribe_clienteQueSeSueltaMientrasRecibe_losDemasSiguenRecibiendo', () => {
    const h = harness();
    const id = h.create();
    const good = listener();
    let release: () => void = () => undefined;
    release = h.coordinator.subscribe(id, { sink: () => release(), onClosed: () => undefined }).unsubscribe;
    h.coordinator.subscribe(id, good.listener);

    h.emit(id, state('running'));
    h.emit(id, state('idle'));

    expect(good.events.map((e) => e.seq)).toEqual([1, 2]);
  });

  it('permisoContestado_loVenTodosLosClientes', () => {
    const h = harness();
    const id = h.create();
    const other = listener();
    h.coordinator.subscribe(id, other.listener);
    h.emit(id, request('r1'));

    h.coordinator.answerPermission(id, 'r1', { behavior: 'allow' });

    expect(other.events.map((e) => e.event.kind)).toEqual(['permission_request', 'permission_resolved']);
    expect(h.received.map((e) => e.event.kind)).toEqual(['permission_request', 'permission_resolved']);
  });

  it('respuestaAutomatica_laVenTodosLosClientes', () => {
    const h = harness({ rules: { 'conv-s1': ['Write'] } });
    const id = h.create();
    const other = listener();
    h.coordinator.subscribe(id, other.listener);

    h.emit(id, request('r1'));
    h.flush();

    expect(other.events.map((e) => e.event.kind)).toEqual(['permission_auto_answered']);
    expect(h.received.map((e) => e.event.kind)).toEqual(['permission_auto_answered']);
  });

  it('stop_avisaALosClientesUnaSolaVez', () => {
    const h = harness();
    const id = h.create();
    const a = listener();
    const b = listener();
    h.coordinator.subscribe(id, a.listener);
    h.coordinator.subscribe(id, b.listener);

    h.coordinator.stop(id);
    h.coordinator.stopAll();

    expect(a.onClosed).toHaveBeenCalledTimes(1);
    expect(b.onClosed).toHaveBeenCalledTimes(1);
  });

  it('stopAll_yStopOwnedBy_avisanALosClientes', () => {
    const h = harness();
    const first = h.create({}, 5);
    vi.mocked(h.sessions.stopOwnedBy).mockReturnValue([first]);
    const a = listener();
    h.coordinator.subscribe(first, a.listener);

    h.coordinator.stopOwnedBy(5);

    expect(a.onClosed).toHaveBeenCalledTimes(1);
  });

  it('stop_unClienteQueLanzaAlEnterarse_noImpideCerrarYQuedaTrazado', () => {
    const h = harness();
    const id = h.create();
    const good = listener();
    h.coordinator.subscribe(id, { sink: () => undefined, onClosed: () => { throw new Error('ya cerrado'); } });
    h.coordinator.subscribe(id, good.listener);

    h.coordinator.stop(id);

    expect(good.onClosed).toHaveBeenCalledTimes(1);
    expect(h.log).toHaveBeenCalledWith('warn', expect.stringContaining('cierre'), expect.objectContaining({ error: 'ya cerrado' }));
  });

  it('subscribe_sesionDesconocida_lanzaConElId', () => {
    const h = harness();

    expect(() => h.coordinator.subscribe('zz', listener().listener)).toThrow(/zz/);
  });

  it('ownerOf_conDuenoSinDuenoYDesconocida', () => {
    const h = harness();
    const owned = h.create({}, 9);
    const free = h.create();

    expect(h.coordinator.ownerOf(owned)).toBe(9);
    expect(h.coordinator.ownerOf(free)).toBeNull();
    expect(h.coordinator.ownerOf('zz')).toBeUndefined();
  });

  it('listSessions_devuelveLaInstantaneaDeCadaSesionViva', () => {
    const h = harness();
    const a = h.create();
    const b = h.create();
    h.coordinator.stop(a);

    expect(h.coordinator.listSessions().map((s) => s.sessionId)).toEqual([b]);
  });
});

describe('SessionCoordinator — directo y cola (F4.1, F4.2)', () => {
  const C1 = '11111111-1111-4111-8111-111111111111';
  const C2 = '22222222-2222-4222-8222-222222222222';
  const result: MageEvent = { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } };
  const steered = (messageId: string, outcome: SteerOutcome, extra: Partial<Extract<MageEvent, { kind: 'steer_result' }>> = {}): MageEvent => ({ kind: 'steer_result', messageId, outcome, ...extra });
  const deliveries = (h: ReturnType<typeof harness>) => h.received.filter((p) => p.event.kind === 'message_delivery').map((p) => p.event);
  // Sesion con un turno en marcha.
  const running = (h: ReturnType<typeof harness>, provider = 'claude') => { const id = h.create({ provider }); h.emit(id, state('running')); return id; };
  const steer = (h: ReturnType<typeof harness>, id: string, commandId = C1, text = 'ya') => h.coordinator.send({ sessionId: id, text, commandId, mode: 'steer' });

  it('send_directoEnReposo_vaComoEnvioNormal', () => {
    const h = harness();
    const id = h.create();

    const receipt = steer(h, id);

    expect(receipt).toEqual({ status: 'accepted', commandId: C1 });
    expect(h.sessions.sendMessage).toHaveBeenCalledWith(id, 'ya', [], C1);
    expect(h.sessions.steerMessage).not.toHaveBeenCalled();
  });

  it('send_directoConTurno_vaAlMotorConSuCommandIdYDevuelveSteering', () => {
    const h = harness();
    const id = running(h);

    const receipt = steer(h, id);

    expect(receipt).toEqual({ status: 'steering', commandId: C1, awaitsAnswer: false });
    expect(h.sessions.steerMessage).toHaveBeenCalledWith(id, C1, 'ya', []);
    expect(h.sessions.sendMessage).not.toHaveBeenCalled();
  });

  it('send_directoConCommandIdQueNoEsUuid_usaUnIdNuevoParaElMotor', () => {
    const h = harness();
    const id = running(h);

    steer(h, id, 'c1');
    h.emit(id, steered('cmd-1', 'active_turn'));

    expect(h.sessions.steerMessage).toHaveBeenCalledWith(id, 'cmd-1', 'ya', []);
    expect(deliveries(h)).toEqual([{ kind: 'message_delivery', commandId: 'c1', message: { id: 'c1', text: 'ya', attachments: [] }, into: 'active_turn', late: false, turnKind: null }]);
  });

  it('steerResult_activeTurn_anunciaElDestinoYNoReenviaElSteerResult', () => {
    const h = harness();
    const id = running(h);
    steer(h, id);

    h.emit(id, steered(C1, 'active_turn'));

    expect(deliveries(h)).toMatchObject([{ into: 'active_turn' }]);
    expect(h.received.some((p) => p.event.kind === 'steer_result')).toBe(false);
  });

  it('steerResult_newTurnTrasElResult_quedaEnMarchaYLaColaEsperaASuResult', () => {
    const h = harness();
    const id = running(h);
    steer(h, id);
    const queued = h.coordinator.send({ sessionId: id, text: 'B', commandId: 'b' });
    expect(queued.status).toBe('queued');

    h.emit(id, result);
    expect(h.sessions.sendMessage).not.toHaveBeenCalled();
    h.emit(id, state('idle'));
    expect(h.coordinator.snapshot(id).state).toBe('idle');
    h.emit(id, steered(C1, 'new_turn'));

    expect(deliveries(h)).toMatchObject([{ into: 'new_turn', late: true }]);
    expect(h.coordinator.snapshot(id).state).toBe('running');
    expect(h.sessions.sendMessage).not.toHaveBeenCalled();
    h.emit(id, result);
    expect(h.sessions.sendMessage).toHaveBeenCalledWith(id, 'B', [], undefined);
  });

  it('steerResult_newTurnInferidoTrasSuResult_noPoneRunningYSaleComoTurnoCerrado', () => {
    // Arrange: directo en vuelo, el turno acaba y despues acaba tambien el turno propio del directo sin `started`.
    const h = harness();
    const id = running(h);
    steer(h, id);
    const queued = h.coordinator.send({ sessionId: id, text: 'B', commandId: 'b' });
    expect(queued.status).toBe('queued');
    h.emit(id, result);
    h.emit(id, state('idle'));

    // Act: la salvaguarda del adapter lo deduce DESPUES del `result` de ese turno.
    h.emit(id, steered(C1, 'new_turn', { inferred: true }));

    // Assert: no hay turno abierto que esperar; la cola sale.
    expect(deliveries(h)).toMatchObject([{ into: 'new_turn', late: true, turnClosed: true }]);
    expect(h.sessions.sendMessage).toHaveBeenCalledWith(id, 'B', [], undefined);
  });

  it('steerResult_newTurnInferidoSinCola_quedaEnReposo', () => {
    const h = harness();
    const id = running(h);
    steer(h, id);
    h.emit(id, result);
    h.emit(id, state('idle'));

    h.emit(id, steered(C1, 'new_turn', { inferred: true }));

    expect(h.coordinator.snapshot(id).state).toBe('idle');
  });

  it('steerResult_noActiveTurnEnReposo_seEnviaComoMensajeNormalYUnaSolaVez', () => {
    const h = harness();
    const id = running(h);
    steer(h, id);
    h.emit(id, result);
    h.emit(id, state('idle'));

    h.emit(id, steered(C1, 'no_active_turn'));

    expect(deliveries(h)).toMatchObject([{ into: 'new_turn', late: true }]);
    expect(h.sessions.sendMessage).toHaveBeenCalledTimes(1);
    expect(h.coordinator.snapshot(id).state).toBe('running');
  });

  it('send_normalConDirectoEnVueloSinTurno_esperaEnLaCola', () => {
    const h = harness();
    const id = running(h);
    steer(h, id);
    h.emit(id, result);
    h.emit(id, state('idle'));

    const receipt = h.coordinator.send({ sessionId: id, text: 'b', commandId: 'b' });

    expect(receipt).toEqual({ status: 'queued', commandId: 'b' });
  });

  it('steerResult_noActiveTurnSinTurno_seEnviaComoMensajeNuevoTardio', () => {
    const h = harness();
    const id = running(h, 'codex');
    steer(h, id);
    h.emit(id, result);
    h.emit(id, state('idle'));

    h.emit(id, steered(C1, 'no_active_turn'));

    expect(h.sessions.sendMessage).toHaveBeenCalledWith(id, 'ya', [], C1);
    expect(deliveries(h)).toMatchObject([{ into: 'new_turn', late: true, turnKind: null }]);
    expect(h.coordinator.snapshot(id).state).toBe('running');
  });

  it('steerResult_noActiveTurnConTurno_esperaEnLaCola', () => {
    const h = harness();
    const id = running(h, 'codex');
    steer(h, id);

    h.emit(id, steered(C1, 'no_active_turn'));

    expect(h.coordinator.snapshot(id).queue).toEqual([{ id: C1, text: 'ya', attachments: [] }]);
    expect(deliveries(h)).toMatchObject([{ into: 'queue', late: true }]);
  });

  it('steerResult_notSteerable_vaALaColaYLosDirectosSiguientesTambienHastaElResult', () => {
    const h = harness();
    const id = running(h, 'codex');
    steer(h, id);

    h.emit(id, steered(C1, 'not_steerable', { turnKind: 'review' }));
    const second = steer(h, id, C2, 'otro');

    expect(deliveries(h)).toMatchObject([{ into: 'queue', late: false, turnKind: 'review' }]);
    expect(second).toEqual({ status: 'queued', commandId: C2 });
    expect(h.sessions.steerMessage).toHaveBeenCalledTimes(1);
    h.emit(id, result);
    expect(h.sessions.sendMessage).toHaveBeenCalledWith(id, 'ya', [], C1);
    h.emit(id, state('running'));
    expect(steer(h, id, '33333333-3333-4333-8333-333333333333').status).toBe('steering');
  });

  it('steerResult_notSteerableSinTipo_usaUnknown', () => {
    const h = harness();
    const id = running(h, 'codex');
    steer(h, id);

    h.emit(id, steered(C1, 'not_steerable'));

    expect(deliveries(h)).toMatchObject([{ turnKind: 'unknown' }]);
  });

  it('send_directoQueSeResuelveEnLaLlamada_devuelveElReciboDeLaCola', () => {
    const h = harness();
    const id = running(h, 'codex');
    vi.mocked(h.sessions.steerMessage).mockImplementation((sessionId, messageId) => { h.emit(sessionId, steered(messageId, 'no_active_turn')); });

    const receipt = steer(h, id);

    expect(receipt).toEqual({ status: 'queued', commandId: C1 });
    expect(h.coordinator.snapshot(id).queue).toMatchObject([{ id: C1 }]);
    expect(deliveries(h)).toMatchObject([{ into: 'queue' }]);
  });

  it('send_directoConPermisoPendiente_seAceptaYAvisaQueEsperaLaRespuesta', () => {
    const h = harness();
    const id = running(h);
    h.emit(id, { kind: 'permission_request', request: { requestId: 'r', toolUseId: 't', toolName: 'Bash', input: {}, description: null, isQuestion: false } } as unknown as MageEvent);

    const receipt = steer(h, id);

    expect(receipt).toEqual({ status: 'steering', commandId: C1, awaitsAnswer: true });
    expect(h.sessions.steerMessage).toHaveBeenCalled();
  });

  it('send_mismoDirectoDosVeces_soloLlegaUnaVezAlMotor', () => {
    const h = harness();
    const id = running(h);

    const first = steer(h, id);
    const second = steer(h, id);

    expect(second).toEqual(first);
    expect(h.sessions.steerMessage).toHaveBeenCalledTimes(1);
  });

  it('steerResult_failed_anunciaElFalloConElMensaje', () => {
    const h = harness();
    const id = running(h);
    steer(h, id);

    h.emit(id, steered(C1, 'failed', { localized: foreignText('x') }));

    expect(deliveries(h)).toMatchObject([{ into: 'failed', late: false, turnKind: null, localized: foreignText('x'), message: { id: C1, text: 'ya', attachments: [] } }]);
  });

  it('send_motorRechazaElDirecto_propagaElErrorYNoQuedaEnVuelo', () => {
    const h = harness();
    const id = running(h);
    vi.mocked(h.sessions.steerMessage).mockImplementation(() => { throw new Error('caido'); });

    expect(() => steer(h, id)).toThrow('caido');
    h.emit(id, result);
    h.emit(id, state('idle'));

    expect(h.coordinator.send({ sessionId: id, text: 'b', commandId: 'b' })).toEqual({ status: 'accepted', commandId: 'b' });
  });

  it('sessionRestarting_conDirectoEnVuelo_loDaPorFallido', () => {
    const h = harness();
    const id = running(h);
    steer(h, id);

    h.emit(id, { kind: 'session_restarting', attempt: 1, delayMs: 1000 } as MageEvent);
    h.emit(id, steered(C1, 'active_turn'));

    expect(deliveries(h)).toMatchObject([{ into: 'failed', late: false, turnKind: null }]);
    expect(h.log).toHaveBeenCalledWith('warn', expect.any(String), expect.anything());
  });

  it('send_directoEnProveedorSinDirecto_lanzaConElProveedor', () => {
    const h = harness();
    const id = running(h, 'agy');

    expect(() => steer(h, id)).toThrow(/agy/);
    expect(h.sessions.steerMessage).not.toHaveBeenCalled();
  });

  it('steerResult_desconocido_soloDejaUnWarn', () => {
    const h = harness();
    const id = running(h);

    h.emit(id, steered(C1, 'active_turn'));

    expect(deliveries(h)).toEqual([]);
    expect(h.log).toHaveBeenCalledWith('warn', expect.any(String), expect.anything());
  });

  it('updateQueued_mensajeEnCola_cambiaElTextoSinMoverloYAnunciaLaCola', () => {
    const h = harness();
    const id = running(h);
    h.coordinator.send({ sessionId: id, text: 'a', commandId: 'a' });
    h.coordinator.send({ sessionId: id, text: 'b', commandId: 'b' });

    const updated = h.coordinator.updateQueued(id, 'a', 'A2');

    expect(updated).toEqual({ id: 'a', text: 'A2', attachments: [] });
    expect(h.coordinator.snapshot(id).queue.map((m) => m.id)).toEqual(['a', 'b']);
    expect(h.coordinator.snapshot(id).queue.map((m) => m.text)).toEqual(['A2', 'b']);
    expect(h.received.at(-1)?.event.kind).toBe('queue_changed');
  });

  it('updateQueued_mensajeQueYaNoEsta_devuelveNull', () => {
    const h = harness();
    const id = running(h);

    expect(h.coordinator.updateQueued(id, 'nope', 'x')).toBeNull();
  });

  it('updateQueued_textoVacioSinAdjuntos_lanzaConElId', () => {
    const h = harness();
    const id = running(h);
    h.coordinator.send({ sessionId: id, text: 'a', commandId: 'a' });

    expect(() => h.coordinator.updateQueued(id, 'a', '   ')).toThrow(/a/);
    expect(h.coordinator.snapshot(id).queue).toEqual([{ id: 'a', text: 'a', attachments: [] }]);
  });

  it('updateQueued_textoVacioConAdjuntos_loAcepta', () => {
    const h = harness();
    const id = running(h);
    const attachments = [{ mediaType: 'image/png' as const, data: 'AA==' }];
    h.coordinator.send({ sessionId: id, text: 'img', commandId: 'a', attachments });

    expect(h.coordinator.updateQueued(id, 'a', '')).toEqual({ id: 'a', text: '', attachments });
  });
});
