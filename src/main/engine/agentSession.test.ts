import { describe, expect, it } from 'vitest';
import { AgentSession, type SpawnFn } from './agentSession';
import type { ProviderAdapter } from './providerAdapter';
import { emitLine, fakeAdapter, FakeChild, harness, written } from './agentSession.harness';

describe('AgentSession ciclo de vida', () => {
  it('start_twice_throws', () => {
    const h = harness();
    h.session.start();

    expect(() => h.session.start()).toThrow(/ya arrancada/i);
  });

  it('processLine_normalizedEvents_areEmitted', () => {
    const h = harness();
    h.session.start();

    emitLine(h.children[0]!, [{ kind: 'assistant_text', text: 'hola' }]);

    expect(h.events).toEqual([{ kind: 'assistant_text', text: 'hola' }]);
  });

  it('processLine_invalidJson_emitsErrorWithoutKillingTheFlow', () => {
    const h = harness();
    h.session.start();

    h.children[0]!.stdout.emit('data', 'no es json\n');
    emitLine(h.children[0]!, [{ kind: 'assistant_text', text: 'sigo vivo' }]);

    expect(h.events[0]).toMatchObject({ kind: 'error' });
    expect(h.events[1]).toEqual({ kind: 'assistant_text', text: 'sigo vivo' });
  });

  // El CLI spawnea nietos (servidores MCP por stdio, procesos de `Bash`, hooks). En Windows `kill()`
  // solo mata al hijo directo, asi que sin recorrer el arbol esos nietos quedarian huerfanos.
  it('stop_terminaElArbolCompleto_noSoloElHijoDirecto', () => {
    const h = harness();
    h.session.start();

    h.session.stop();

    expect(h.treeKills).toEqual([{ command: 'taskkill', args: ['/PID', '4242', '/T', '/F'] }]);
    expect(h.children[0]!.stdin.end).toHaveBeenCalledTimes(1);
  });

  it('stop_sinHaberArrancado_noIntentaMatarNada', () => {
    const h = harness();

    expect(() => h.session.stop()).not.toThrow();
    expect(h.treeKills).toEqual([]);
  });

  // stop() se llama en rutas de cierre (cerrar pestaña, salir de la app): si el stream ya esta
  // destruido no puede tumbar el resto de la limpieza.
  it('stop_conStdinYaCerrado_terminaElArbolIgualmente', () => {
    const h = harness();
    h.session.start();
    h.children[0]!.stdin.end.mockImplementation(() => {
      throw new Error('write after end');
    });

    expect(() => h.session.stop()).not.toThrow();
    expect(h.treeKills).toHaveLength(1);
  });
});

