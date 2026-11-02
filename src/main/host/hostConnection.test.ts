import { describe, expect, it, vi } from 'vitest';
import type { ConversationSnapshot } from '@shared/coordination';
import { UserFacingError, localized } from '@shared/i18n/localizedText';
import { createTranslator } from '@shared/i18n/translator';
import type { SequencedSessionEvent } from '../coordination/sessionCoordinator';
import { HELLO_DEADLINE_MS, HostConnection, MAX_BUFFERED_BYTES, type HostSessions, type HostTransport } from './hostConnection';
import type { HostControl } from './hostControl';
import { TrustRequiredError, UnknownAccountError } from './hostErrors';
import { HOST_PROTOCOL, HostErrorCode } from './hostProtocol';
import { challengeProof } from './hostToken';

const TOKEN = 'a'.repeat(64);
const NONCE = '0'.repeat(64);
const SNAPSHOT: ConversationSnapshot = { sessionId: 's1', provider: 'claude', conversationId: 'c1', nativeRef: null, lastSeq: 7, state: 'idle', queue: [], pending: [], background: false };
const EVENT: SequencedSessionEvent = { sessionId: 's1', conversationId: 'c1', seq: 8, at: 1, event: { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } } };

function harness(options: { sessions?: Partial<HostSessions>; control?: Partial<HostControl>; maxLineBytes?: number } = {}) {
  const written: string[] = [];
  let buffered = 0;
  let ended = false;
  const transport: HostTransport = { write: (data) => { written.push(data); }, end: () => { ended = true; }, bufferedBytes: () => buffered };
  const sinks: { sink: (event: SequencedSessionEvent) => void; onClosed: () => void }[] = [];
  const unsubscribe = vi.fn();
  const sessions: HostSessions = {
    listSessions: vi.fn(() => [SNAPSHOT]),
    snapshot: vi.fn(() => SNAPSHOT),
    subscribe: vi.fn((_id, listener) => { sinks.push(listener); return { snapshot: SNAPSHOT, unsubscribe }; }),
    send: vi.fn(() => ({ status: 'accepted' as const, commandId: 'k' })),
    interrupt: vi.fn(() => []),
    removeQueued: vi.fn(() => null),
    answerPermission: vi.fn(() => ({ status: 'accepted' as const })),
    answerElicitation: vi.fn(() => ({ status: 'accepted' as const })),
    ...options.sessions,
  };
  const control: HostControl = {
    createSession: vi.fn(() => ({ sessionId: 's9', conversationId: null })),
    setOption: vi.fn(),
    listProjects: vi.fn(() => []),
    listAccounts: vi.fn(() => []),
    ...options.control,
  };
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const log = vi.fn();
  let ids = 0;
  const connection = new HostConnection(transport, {
    sessions, control, mode: 'gui', token: TOKEN, hostVersion: '0.1.3', log, newId: () => `sub-${++ids}`, translate: createTranslator('es'),
    setTimer: (fn, ms) => { const timer = { fn, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
    ...(options.maxLineBytes === undefined ? {} : { maxLineBytes: options.maxLineBytes }),
  });
  const send = (message: unknown) => connection.receive(Buffer.from(`${JSON.stringify(message)}\n`));
  const lines = () => written.join('').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as Record<string, any>);
  const hello = (overrides: Record<string, unknown> = {}) =>
    send({ jsonrpc: '2.0', id: 1, method: 'hello', params: { protocol: HOST_PROTOCOL, client: { kind: 'terminal', version: '1' }, token: TOKEN, ...overrides } });
  return { connection, sessions, control, send, lines, written, hello, sinks, unsubscribe, timers, log, isEnded: () => ended, setBuffered: (n: number) => { buffered = n; } };
}

describe('HostConnection — autenticación', () => {
  it('hello_tokenYVersionBuenos_respondeConProtocoloYCapacidades', () => {
    const h = harness();

    h.hello();

    expect(h.lines()).toHaveLength(1);
    expect(h.lines()[0]!.result).toMatchObject({ protocol: HOST_PROTOCOL, hostVersion: '0.1.3' });
    expect(h.lines()[0]!.result.capabilities).toContain('session.subscribe');
    expect(h.isEnded()).toBe(false);
  });

  it('hello_tokenMalo_errorYCierraSinRepetirElToken', () => {
    const h = harness();

    h.hello({ token: 'b'.repeat(64) });

    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.BadToken);
    expect(h.isEnded()).toBe(true);
    expect(h.written.join('')).not.toContain(TOKEN);
    expect(h.written.join('')).not.toContain('b'.repeat(64));
    expect(JSON.stringify(h.log.mock.calls)).not.toContain('b'.repeat(64));
  });

  it('hello_tokenDeOtraLongitud_badTokenSinLanzar', () => {
    const h = harness();

    h.hello({ token: 'x' });

    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.BadToken);
  });

  it('receive_peticionSinHelloPrevio_notAuthenticatedYCierra', () => {
    const h = harness();

    h.send({ jsonrpc: '2.0', id: 2, method: 'sessions.list' });

    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.NotAuthenticated);
    expect(h.isEnded()).toBe(true);
    expect(h.sessions.listSessions).not.toHaveBeenCalled();
  });

  it('hello_versionMayorDistinta_rechazoConMensajeClaro', () => {
    const h = harness();

    h.hello({ protocol: '2.0' });

    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.ProtocolMismatch);
    expect(h.lines()[0]!.error.message).toMatch(/2\.0/);
    expect(h.isEnded()).toBe(true);
  });

  it('hello_versionMenorDistinta_seAcepta', () => {
    const h = harness();

    h.hello({ protocol: '1.9' });

    expect(h.lines()[0]!.result).toBeDefined();
  });

  it('hello_parametrosInvalidos_invalidParamsYCierra', () => {
    const h = harness();

    h.hello({ client: { kind: 'otro', version: '1' } });

    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.InvalidParams);
    expect(h.isEnded()).toBe(true);
  });

  it('plazoDelHello_sinPresentarse_cierra', () => {
    const h = harness();

    h.timers[0]!.fn();

    expect(h.timers[0]!.ms).toBe(HELLO_DEADLINE_MS);
    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.NotAuthenticated);
    expect(h.isEnded()).toBe(true);
  });

  it('plazoDelHello_trasPresentarse_seCancelaYNoCierra', () => {
    const h = harness();

    h.hello();

    expect(h.timers[0]!.cancelled).toBe(true);
    h.timers[0]!.fn();
    expect(h.isEnded()).toBe(false);
  });
});

