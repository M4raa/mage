import { describe, expect, it, vi } from 'vitest';
import type { ConversationSnapshot } from '@shared/coordination';
import { UserFacingError, localized, renderForLog } from '@shared/i18n/localizedText';
import { createTranslator } from '@shared/i18n/translator';
import type { SequencedSessionEvent } from '../coordination/sessionCoordinator';
import { HELLO_DEADLINE_MS, HostConnection, MAX_BUFFERED_BYTES, type HostConnectionDeps, type McpTunnelHandle, type HostSessions, type HostTransport } from './hostConnection';
import type { HostControl } from './hostControl';
import type { HostMode } from './hostServer';
import { TrustRequiredError, UnknownAccountError } from './hostErrors';
import { HOST_PROTOCOL, HostErrorCode } from './hostProtocol';
import { challengeProof } from './hostToken';

const TOKEN = 'a'.repeat(64);
const NONCE = '0'.repeat(64);
const SNAPSHOT: ConversationSnapshot = { sessionId: 's1', provider: 'claude', conversationId: 'c1', nativeRef: null, lastSeq: 7, state: 'idle', queue: [], pending: [], background: false };
const EVENT: SequencedSessionEvent = { sessionId: 's1', conversationId: 'c1', seq: 8, at: 1, event: { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } } };

