import { describe, expect, it, vi } from 'vitest';
import { ChatController } from './chatController.mjs';
import { createMessages } from './messages.mjs';

const messages = createMessages('es');
const BASE_SNAPSHOT = { sessionId: 's1', conversationId: 'c1', provider: 'claude', lastSeq: 5, state: 'idle', queue: [], pending: [], background: false };

function fakeLink(snapshotOverrides = {}, responses = {}) {
  const snapshot = { ...BASE_SNAPSHOT, ...snapshotOverrides };
  const table = { 'session.subscribe': { subscriptionId: 'sub-1', snapshot }, 'session.interrupt': { queued: [] }, 'session.send': { status: 'accepted', commandId: 'x' }, ...responses };
  const rpc = {
    call: vi.fn(async (method) => table[method]),
    onNotification: vi.fn((handler) => { rpc.handler = handler; }),
    close: vi.fn(),
    handler: null,
  };
  return { rpc, socket: {}, hello: {} };
}

function setup({ snapshot, responses, reconnect } = {}) {
  const link = fakeLink(snapshot, responses);
  const output = [];
  let clock = 0;
  const deps = {
    link, sessionId: 's1', messages, write: (text) => output.push(text), now: () => clock, exit: vi.fn(),
    reconnect: reconnect ?? vi.fn(), setMuted: vi.fn(),
  };
  const controller = new ChatController(deps);
  return { controller, link, deps, output, setNow: (ms) => { clock = ms; }, text: () => output.join('') };
}

const callsTo = (link, method) => link.rpc.call.mock.calls.filter(([name]) => name === method);
const emit = (link, event, seq = 6, subscriptionId = 'sub-1') => link.rpc.handler('event', { subscriptionId, seq, event });
const permissionRequest = (overrides = {}) => ({
  kind: 'permission_request',
  request: { requestId: 'r1', toolUseId: 't', toolName: 'Bash', input: {}, description: 'ls', requiresUserInteraction: false, displayName: null, ...overrides },
});