describe('HostConnection — frontera de entrada', () => {
  it('receive_jsonInvalido_parseErrorYCierraSinTumbarNada', () => {
    const h = harness();

    expect(() => h.connection.receive(Buffer.from('{no es json\n'))).not.toThrow();

    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.ParseError);
    expect(h.isEnded()).toBe(true);
  });

  it('receive_envoltorioQueNoEsJsonRpc_invalidRequestYCierra', () => {
    const h = harness();

    h.send({ id: 1, method: 'hello' });

    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.InvalidRequest);
    expect(h.isEnded()).toBe(true);
  });

  it('receive_lineaDemasiadoLarga_lineTooLongYCierra', () => {
    const h = harness({ maxLineBytes: 64 });

    h.connection.receive(Buffer.from('x'.repeat(200)));

    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.LineTooLong);
    expect(h.isEnded()).toBe(true);
  });

  it('receive_despuesDeCerrar_ignoraLoQueLlegue', () => {
    const h = harness();
    h.connection.receive(Buffer.from('basura\n'));
    const before = h.written.length;

    h.hello();

    expect(h.written).toHaveLength(before);
  });

  it('dispatch_metodoDesconocido_methodNotFoundYSigueAbierta', () => {
    const h = harness();
    h.hello();

    h.send({ jsonrpc: '2.0', id: 2, method: 'session.destroy' });

    expect(h.lines()[1]!.error.code).toBe(HostErrorCode.MethodNotFound);
    expect(h.isEnded()).toBe(false);
  });

  it.each([
    ['snapshotSinSessionId', 'session.snapshot', {}],
    ['sendConCampoDeMas', 'session.send', { sessionId: 's1', text: 'x', cwd: '/' }],
    ['sendConAdjuntos', 'session.send', { sessionId: 's1', text: 'x', attachments: [] }],
    ['respuestaConDecisionRara', 'session.answerPermission', { sessionId: 's1', requestId: 'r', decision: { behavior: 'maybe' } }],
    ['respuestaConUpdatedInputNoObjeto', 'session.answerPermission', { sessionId: 's1', requestId: 'r', decision: { behavior: 'allow', updatedInput: 'rm' } }],
    ['elicitationSinAccion', 'session.answerElicitation', { sessionId: 's1', requestId: 'r' }],
    ['unsubscribeSinId', 'session.unsubscribe', {}],
  ])('dispatch_%s_invalidParamsSinTocarElCoordinador', (_name, method, params) => {
    const h = harness();
    h.hello();

    h.send({ jsonrpc: '2.0', id: 2, method, params });

    expect(h.lines()[1]!.error.code).toBe(HostErrorCode.InvalidParams);
    expect(h.isEnded()).toBe(false);
    for (const fn of Object.values(h.sessions)) expect(fn).not.toHaveBeenCalled();
  });

  it('dispatch_peticionSinId_seEjecutaYNoSeResponde', () => {
    const h = harness();
    h.hello();

    h.send({ jsonrpc: '2.0', method: 'session.interrupt', params: { sessionId: 's1' } });

    expect(h.sessions.interrupt).toHaveBeenCalledWith('s1');
    expect(h.lines()).toHaveLength(1);
  });

  it('dispatch_sesionInexistente_unknownSessionSinCerrar', () => {
    const h = harness({ sessions: { snapshot: vi.fn(() => { throw new Error('Sesion inexistente: zz'); }) } });
    h.hello();

    h.send({ jsonrpc: '2.0', id: 2, method: 'session.snapshot', params: { sessionId: 'zz' } });

    expect(h.lines()[1]!.error).toEqual({ code: HostErrorCode.UnknownSession, message: 'Sesion inexistente: zz' });
    expect(h.isEnded()).toBe(false);
  });

  it('toErrorBody_userFacingError_mensajeLimpioSinMarca', () => {
    const h = harness({ sessions: { snapshot: vi.fn(() => { throw new UserFacingError(localized('errors.engine.sessionMissing', { sessionId: 'zz' })); }) } });
    h.hello();

    h.send({ jsonrpc: '2.0', id: 2, method: 'session.snapshot', params: { sessionId: 'zz' } });

    const error = h.lines()[1]!.error as { code: number; message: string };
    expect(error.code).toBe(HostErrorCode.UnknownSession);
    expect(error.message.startsWith('Sesion inexistente:')).toBe(true);
    expect(error.message).not.toContain('{');
    expect(error.message).not.toContain('⁣');
  });

  it('dispatch_falloDelCoordinador_internalConSuMensaje', () => {
    const h = harness({ sessions: { interrupt: vi.fn(() => { throw new Error('motor caído'); }) } });
    h.hello();

    h.send({ jsonrpc: '2.0', id: 2, method: 'session.interrupt', params: { sessionId: 's1' } });

    expect(h.lines()[1]!.error).toEqual({ code: HostErrorCode.Internal, message: 'motor caído' });
  });
});

