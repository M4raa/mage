import { describe, expect, it, vi } from 'vitest';
import type { ProviderAdapter, SteerEncoding } from './providerAdapter';
import { emitLine, fakeAdapter, harness, written } from './agentSession.harness';

function withEncode(encodeSteer: ProviderAdapter['encodeSteer']) {
  const base = fakeAdapter();
  return harness({ plans: base.plans, adapter: { ...base.adapter, encodeSteer } });
}

describe('AgentSession directo (F4.1)', () => {
  it('steerUserMessage_adapterSinEncodeSteer_lanzaConElMessageId', () => {
    const h = harness();
    h.session.start();

    expect(() => h.session.steerUserMessage('m1', 'x')).toThrow('m1');
  });

  it('steerUserMessage_adapterEscribe_escribeElPayload', () => {
    const h = withEncode((id, text): SteerEncoding => ({ kind: 'write', payload: { steer: id, text } }));
    h.session.start();

    h.session.steerUserMessage('m1', 'x');

    expect(written(h.children[0]!).at(-1)).toEqual({ steer: 'm1', text: 'x' });
  });

  it('steerUserMessage_adapterResuelve_emiteNoActiveTurnSinEscribir', () => {
    const h = withEncode((): SteerEncoding => ({ kind: 'resolved', outcome: 'no_active_turn' }));
    h.session.start();
    const before = written(h.children[0]!).length;

    h.session.steerUserMessage('m1', 'x');

    expect(written(h.children[0]!)).toHaveLength(before);
    expect(h.events.at(-1)).toEqual({ kind: 'steer_result', messageId: 'm1', outcome: 'no_active_turn' });
  });

  it('steerUserMessage_sinProceso_emiteNoActiveTurnSinLlamarAlAdapter', () => {
    const encodeSteer = vi.fn();
    const h = withEncode(encodeSteer);

    h.session.steerUserMessage('m1', 'x');

    expect(encodeSteer).not.toHaveBeenCalled();
    expect(h.events.at(-1)).toEqual({ kind: 'steer_result', messageId: 'm1', outcome: 'no_active_turn' });
  });

  // Medido en 2.1.319: el `initialize` de refresco con el hook UserPromptSubmit del directo aun sin
  // contestar hace que el CLI descarte el directo. Con uno en vuelo, el refresco espera al siguiente `result`.
  it('result_conDirectoEscritoDesdeElUltimoResult_noReenviaInitializeHastaElSiguiente', () => {
    // Arrange
    const h = withEncode((id, text): SteerEncoding => ({ kind: 'write', payload: { steer: id, text } }));
    h.session.start();
    const result = { kind: 'result', result: { subtype: 'success', isError: false, numTurns: 1 } } as const;
    const isInit = (line: unknown) => (line as { request?: { subtype?: string } }).request?.subtype === 'initialize';
    const initsBefore = written(h.children[0]!).filter(isInit).length;

    // Act
    h.session.steerUserMessage('m1', 'x');
    emitLine(h.children[0]!, [result]);
    const initsAfterFirst = written(h.children[0]!).filter(isInit).length;
    // El CLI acepta el directo (su hook) y cierra su turno.
    emitLine(h.children[0]!, [{ kind: 'hook_fired', requestId: 'h1', event: 'UserPromptSubmit', detail: null }, result]);
    const initsAfterSecond = written(h.children[0]!).filter(isInit).length;

    // Assert
    expect(initsAfterFirst).toBe(initsBefore);
    expect(initsAfterSecond).toBe(initsBefore + 1);
  });

  // P-038, MEDIDO en 2.1.319 (`spike/resume-hook-spike.mjs --mage-refresh`): al reanudar un chat con una tarea de fondo
  // muerta, el CLI emite un `result` ADELANTADO antes del hook del mensaje del usuario; refrescar ahí lo descartaba.
  it('result_adelantadoConMensajeAntesDeSuHook_noReenviaInitialize', () => {
    // Arrange
    const h = harness();
    h.session.start();
    const result = { kind: 'result', result: { subtype: 'success', isError: false, numTurns: 1 } } as const;
    const isInit = (line: unknown) => (line as { request?: { subtype?: string } }).request?.subtype === 'initialize';
    const initsBefore = written(h.children[0]!).filter(isInit).length;

    // Act
    h.session.sendUserMessage('hola');
    emitLine(h.children[0]!, [result]);
    const initsTrasAdelantado = written(h.children[0]!).filter(isInit).length;
    emitLine(h.children[0]!, [{ kind: 'hook_fired', requestId: 'h2', event: 'UserPromptSubmit', detail: null }, result]);
    const initsTrasSuTurno = written(h.children[0]!).filter(isInit).length;

    // Assert
    expect(initsTrasAdelantado).toBe(initsBefore);
    expect(initsTrasSuTurno).toBe(initsBefore + 1);
  });

  it('hookDeOtroEvento_noCuentaComoMensajeAceptado', () => {
    const h = harness();
    h.session.start();
    const result = { kind: 'result', result: { subtype: 'success', isError: false, numTurns: 1 } } as const;
    const isInit = (line: unknown) => (line as { request?: { subtype?: string } }).request?.subtype === 'initialize';
    const initsBefore = written(h.children[0]!).filter(isInit).length;

    h.session.sendUserMessage('hola');
    emitLine(h.children[0]!, [{ kind: 'hook_fired', requestId: 'h3', event: 'Stop', detail: null }, result]);

    expect(written(h.children[0]!).filter(isInit).length).toBe(initsBefore);
  });

  it('normalize_steerResultInferido_loEmiteYDejaUnWarn', () => {
    const log = vi.fn();
    const h = harness(undefined, log);
    h.session.start();

    emitLine(h.children[0]!, [{ kind: 'steer_result', messageId: 'm1', outcome: 'new_turn', inferred: true }]);

    expect(h.events).toContainEqual({ kind: 'steer_result', messageId: 'm1', outcome: 'new_turn', inferred: true });
    expect(log.mock.calls.some(([level]) => level === 'warn')).toBe(true);
  });
});