describe('ChatController: señales de D4', () => {
  it('ctrlC_conTurno_interrumpeUnaVez', async () => {
    const { controller, link, deps } = setup({ snapshot: { state: 'running' } });
    await controller.attach();

    await controller.onCtrlC();

    expect(callsTo(link, 'session.interrupt')).toEqual([['session.interrupt', { sessionId: 's1' }]]);
    expect(deps.exit).not.toHaveBeenCalled();
  });

  it('ctrlC_dosVecesEnMenosDe2s_saleSinSegundaInterrupcion', async () => {
    const { controller, link, deps, setNow } = setup({ snapshot: { state: 'running' } });
    await controller.attach();

    setNow(1000);
    await controller.onCtrlC();
    setNow(2500);
    await controller.onCtrlC();

    expect(callsTo(link, 'session.interrupt')).toHaveLength(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('ctrlC_sinTurno_saleSinLlamarAlHost', async () => {
    const { controller, link, deps } = setup();
    await controller.attach();

    await controller.onCtrlC();

    expect(callsTo(link, 'session.interrupt')).toHaveLength(0);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it.each([
    ['exit', (controller) => controller.onLine('exit')],
    ['ctrlD', (controller) => controller.onEndOfInput()],
  ])('exitYCtrlD_salenSinCancelar (%s)', async (_name, act) => {
    const { controller, link, deps } = setup({ snapshot: { state: 'running' } });
    await controller.attach();

    await act(controller);

    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(callsTo(link, 'session.interrupt')).toHaveLength(0);
  });

  it('onKilled_saleSinLlamarANada', async () => {
    const { controller, link, deps } = setup({ snapshot: { state: 'running' } });
    await controller.attach();
    const callsBefore = link.rpc.call.mock.calls.length;

    controller.onKilled();

    expect(link.rpc.call.mock.calls.length).toBe(callsBefore);
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('eventoSessionState_actualizaElTurno', async () => {
    const { controller, link } = setup();
    await controller.attach();

    emit(link, { kind: 'session_state', state: 'running' });
    await controller.onCtrlC();

    expect(callsTo(link, 'session.interrupt')).toHaveLength(1);
  });

  it('eventoDeOtraSuscripcion_seIgnora', async () => {
    const { controller, link, text } = setup();
    await controller.attach();

    emit(link, { kind: 'stream_delta', text: 'ajeno' }, 7, 'sub-otra');

    expect(text()).not.toContain('ajeno');
  });

  it('evento_streamDelta_seEscribeTalCual', async () => {
    const { controller, link, text } = setup();
    await controller.attach();

    emit(link, { kind: 'stream_delta', text: 'hola mundo' });

    expect(text()).toContain('hola mundo');
  });
});

describe('ChatController: permisos y envío', () => {
  it('permiso_respuestaS_allow', async () => {
    const { controller, link } = setup({ responses: { 'session.answerPermission': { status: 'accepted' } } });
    await controller.attach();
    emit(link, permissionRequest());

    await controller.onLine('s');

    expect(callsTo(link, 'session.answerPermission')).toEqual([
      ['session.answerPermission', { sessionId: 's1', requestId: 'r1', decision: { behavior: 'allow' } }],
    ]);
  });

  it('permiso_respuestaN_denyConMensaje', async () => {
    const { controller, link } = setup({ responses: { 'session.answerPermission': { status: 'accepted' } } });
    await controller.attach();
    emit(link, permissionRequest());

    await controller.onLine('n');

    expect(callsTo(link, 'session.answerPermission')[0][1].decision).toEqual({ behavior: 'deny', message: 'Denegado desde la terminal' });
  });

  it('permiso_respuestaRara_preguntaOtraVezSinLlamar', async () => {
    const { controller, link, text } = setup();
    await controller.attach();
    emit(link, permissionRequest());

    await controller.onLine('quizá');

    expect(callsTo(link, 'session.answerPermission')).toHaveLength(0);
    expect(text()).toContain(messages.answerYesNo());
  });

  it('permiso_enLaInstantanea_sePreguntaAlUnirse', async () => {
    const pending = [{ kind: 'permission', request: permissionRequest().request }];
    const { controller, text } = setup({ snapshot: { pending } });

    await controller.attach();

    expect(text()).toContain('¿Permitir Bash? (ls) [s/n]');
  });

  it('pregunta_requiresUserInteraction_noSeContestaEnLaTerminal', async () => {
    const { controller, link, text } = setup();
    await controller.attach();
    emit(link, permissionRequest({ requiresUserInteraction: true }));

    await controller.onLine('s');

    expect(text()).toContain(messages.answerInMage());
    expect(callsTo(link, 'session.answerPermission')).toHaveLength(0);
    expect(callsTo(link, 'session.send')).toHaveLength(1);
    expect(callsTo(link, 'session.send')[0][1].text).toBe('s');
  });

  it('envio_encolado_avisa', async () => {
    const { controller, text } = setup({ responses: { 'session.send': { status: 'queued', commandId: 'x' } } });
    await controller.attach();

    await controller.onLine('hola');

    expect(text()).toContain(messages.queued());
  });

  it('envio_errorDelHost_loEscribeYNoQuedaIncierto', async () => {
    const { controller, link, text } = setup();
    await controller.attach();
    link.rpc.call.mockImplementationOnce(async () => { throw Object.assign(new Error('mensaje largo'), { code: -32602 }); });

    await controller.onLine('hola');

    expect(text()).toContain('[error] mensaje largo');
  });
});

describe('ChatController: reconexión de D2', () => {
  // `session.send` no resuelve nunca: la conexión cae antes de la respuesta.
  async function withUncertainSend(options = {}) {
    const newLink = fakeLink({ lastSeq: 9 });
    const reconnect = options.reconnect ?? vi.fn(async () => newLink);
    const context = setup({ reconnect });
    context.link.rpc.call.mockImplementation(async (method) => {
      if (method === 'session.send') return new Promise(() => {});
      return { subscriptionId: 'sub-1', snapshot: { ...BASE_SNAPSHOT } };
    });
    await context.controller.attach();
    void context.controller.onLine('hola');
    return { ...context, newLink, reconnect };
  }

  it('desconexion_conEnvioSinRespuesta_preguntaYNoReenviaSolo', async () => {
    const { controller, link, newLink, text } = await withUncertainSend();
    const firstId = callsTo(link, 'session.send')[0][1].commandId;

    await controller.onDisconnected();

    expect(text()).toContain(messages.reconnected(4));
    expect(text()).toContain(messages.resendAsk('hola'));
    expect(callsTo(newLink, 'session.send')).toHaveLength(0);

    await controller.onLine('s');

    expect(callsTo(newLink, 'session.send')).toEqual([['session.send', { sessionId: 's1', text: 'hola', commandId: firstId }]]);
  });

  it('desconexion_respuestaN_noReenvia', async () => {
    const { controller, newLink } = await withUncertainSend();
    await controller.onDisconnected();

    await controller.onLine('n');

    expect(callsTo(newLink, 'session.send')).toHaveLength(0);
  });

  it('desconexion_reconexionAgotada_sale1', async () => {
    const { controller, deps, text } = await withUncertainSend({ reconnect: vi.fn(async () => { throw new Error('agotada'); }) });

    await controller.onDisconnected();

    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(text()).toContain('[error] agotada');
  });

  it('desconexion_trasSalir_noReconecta', async () => {
    const { controller, reconnect } = await withUncertainSend();

    controller.leave();
    await controller.onDisconnected();

    expect(reconnect).not.toHaveBeenCalled();
  });

  it('desconexion_sesionCerradaAlResuscribir_saleConAviso', async () => {
    const closedLink = fakeLink();
    closedLink.rpc.call.mockImplementation(async () => { throw Object.assign(new Error('desconocida'), { code: -32004 }); });
    const { controller, deps, text } = await withUncertainSend({ reconnect: vi.fn(async () => closedLink) });

    await controller.onDisconnected();

    expect(text()).toContain(messages.sessionClosed());
    expect(deps.exit).toHaveBeenCalledWith(0);
  });
});

const QUESTION_INPUT = { questions: [{ question: '¿Rojo o azul?', header: 'Color', options: [{ label: 'Rojo', description: 'cálido' }, { label: 'Azul' }], multiSelect: false }, { question: '¿Qué frutas?', header: 'Frutas', options: [{ label: 'Pera', description: '' }, { label: 'Uva', description: '' }, { label: 'Kiwi', description: '' }], multiSelect: true }] };
const formRequest = (properties, required = []) => ({ kind: 'elicitation_request', request: { requestId: 'e1', server: 'srv', message: 'Datos', mode: 'form', schema: { type: 'object', properties, required } } });
const urlRequest = (requestId) => ({ kind: 'elicitation_request', request: { requestId, server: 'srv', message: 'Entra', mode: 'url', url: `https://ejemplo.test/${requestId}`, elicitationId: requestId } });

describe('ChatController: subscription.closed', () => {
  it('subscriptionClosed_propia_avisaYSale0', async () => {
    const { controller, link, deps, text } = setup();
    await controller.attach();

    link.rpc.handler('subscription.closed', { subscriptionId: 'sub-1' });

    expect(text()).toContain(messages.sessionClosed());
    expect(deps.exit).toHaveBeenCalledWith(0);
  });

  it('subscriptionClosed_deOtra_seIgnora', async () => {
    const { controller, link, deps } = setup();
    await controller.attach();

    link.rpc.handler('subscription.closed', { subscriptionId: 'sub-otra' });

    expect(deps.exit).not.toHaveBeenCalled();
  });
});

describe('ChatController: preguntas y elicitations en la terminal', () => {
  it('pregunta_seContestaEnLaTerminal', async () => {
    const { controller, link, text } = setup();
    await controller.attach();
    emit(link, permissionRequest({ requiresUserInteraction: true, toolName: 'AskUserQuestion', input: QUESTION_INPUT }));
    expect(text()).toContain('[pregunta 1 de 2] Color: ¿Rojo o azul?');

    await controller.onLine('2');
    await controller.onLine('1,3');

    expect(callsTo(link, 'session.answerPermission')).toHaveLength(1);
    expect(callsTo(link, 'session.answerPermission')[0][1].decision.updatedInput.answers).toEqual({ '¿Rojo o azul?': 'Azul', '¿Qué frutas?': 'Pera, Kiwi' });
    expect(callsTo(link, 'session.send')).toHaveLength(0);
  });

  it('pregunta_respuestaInvalida_repiteSinLlamar', async () => {
    const { controller, link, text } = setup();
    await controller.attach();
    emit(link, permissionRequest({ requiresUserInteraction: true, toolName: 'AskUserQuestion', input: QUESTION_INPUT }));

    await controller.onLine('7');

    expect(text()).toContain(messages.questionInvalid());
    expect(callsTo(link, 'session.answerPermission')).toHaveLength(0);
  });

  it('elicitationForm_campoACampo_accept', async () => {
    const { controller, link } = setup();
    await controller.attach();
    emit(link, formRequest({ nombre: { type: 'string' }, edad: { type: 'integer' } }, ['nombre']));

    await controller.onLine('Ana');
    await controller.onLine('');

    expect(callsTo(link, 'session.answerElicitation')).toEqual([
      ['session.answerElicitation', { sessionId: 's1', requestId: 'e1', action: 'accept', content: { nombre: 'Ana' } }],
    ]);
  });

  it('elicitationForm_password_silenciaYDevuelveElEco', async () => {
    const { controller, link, deps } = setup();
    await controller.attach();

    emit(link, formRequest({ clave: { type: 'string', format: 'password' } }, ['clave']));

    expect(deps.setMuted).toHaveBeenLastCalledWith(true);
    await controller.onLine('secreta');
    expect(deps.setMuted).toHaveBeenLastCalledWith(false);
  });

  it('elicitationUrl_n_decline', async () => {
    const { controller, link, text } = setup();
    await controller.attach();
    emit(link, urlRequest('u1'));
    expect(text()).toContain('https://ejemplo.test/u1');

    await controller.onLine('n');

    expect(callsTo(link, 'session.answerElicitation')).toEqual([['session.answerElicitation', { sessionId: 's1', requestId: 'u1', action: 'decline' }]]);
  });

  it('dosPeticiones_seMuestranDeUnaEnUna', async () => {
    const { controller, link, text } = setup();
    await controller.attach();
    emit(link, permissionRequest({ requestId: 'r1', description: 'primera' }));
    emit(link, permissionRequest({ requestId: 'r2', description: 'segunda' }));
    expect(text()).toContain('primera');
    expect(text()).not.toContain('segunda');

    await controller.onLine('s');
    expect(text()).toContain('segunda');
    await controller.onLine('n');

    const calls = callsTo(link, 'session.answerPermission');
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toMatchObject({ requestId: 'r1', decision: { behavior: 'allow' } });
    expect(calls[1][1]).toMatchObject({ requestId: 'r2', decision: { behavior: 'deny' } });
  });

  it('contestadaEnLaVentana_seQuitaYPasaALaSiguiente', async () => {
    const { controller, link, text } = setup();
    await controller.attach();
    emit(link, urlRequest('e1'));
    emit(link, urlRequest('e2'));

    emit(link, { kind: 'elicitation_resolved', requestId: 'e1', action: 'accept' });

    expect(text()).toContain(messages.answeredElsewhere());
    expect(text()).toContain('https://ejemplo.test/e2');
    await controller.onLine('s');
    expect(callsTo(link, 'session.answerElicitation')).toEqual([['session.answerElicitation', { sessionId: 's1', requestId: 'e2', action: 'accept' }]]);
  });
});

describe('ChatController: mensajes escritos durante una reconexión', () => {
  function withManualReconnect() {
    const newLink = fakeLink({ lastSeq: 9 });
    let finish;
    const reconnect = vi.fn(() => new Promise((resolve) => { finish = () => resolve(newLink); }));
    const context = setup({ reconnect });
    return { ...context, newLink, finish: () => finish() };
  }

  it('lineaDuranteLaReconexion_noSeEnviaYSeOfreceDespues', async () => {
    const { controller, link, newLink, finish, text } = withManualReconnect();
    await controller.attach();
    const disconnected = controller.onDisconnected();

    await controller.onLine('hola');

    expect(text()).toContain(messages.notSentOffline());
    expect(callsTo(link, 'session.send')).toHaveLength(0);
    finish();
    await disconnected;
    expect(text()).toContain(messages.unsentDuringReconnect(1));
    expect(text()).toContain(messages.resendUnsentAsk('hola'));
    expect(callsTo(newLink, 'session.send')).toHaveLength(0);

    await controller.onLine('s');

    expect(callsTo(newLink, 'session.send')).toHaveLength(1);
    expect(callsTo(newLink, 'session.send')[0][1].text).toBe('hola');
  });

  it('exitDuranteLaReconexion_saleSinGuardarlo', async () => {
    const { controller, link, deps, text } = withManualReconnect();
    await controller.attach();
    void controller.onDisconnected();

    await controller.onLine('exit');

    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(text()).not.toContain(messages.notSentOffline());
    expect(callsTo(link, 'session.send')).toHaveLength(0);
  });

  it('lineaDuranteLaReconexion_respuestaN_noEnvia', async () => {
    const { controller, newLink, finish } = withManualReconnect();
    await controller.attach();
    const disconnected = controller.onDisconnected();
    await controller.onLine('hola');
    finish();
    await disconnected;

    await controller.onLine('n');

    expect(callsTo(newLink, 'session.send')).toHaveLength(0);
  });

  it('desconexion_limpiaLaPeticionActiva', async () => {
    const newLink = fakeLink({ lastSeq: 9 });
    const { controller, link, text } = setup({ reconnect: vi.fn(async () => newLink) });
    await controller.attach();
    emit(link, permissionRequest());
    expect(text()).toContain('¿Permitir Bash?');

    await controller.onDisconnected();
    await controller.onLine('s');

    expect(callsTo(newLink, 'session.answerPermission')).toHaveLength(0);
    expect(callsTo(newLink, 'session.send')).toHaveLength(1);
    expect(callsTo(newLink, 'session.send')[0][1].text).toBe('s');
  });
});