describe('AgentSession protocolo de control (D2/D3)', () => {
  it('start_registraLosHooksAlArrancarYPideElContexto', () => {
    // El CLI no emite su init hasta recibir algo por stdin: el initialize es lo primero que se manda.
    // Detras, el desglose de contexto (P-028, punto 7): el CLI 2.1.284 lo contesta sin turno.
    const h = harness();
    h.session.start();

    expect(written(h.children[0]!)).toEqual([
      { type: 'control_request', request_id: 'own-init', request: { subtype: 'initialize' } },
      { type: 'control_request', request_id: 'own-ctx', request: { subtype: 'get_context_usage' } },
    ]);
  });

  it('hookFired_respondeAlCliConSuRequestId', () => {
    // Obligatorio: el CLI bloquea la sesion esperando esta respuesta hasta el timeout del hook.
    const h = harness();
    h.session.start();

    emitLine(h.children[0]!, [
      { kind: 'hook_fired', requestId: 'req-7', event: 'Stop', detail: null },
    ]);

    expect(written(h.children[0]!)).toContainEqual({ subtype: 'hook_response', requestId: 'req-7' });
  });

  it('result_pideElDesgloseDeContexto', () => {
    const h = harness();
    h.session.start();

    emitLine(h.children[0]!, [
      { kind: 'result', result: { subtype: 'success', isError: false, numTurns: 1 } },
    ]);

    expect(written(h.children[0]!)).toContainEqual({
      type: 'control_request',
      request_id: 'own-ctx',
      request: { subtype: 'get_context_usage' },
    });
  });

  it('result_pideContextoYCatalogoDeComandos_enEseOrden', () => {
    // 2.2: el refresco del catalogo al cerrar turno es lo que hace que un `/reload-plugins` o un plugin
    // instalado a mitad de sesion aparezca sin reiniciar nada.
    const h = harness();
    h.session.start();
    const before = written(h.children[0]!).length;

    emitLine(h.children[0]!, [
      { kind: 'result', result: { subtype: 'success', isError: false, numTurns: 1 } },
    ]);

    const afterResult = written(h.children[0]!).slice(before);
    expect(afterResult).toEqual([
      { type: 'control_request', request_id: 'own-ctx', request: { subtype: 'get_context_usage' } },
      { type: 'control_request', request_id: 'own-init', request: { subtype: 'initialize' } },
    ]);
  });

  it('result_sinEncodeInitialize_noEscribeElCatalogo', () => {
    // Los adapters por gateway no tienen `initialize`: la peticion simplemente no se hace.
    const { adapter, plans } = fakeAdapter();
    const sinInitialize: ProviderAdapter = { ...adapter, encodeInitialize: undefined };
    const h = harness({ adapter: sinInitialize, plans });
    h.session.start();

    emitLine(h.children[0]!, [
      { kind: 'result', result: { subtype: 'success', isError: false, numTurns: 1 } },
    ]);

    expect(written(h.children[0]!)).not.toContainEqual({
      type: 'control_request',
      request_id: 'own-init',
      request: { subtype: 'initialize' },
    });
  });

  it('hookFired_conElProcesoYaMuerto_noIntentaEscribir', () => {
    // Un hook que llega justo cuando el proceso murio no debe petar por escribir en un stdin cerrado.
    const h = harness();
    h.session.start();
    const child = h.children[0]!;
    child.exit(1, null);

    expect(() =>
      emitLine(child, [{ kind: 'hook_fired', requestId: 'req-8', event: 'Stop', detail: null }]),
    ).not.toThrow();
  });

  it('controlError_deUnaPeticionPropia_noEnsuciaLaConversacion', () => {
    // Un CLI que no soporte `initialize` lo rechazaria en CADA arranque: el usuario acabaria con un error
    // rojo por conversacion por una peticion de telemetria que no pidio. Se queda en el log.
    const h = harness();
    h.session.start();
    const sent = written(h.children[0]!)[0] as { request_id?: string };
    const requestId = sent.request_id ?? 'sin-id';

    emitLine(h.children[0]!, [{ kind: 'control_error', requestId, message: 'subtype no soportado' }]);

    expect(h.events).toEqual([]);
  });

  it('controlError_deUnaPeticionDelUsuario_seConvierteEnErrorVisible', () => {
    // Un set_model o un interrupt rechazado SI le importa al usuario: lo pidio el.
    const h = harness();
    h.session.start();

    emitLine(h.children[0]!, [
      { kind: 'control_error', requestId: 'no-es-mio', message: 'modelo desconocido' },
    ]);

    expect(h.events).toEqual([
      { kind: 'error', message: 'El CLI rechazo una peticion de control: modelo desconocido' },
    ]);
  });

  it('start_trasStop_vuelveAHabilitarElReinicioAutomatico', () => {
    // `stopping` se quedaba en true para siempre: una instancia reutilizada no se reiniciaria nunca.
    const h = harness();
    h.session.start();
    h.session.stop();

    h.session.start();
    h.children[1]!.exit(1, null);

    expect(h.events.some((e) => e.kind === 'session_restarting')).toBe(true);
  });

  it('stopTask_conSoporte_escribeLaPeticionDeEseSubagente', () => {
    const h = harness();
    h.session.start();

    h.session.stopTask('a19e');

    expect(written(h.children[0]!)).toContainEqual({ stopTask: 'a19e' });
  });

  it('stopTask_adapterSinSoporte_lanzaConElTaskId', () => {
    const { adapter } = fakeAdapter();
    const { encodeStopTask: _sin, ...sinStopTask } = adapter;
    const session = new AgentSession({
      adapter: sinStopTask,
      params: { sessionId: 's1', accountDir: '/home/u/.claude', model: 'sonnet', cwd: '/proj' },
      emit: () => undefined,
      spawn: () => new FakeChild() as unknown as ReturnType<SpawnFn>,
    });
    session.start();

    expect(() => session.stopTask('a19e')).toThrow(/a19e/);
  });

  it('adapterSinSoporteDeControl_noMandaNada', () => {
    // Los adapters por gateway no declaran estos metodos: la sesion debe arrancar igual, sin hooks.
    const { adapter } = fakeAdapter();
    const minimal: ProviderAdapter = {
      auth: adapter.auth,
      buildSpawnPlan: adapter.buildSpawnPlan,
      encodeUserMessage: adapter.encodeUserMessage,
      encodePermissionResponse: adapter.encodePermissionResponse,
      encodeInterrupt: adapter.encodeInterrupt,
      encodeSetModel: adapter.encodeSetModel,
      encodeSetPermissionMode: adapter.encodeSetPermissionMode,
      normalize: adapter.normalize,
    };
    const children: FakeChild[] = [];
    const session = new AgentSession({
      adapter: minimal,
      params: { sessionId: 's1', accountDir: '/home/u/.claude', model: 'sonnet', cwd: '/proj' },
      emit: () => undefined,
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child as unknown as ReturnType<SpawnFn>;
      },
    });

    session.start();

    expect(written(children[0]!)).toEqual([]);
  });
});