describe('HostConnection — métodos', () => {
  it('sessions.list_devuelveLasInstantaneas', () => {
    const h = harness();
    h.hello();

    h.send({ jsonrpc: '2.0', id: 2, method: 'sessions.list' });

    expect(h.lines()[1]!.result).toEqual({ sessions: [SNAPSHOT] });
  });

  it('session.send_texto_llegaAlCoordinadorYDevuelveElRecibo', () => {
    const h = harness();
    h.hello();

    h.send({ jsonrpc: '2.0', id: 2, method: 'session.send', params: { sessionId: 's1', text: 'hola', commandId: 'k' } });

    expect(h.sessions.send).toHaveBeenCalledWith({ sessionId: 's1', text: 'hola', commandId: 'k' });
    expect(h.lines()[1]!.result).toEqual({ status: 'accepted', commandId: 'k' });
  });

  it('session.answerPermission_decisionValida_llegaAlCoordinador', () => {
    const h = harness();
    h.hello();

    h.send({ jsonrpc: '2.0', id: 2, method: 'session.answerPermission', params: { sessionId: 's1', requestId: 'r1', decision: { behavior: 'deny', message: 'no' } } });

    expect(h.sessions.answerPermission).toHaveBeenCalledWith('s1', 'r1', { behavior: 'deny', message: 'no' });
    expect(h.lines()[1]!.result).toEqual({ status: 'accepted' });
  });

  it('session.subscribe_devuelveInstantaneaYLosEventosLlegaanComoNotificaciones', () => {
    const h = harness();
    h.hello();

    h.send({ jsonrpc: '2.0', id: 2, method: 'session.subscribe', params: { sessionId: 's1' } });
    h.sinks[0]!.sink(EVENT);

    const [, subscribed, pushed] = h.lines();
    expect(subscribed!.result).toEqual({ subscriptionId: 'sub-1', snapshot: SNAPSHOT });
    expect(pushed).toEqual({ jsonrpc: '2.0', method: 'event', params: { subscriptionId: 'sub-1', ...EVENT } });
  });

  // F3.3: el host habla 1.1 y el evento lleva `localized` Y el campo de siempre ya traducido.
  const NOTICE: SequencedSessionEvent = { ...EVENT, event: { kind: 'notice', localized: localized('events.runtime.nothingToCompact') } };
  const pushedEvent = (protocol: string) => {
    const h = harness();
    h.hello({ protocol });
    h.send({ jsonrpc: '2.0', id: 2, method: 'session.subscribe', params: { sessionId: 's1' } });
    h.sinks[0]!.sink(NOTICE);
    return h.lines().at(-1)!.params.event;
  };

  it('pushEvent_clienteProtocolo10_recibeTextoTraducido', () => {
    expect(pushedEvent('1.0')).toMatchObject({ kind: 'notice', text: 'No hay nada que compactar todavía.' });
  });

  it('pushEvent_clienteProtocolo11_recibeLocalized', () => {
    const event = pushedEvent('1.1');

    expect(event.localized.key).toBe('events.runtime.nothingToCompact');
    expect(event.text).toBe('No hay nada que compactar todavía.');
  });

  it('session.unsubscribe_suscripcionViva_laSueltaYNoLlegaMas', () => {
    const h = harness();
    h.hello();
    h.send({ jsonrpc: '2.0', id: 2, method: 'session.subscribe', params: { sessionId: 's1' } });

    h.send({ jsonrpc: '2.0', id: 3, method: 'session.unsubscribe', params: { subscriptionId: 'sub-1' } });

    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
    expect(h.lines()[2]!.result).toEqual({ released: true });
  });

  it('session.unsubscribe_idDesconocido_releasedFalse', () => {
    const h = harness();
    h.hello();

    h.send({ jsonrpc: '2.0', id: 2, method: 'session.unsubscribe', params: { subscriptionId: 'nada' } });

    expect(h.lines()[1]!.result).toEqual({ released: false });
  });

  it('closed_conSuscripciones_lasSueltaTodas', () => {
    const h = harness();
    h.hello();
    h.send({ jsonrpc: '2.0', id: 2, method: 'session.subscribe', params: { sessionId: 's1' } });
    h.send({ jsonrpc: '2.0', id: 3, method: 'session.subscribe', params: { sessionId: 's1' } });

    h.connection.closed();

    expect(h.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('onClosed_laSesionTermina_laSuscripcionSeSueltaUnaVez', () => {
    const h = harness();
    h.hello();
    h.send({ jsonrpc: '2.0', id: 2, method: 'session.subscribe', params: { sessionId: 's1' } });

    h.sinks[0]!.onClosed();
    h.connection.closed();

    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('pushEvent_consumidorLento_cierraLaConexion', () => {
    const h = harness();
    h.hello();
    h.send({ jsonrpc: '2.0', id: 2, method: 'session.subscribe', params: { sessionId: 's1' } });
    h.setBuffered(MAX_BUFFERED_BYTES + 1);

    h.sinks[0]!.sink(EVENT);

    expect(h.lines().at(-1)!.error.code).toBe(HostErrorCode.SlowConsumer);
    expect(h.isEnded()).toBe(true);
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

const challenge = (h: ReturnType<typeof harness>, params: unknown, id = 9) =>
  h.send({ jsonrpc: '2.0', id, method: 'host.challenge', params });

describe('HostConnection — reto (F7.1)', () => {
  it('challenge_antesDelHello_respondeLaPruebaYNoCierra', () => {
    const h = harness();

    challenge(h, { nonce: NONCE });

    expect(h.lines()[0]!.result).toEqual({ proof: challengeProof(TOKEN, NONCE) });
    expect(h.isEnded()).toBe(false);
  });

  it('challenge_seguidoDeHello_aceptaElHello', () => {
    const h = harness();

    challenge(h, { nonce: NONCE });
    h.hello();

    expect(h.lines()[1]!.result.protocol).toBe(HOST_PROTOCOL);
    expect(h.isEnded()).toBe(false);
  });

  it('challenge_trasElReto_otraPeticionSigueSinAutenticar', () => {
    const h = harness();

    challenge(h, { nonce: NONCE });
    h.send({ jsonrpc: '2.0', id: 2, method: 'sessions.list' });

    expect(h.lines()[1]!.error.code).toBe(HostErrorCode.NotAuthenticated);
    expect(h.isEnded()).toBe(true);
  });

  it('challenge_segundoReto_invalidRequestYCierra', () => {
    const h = harness();

    challenge(h, { nonce: NONCE });
    challenge(h, { nonce: NONCE }, 10);

    expect(h.lines()[1]!.error.code).toBe(HostErrorCode.InvalidRequest);
    expect(h.isEnded()).toBe(true);
  });

  it('challenge_sinId_invalidRequestYCierra', () => {
    const h = harness();

    h.send({ jsonrpc: '2.0', method: 'host.challenge', params: { nonce: NONCE } });

    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.InvalidRequest);
    expect(h.lines()[0]!.id).toBeNull();
    expect(h.isEnded()).toBe(true);
  });

  it.each([
    { nonce: 'A'.repeat(64) },
    { nonce: '0'.repeat(63) },
    { nonce: 7 },
    {},
    { nonce: NONCE, extra: 1 },
  ])('challenge_nonceInvalido_invalidParamsYCierra %j', (params) => {
    const h = harness();

    challenge(h, params);

    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.InvalidParams);
    expect(h.isEnded()).toBe(true);
    expect(h.written.join('')).not.toContain(TOKEN);
  });

  it('challenge_despuesDelHello_methodNotFoundYSigueAbierta', () => {
    const h = harness();

    h.hello();
    challenge(h, { nonce: NONCE });

    expect(h.lines()[1]!.error.code).toBe(HostErrorCode.MethodNotFound);
    expect(h.isEnded()).toBe(false);
  });

  it('challenge_respuesta_noContieneElToken', () => {
    const h = harness();

    challenge(h, { nonce: NONCE });

    expect(h.written.join('')).not.toContain(TOKEN);
  });

  it('hello_sinReto_sigueAceptandose', () => {
    const h = harness();

    h.hello();

    expect(h.lines()[0]!.result.protocol).toBe(HOST_PROTOCOL);
  });
});

describe('HostConnection — métodos 1.2', () => {
  const CREATE = { commandId: '6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b', provider: 'claude', accountId: '/h/.claude', cwd: '/x', trust: { acknowledged: false } };
  const call = (h: ReturnType<typeof harness>, method: string, params?: unknown) => {
    h.send({ jsonrpc: '2.0', id: 2, method, ...(params === undefined ? {} : { params }) });
    return h.lines()[1]!;
  };

  it('hostInfo_devuelveProtocoloModoYCapacidades', () => {
    const h = harness();
    h.hello();

    const reply = call(h, 'host.info');

    expect(reply.result).toMatchObject({ protocol: HOST_PROTOCOL, mode: 'gui' });
    expect(reply.result.capabilities).toContain('session.create');
    expect(reply.result.capabilities).not.toContain('session.rewind');
  });

  it('sessionCreate_llegaAlControlYDevuelveSuResultado', () => {
    const h = harness();
    h.hello();

    const reply = call(h, 'session.create', CREATE);

    expect(h.control.createSession).toHaveBeenCalledWith(CREATE);
    expect(reply.result).toEqual({ sessionId: 's9', conversationId: null });
  });

  it('sessionCreate_trustRequired_codigoPropioYSigueAbierta', () => {
    const h = harness({ control: { createSession: vi.fn(() => { throw new TrustRequiredError('/x'); }) } });
    h.hello();

    const reply = call(h, 'session.create', CREATE);

    expect(reply.error.code).toBe(HostErrorCode.TrustRequired);
    expect(reply.error.message).toContain('/x');
    expect(h.isEnded()).toBe(false);
  });

  it('sessionCreate_unknownAccount_codigoPropio', () => {
    const h = harness({ control: { createSession: vi.fn(() => { throw new UnknownAccountError('/h/.claude', 'claude'); }) } });
    h.hello();

    const reply = call(h, 'session.create', CREATE);

    expect(reply.error.code).toBe(HostErrorCode.UnknownAccount);
  });

  it('sessionCreate_parametrosInvalidos_invalidParamsSinLlamarAlControl', () => {
    const h = harness();
    h.hello();

    const reply = call(h, 'session.create', { ...CREATE, provider: 'agy' });

    expect(reply.error.code).toBe(HostErrorCode.InvalidParams);
    expect(h.control.createSession).not.toHaveBeenCalled();
  });

  it('sessionResume_conversacionViva_devuelveSuInstantanea', () => {
    const h = harness();
    h.hello();

    const reply = call(h, 'session.resume', { conversationId: 'c1' });

    expect(reply.result).toEqual(SNAPSHOT);
  });

  it('sessionResume_conversacionNoAbierta_unknownConversation', () => {
    const h = harness();
    h.hello();

    const reply = call(h, 'session.resume', { conversationId: 'otra' });

    expect(reply.error.code).toBe(HostErrorCode.UnknownConversation);
    expect(h.isEnded()).toBe(false);
  });

  it('sessionSetOption_llegaAlControl', () => {
    const h = harness();
    h.hello();

    const reply = call(h, 'session.setOption', { sessionId: 's1', key: 'model', value: 'opus' });

    expect(h.control.setOption).toHaveBeenCalledWith('s1', 'model', 'opus');
    expect(reply.result).toEqual({ applied: true });
  });

  it('sessionCancelQueued_llegaARemoveQueued', () => {
    const h = harness();
    h.hello();

    const reply = call(h, 'session.cancelQueued', { sessionId: 's1', queuedId: 'q1' });

    expect(h.sessions.removeQueued).toHaveBeenCalledWith('s1', 'q1');
    expect(reply.result).toEqual({ removed: null });
  });

  it.each([
    ['session.rewind', { sessionId: 's1', targetMessageId: 'm1', scope: 'both' }],
    ['session.updateQueued', { sessionId: 's1', queuedId: 'q1', text: 'nuevo' }],
  ])('sessionRewindYUpdateQueued_unsupportedYSigueAbierta_%s', (method, params) => {
    const h = harness();
    h.hello();

    const reply = call(h, method, params);

    expect(reply.error.code).toBe(HostErrorCode.Unsupported);
    expect(h.isEnded()).toBe(false);
  });

  it('projectsYAccountsList_devuelvenLoDelControl', () => {
    const project = { id: 'p1', name: 'P', cwd: '/x' };
    const account = { id: '/h/.claude', name: '.claude', provider: 'claude' as const, billing: 'subscription' as const };
    const h = harness({ control: { listProjects: vi.fn(() => [project]), listAccounts: vi.fn(() => [account]) } });
    h.hello();

    const projects = call(h, 'projects.list');
    h.send({ jsonrpc: '2.0', id: 3, method: 'accounts.list' });

    expect(projects.result).toEqual({ projects: [project] });
    expect(h.lines()[2]!.result).toEqual({ accounts: [account] });
  });

  it('sinHello_metodos12_notAuthenticated', () => {
    const h = harness();

    h.send({ jsonrpc: '2.0', id: 2, method: 'session.create', params: CREATE });

    expect(h.lines()[0]!.error.code).toBe(HostErrorCode.NotAuthenticated);
    expect(h.isEnded()).toBe(true);
    expect(h.control.createSession).not.toHaveBeenCalled();
  });
});