function harness(options: { sessions?: Partial<HostSessions>; control?: Partial<HostControl>; rewind?: Partial<HostConnectionDeps['rewind']>; maxLineBytes?: number; mode?: HostMode } = {}) {
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
    updateQueued: vi.fn(() => null),
    answerPermission: vi.fn(() => ({ status: 'accepted' as const })),
    answerElicitation: vi.fn(() => ({ status: 'accepted' as const })),
    ...options.sessions,
  };
  const control: HostControl = {
    createSession: vi.fn(() => ({ sessionId: 's9', conversationId: null })),
    setOption: vi.fn(),
    listProjects: vi.fn(() => []),
    listAccounts: vi.fn(() => []),
    createApiAccount: vi.fn(() => ({ id: '/h/k', name: 'K', provider: 'claude' as const, billing: 'api-key' as const })),
    requestQuit: vi.fn(),
    ...options.control,
  };
  const rewind: HostConnectionDeps['rewind'] = { points: vi.fn(async () => []), plan: vi.fn(), apply: vi.fn(), ...options.rewind };
  const tunnel = { receive: vi.fn(), close: vi.fn() } satisfies McpTunnelHandle;
  const mcpSends: { send: (message: Record<string, unknown>) => void }[] = [];
  const mcp: HostConnectionDeps['mcp'] = { open: vi.fn((context) => { mcpSends.push(context); return tunnel; }) };
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const log = vi.fn();
  let ids = 0;
  const connection = new HostConnection(transport, {
    sessions, control, rewind, mcp, mode: options.mode ?? 'gui', token: TOKEN, hostVersion: '0.1.3', log, newId: () => `sub-${++ids}`, translate: createTranslator('es'),
    setTimer: (fn, ms) => { const timer = { fn, ms, cancelled: false }; timers.push(timer); return () => { timer.cancelled = true; }; },
    ...(options.maxLineBytes === undefined ? {} : { maxLineBytes: options.maxLineBytes }),
  });
  const send = (message: unknown) => connection.receive(Buffer.from(`${JSON.stringify(message)}\n`));
  const lines = () => written.join('').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line) as Record<string, any>);
  const hello = (overrides: Record<string, unknown> = {}) =>
    send({ jsonrpc: '2.0', id: 1, method: 'hello', params: { protocol: HOST_PROTOCOL, client: { kind: 'terminal', version: '1' }, token: TOKEN, ...overrides } });
  return { connection, sessions, control, rewind, mcp, tunnel, mcpSends, send, lines, written, hello, sinks, unsubscribe, timers, log, isEnded: () => ended, setBuffered: (n: number) => { buffered = n; } };
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

  describe('caller (D-M6)', () => {
    const CALLER = 'ab'.repeat(32);

    it('hello_withCaller_accepted', () => {
      const h = harness();

      h.hello({ caller: CALLER });

      expect(h.lines()[0]!.result).toMatchObject({ protocol: HOST_PROTOCOL });
      expect(h.connection.callerCredential).toBe(CALLER);
    });

    it('hello_callerNotHex_invalidParams', () => {
      const h = harness();

      h.hello({ caller: 'Z'.repeat(64) });

      expect(h.lines()[0]!.error.code).toBe(HostErrorCode.InvalidParams);
      expect(h.isEnded()).toBe(true);
    });

    it('hello_withoutCaller_accepted', () => {
      const h = harness();

      h.hello();

      expect(h.lines()[0]!.result).toBeDefined();
      expect(h.connection.callerCredential).toBeNull();
    });

    it('hello_withCaller_credentialNotInAnyWrite', () => {
      const h = harness();

      h.hello({ caller: CALLER });
      h.send({ jsonrpc: '2.0', id: 2, method: 'no.existe' });

      expect(h.written.join('')).not.toContain(CALLER);
    });
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

  it('onClosed_laSesionTermina_notificaSubscriptionClosed', () => {
    const h = harness();
    h.hello();
    h.send({ jsonrpc: '2.0', id: 2, method: 'session.subscribe', params: { sessionId: 's1' } });

    h.sinks[0]!.onClosed();

    expect(h.lines().at(-1)).toEqual({ jsonrpc: '2.0', method: 'subscription.closed', params: { subscriptionId: 'sub-1' } });
    expect(h.isEnded()).toBe(false);
  });

  it('onClosed_dosVeces_notificaUnaSola', () => {
    const h = harness();
    h.hello();
    h.send({ jsonrpc: '2.0', id: 2, method: 'session.subscribe', params: { sessionId: 's1' } });

    h.sinks[0]!.onClosed();
    h.sinks[0]!.onClosed();

    expect(h.lines().filter((line) => line.method === 'subscription.closed')).toHaveLength(1);
  });

  it('onClosed_trasUnsubscribe_noNotifica', () => {
    const h = harness();
    h.hello();
    h.send({ jsonrpc: '2.0', id: 2, method: 'session.subscribe', params: { sessionId: 's1' } });
    h.send({ jsonrpc: '2.0', id: 3, method: 'session.unsubscribe', params: { subscriptionId: 'sub-1' } });

    h.sinks[0]!.onClosed();

    expect(h.lines().filter((line) => line.method === 'subscription.closed')).toHaveLength(0);
  });

  it('onClosed_conexionYaCerrada_noEscribe', () => {
    const h = harness();
    h.hello();
    h.send({ jsonrpc: '2.0', id: 2, method: 'session.subscribe', params: { sessionId: 's1' } });
    h.connection.closed();
    const before = h.written.length;

    h.sinks[0]!.onClosed();

    expect(h.written.length).toBe(before);
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
    expect(reply.result.capabilities).toContain('session.rewind');
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

  it('sessionUpdateQueued_llegaAlCoordinadorYDevuelveElMensaje', () => {
    const h = harness({ sessions: { updateQueued: vi.fn(() => ({ id: 'q1', text: 'nuevo' }) as never) } });
    h.hello();

    const reply = call(h, 'session.updateQueued', { sessionId: 's1', queuedId: 'q1', text: 'nuevo' });

    expect(h.sessions.updateQueued).toHaveBeenCalledWith('s1', 'q1', 'nuevo');
    expect(reply.result).toEqual({ updated: { id: 'q1', text: 'nuevo' } });
  });

  it('sessionUpdateQueued_noEstaEnLaCola_devuelveUpdatedNull', () => {
    const h = harness();
    h.hello();

    const reply = call(h, 'session.updateQueued', { sessionId: 's1', queuedId: 'q1', text: 'nuevo' });

    expect(reply.result).toEqual({ updated: null });
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

describe('HostConnection — métodos 1.3', () => {
  const KEY = 'sk-ant-SECRETA';
  const call = (h: ReturnType<typeof harness>, method: string, params?: unknown) => {
    h.send({ jsonrpc: '2.0', id: 2, method, ...(params === undefined ? {} : { params }) });
    return h.lines()[1]!;
  };
  const running = { listSessions: vi.fn(() => [{ ...SNAPSHOT, state: 'running' as const }]) };

  it('hostStop_conVentana_rechazaYNoSale', () => {
    const h = harness();
    h.hello();

    const reply = call(h, 'host.stop');

    expect(reply.result).toEqual({ outcome: 'refused', reason: 'gui' });
    expect(h.control.requestQuit).not.toHaveBeenCalled();
    expect(h.isEnded()).toBe(false);
  });

  it('hostStop_sinVentanaSinTrabajo_contestaStoppingYPideSalir', () => {
    const h = harness({ mode: 'headless' });
    h.hello();

    const reply = call(h, 'host.stop');

    expect(reply.result).toEqual({ outcome: 'stopping' });
    expect(h.control.requestQuit).toHaveBeenCalledTimes(1);
  });

  it('hostStop_sinVentanaConTurno_rechazaListandoSinSalir', () => {
    const h = harness({ mode: 'headless', sessions: running });
    h.hello();

    const reply = call(h, 'host.stop');

    expect(reply.result.outcome).toBe('refused');
    expect(reply.result.reason).toBe('active');
    expect(reply.result.sessions[0].sessionId).toBe('s1');
    expect(h.control.requestQuit).not.toHaveBeenCalled();
  });

  it('hostStop_sinVentanaConTurnoYForce_pideSalir', () => {
    const h = harness({ mode: 'headless', sessions: running });
    h.hello();

    const reply = call(h, 'host.stop', { force: true });

    expect(reply.result).toEqual({ outcome: 'stopping' });
    expect(h.control.requestQuit).toHaveBeenCalledTimes(1);
  });

  it('hostStop_parametroDesconocido_invalidParams', () => {
    const h = harness({ mode: 'headless' });
    h.hello();

    const reply = call(h, 'host.stop', { forzar: true });

    expect(reply.error.code).toBe(HostErrorCode.InvalidParams);
    expect(h.control.requestQuit).not.toHaveBeenCalled();
  });

  it('accountsCreate_devuelveLaCuentaSinLaClave', () => {
    const h = harness();
    h.hello();
    const params = { provider: 'claude', name: 'K', apiKey: KEY };

    const reply = call(h, 'accounts.create', params);

    expect(h.control.createApiAccount).toHaveBeenCalledWith(params);
    expect(reply.result).toEqual({ account: { id: '/h/k', name: 'K', provider: 'claude', billing: 'api-key' } });
    expect(h.written.join('')).not.toContain(KEY);
  });

  it('accountsCreate_laBovedaFalla_errorSinLaClave', () => {
    const failing = vi.fn(() => { throw new UserFacingError(localized('errors.accounts.providerNameInvalid', { name: '"K"' })); });
    const h = harness({ control: { createApiAccount: failing } });
    h.hello();

    const reply = call(h, 'accounts.create', { provider: 'claude', name: 'K', apiKey: KEY });

    expect(reply.error.code).toBe(HostErrorCode.Internal);
    expect(h.isEnded()).toBe(false);
    expect(h.written.join('')).not.toContain(KEY);
    expect(JSON.stringify(h.log.mock.calls)).not.toContain(KEY);
  });

  it('accountsCreate_proveedorAgy_invalidParamsSinCrear', () => {
    const h = harness();
    h.hello();

    const reply = call(h, 'accounts.create', { provider: 'agy', name: 'K', apiKey: KEY });

    expect(reply.error.code).toBe(HostErrorCode.InvalidParams);
    expect(h.control.createApiAccount).not.toHaveBeenCalled();
    expect(reply.error.message).not.toContain(KEY);
  });

  it('accountsCreate_claveVacia_invalidParams', () => {
    const h = harness();
    h.hello();

    const reply = call(h, 'accounts.create', { provider: 'claude', name: 'K', apiKey: '' });

    expect(reply.error.code).toBe(HostErrorCode.InvalidParams);
  });
});

describe('rewind (1.4)', () => {
  const POINT = { userIndex: 0, text: 'uno', nativeId: 'u1' };
  const APPLY = { sessionId: 's1', point: POINT, action: 'rewind', restoreFiles: false, saveCopy: false };
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
  const request = async (h: ReturnType<typeof harness>, method: string, params: unknown) => {
    h.send({ jsonrpc: '2.0', id: 2, method, params });
    await flush();
    return h.lines()[1]!;
  };

  it('rewindPoints_liveSession_repliesWithPoints', async () => {
    const points = [{ userIndex: 0, text: 'uno', nativeId: 'u1', rewindable: true }];
    const h = harness({ rewind: { points: vi.fn(async () => points) } });
    h.hello();

    const reply = await request(h, 'session.rewindPoints', { sessionId: 's1' });

    expect(h.rewind.points).toHaveBeenCalledWith('s1');
    expect(reply.result).toEqual({ points });
  });

  it('rewindPlan_validParams_delegatesToCoordinator', async () => {
    const plan = { provider: 'claude', unavailable: null, discardedMessages: 2 };
    const h = harness({ rewind: { plan: vi.fn(async () => plan as never) } });
    h.hello();
    const params = { sessionId: 's1', point: POINT, action: 'retry' };

    const reply = await request(h, 'session.rewindPlan', params);

    expect(h.rewind.plan).toHaveBeenCalledWith(params);
    expect(reply.result).toEqual(plan);
  });

  it('rewind_apply_repliesWithoutProjection', async () => {
    const result = { draft: 'uno', returnedQueue: [], filesRestored: false, copyThreadId: null, projection: { entries: [] }, retried: null };
    const h = harness({ rewind: { apply: vi.fn(async () => result as never) } });
    h.hello();

    const reply = await request(h, 'session.rewind', APPLY);

    expect(reply.result).toEqual({ draft: 'uno', returnedQueue: [], filesRestored: false, copyThreadId: null, retried: null });
    expect(reply.result).not.toHaveProperty('projection');
  });

  it('rewind_coordinatorRejectsUserFacing_repliesErrorWithSpanishText', async () => {
    const text = localized('errors.rewind.background');
    const h = harness({ rewind: { apply: vi.fn(async () => { throw new UserFacingError(text); }) } });
    h.hello();

    const reply = await request(h, 'session.rewind', APPLY);

    expect(reply.error.code).toBe(HostErrorCode.Internal);
    expect(reply.error.message).toBe(renderForLog(text));
    expect(reply.error.message).not.toContain('{');
  });

  it('rewind_negativeUserIndex_repliesInvalidParams', async () => {
    const h = harness();
    h.hello();

    const reply = await request(h, 'session.rewind', { ...APPLY, point: { ...POINT, userIndex: -1 } });

    expect(reply.error.code).toBe(HostErrorCode.InvalidParams);
    expect(h.rewind.apply).not.toHaveBeenCalled();
  });

  it('rewind_connectionClosedBeforeResolve_writesNothing', async () => {
    let resolve: (value: never) => void = () => undefined;
    const pending = new Promise<never>((r) => { resolve = r; });
    const h = harness({ rewind: { apply: vi.fn(() => pending) } });
    h.hello();
    h.send({ jsonrpc: '2.0', id: 2, method: 'session.rewind', params: APPLY });
    h.connection.closed();
    const before = h.written.length;

    resolve({ draft: '', returnedQueue: [], filesRestored: false, copyThreadId: null, projection: null, retried: null } as never);
    await flush();

    expect(h.written.length).toBe(before);
  });
});

describe('HostConnection — túnel MCP (1.5)', () => {
  const CALLER = 'cd'.repeat(32);
  const mcpHello = (h: ReturnType<typeof harness>, overrides: Record<string, unknown> = {}) => h.hello({ client: { kind: 'mcp', version: '1' }, ...overrides });

  it('hello_mcpClient_opensTunnelWithCaller', () => {
    const h = harness();

    mcpHello(h, { caller: CALLER });

    expect(h.mcp.open).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.mcp.open).mock.calls[0]![0].callerCredential).toBe(CALLER);
  });

  it('hello_terminalClient_noTunnel', () => {
    const h = harness();

    h.hello();

    expect(h.mcp.open).not.toHaveBeenCalled();
  });

  it('mcpMessage_fromMcpClient_reachesTunnel', () => {
    const h = harness();
    mcpHello(h);

    h.send({ jsonrpc: '2.0', id: 2, method: 'mcp.message', params: { message: { jsonrpc: '2.0', id: 1, method: 'tools/list' } } });

    expect(h.tunnel.receive).toHaveBeenCalledWith({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(h.lines()[1]).toMatchObject({ id: 2, result: {} });
  });

  it('mcpMessage_fromTerminal_rejected', () => {
    const h = harness();
    h.hello();

    h.send({ jsonrpc: '2.0', id: 2, method: 'mcp.message', params: { message: {} } });

    expect(h.lines()[1]!.error.message).toMatch(/solo vale para clientes mcp/);
    expect(h.tunnel.receive).not.toHaveBeenCalled();
  });

  it('tunnelSend_writesMcpMessageNotification', () => {
    const h = harness();
    mcpHello(h);

    h.mcpSends[0]!.send({ jsonrpc: '2.0', id: 1, result: {} });

    expect(h.lines()[1]).toEqual({ jsonrpc: '2.0', method: 'mcp.message', params: { message: { jsonrpc: '2.0', id: 1, result: {} } } });
  });

  it('tunnelSend_afterClose_writesNothing', () => {
    const h = harness();
    mcpHello(h);
    h.connection.closed();
    const before = h.written.length;

    h.mcpSends[0]!.send({ jsonrpc: '2.0', id: 1, result: {} });

    expect(h.written.length).toBe(before);
  });

  it('tunnelSend_slowConsumer_closesConnection', () => {
    const h = harness();
    mcpHello(h);
    h.setBuffered(MAX_BUFFERED_BYTES + 1);

    h.mcpSends[0]!.send({ jsonrpc: '2.0', id: 1, result: {} });

    expect(h.lines()[1]!.error.code).toBe(HostErrorCode.SlowConsumer);
    expect(h.isEnded()).toBe(true);
  });

  it('closed_mcpClient_closesTunnelOnce', () => {
    const h = harness();
    mcpHello(h);

    h.connection.closed();
    h.connection.closed();

    expect(h.tunnel.close).toHaveBeenCalledTimes(1);
  });
});
