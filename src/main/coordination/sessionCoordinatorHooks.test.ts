import { describe, expect, it, vi } from 'vitest';
import type { CreateSessionParams, SessionEventPayload } from '@shared/ipc';
import type { MageEvent } from '@shared/events';
import { SessionCoordinator, type CoordinatedSessions } from './sessionCoordinator';

// Los ganchos de main del coordinador (eventos y envíos) y el booleano de «Continuar al restablecerse».
function harness(hooks: { onSessionEvent?: (sessionId: string, event: MageEvent) => void; onSend?: (sessionId: string) => void } = {}) {
  const sinks = new Map<string, (payload: SessionEventPayload) => void>();
  const sessions: CoordinatedSessions = {
    create: vi.fn((_params: CreateSessionParams, sink: (payload: SessionEventPayload) => void) => { sinks.set('s1', sink); return 's1'; }),
    stop: vi.fn(), sendMessage: vi.fn(), steerMessage: vi.fn(), engineRequest: vi.fn(), interrupt: vi.fn(), answerPermission: vi.fn(),
    answerElicitation: vi.fn(), stopOwnedBy: vi.fn().mockReturnValue([]), stopByConfigDir: vi.fn().mockReturnValue([]), stopAll: vi.fn(),
  };
  const log = vi.fn();
  let ids = 0;
  const coordinator = new SessionCoordinator({
    sessions, index: { resolveConversation: (ref) => ({ conversationId: `conv-${ref.nativeId}`, lastSeq: 0 }), recordLastSeq: vi.fn() },
    now: () => 0, log, newId: () => `id-${++ids}`, alwaysAllowTools: () => [], defer: (fn) => fn(), setTimer: () => () => undefined, ...hooks,
  });
  const id = coordinator.create({ accountDir: '/a', cwd: '/p', provider: 'claude' } as CreateSessionParams, () => undefined);
  const emit = (event: MageEvent) => sinks.get(id)?.({ sessionId: id, event });
  return { coordinator, sessions, id, emit, log };
}

const RATE_LIMIT: MageEvent = { kind: 'rate_limit', summary: 'límite', resetsAtMs: null };

describe('SessionCoordinator: onSessionEvent', () => {
  it('onSessionEvent_eventoDelMotor_llegaConSuSesion', () => {
    const onSessionEvent = vi.fn();
    const h = harness({ onSessionEvent });
    h.emit(RATE_LIMIT);
    expect(onSessionEvent).toHaveBeenCalledWith('s1', RATE_LIMIT);
  });
  it('onSessionEvent_quienLanza_noCortaAlResto', () => {
    const h = harness({ onSessionEvent: () => { throw new Error('boom'); } });
    expect(() => h.emit(RATE_LIMIT)).not.toThrow();
    expect(h.log).toHaveBeenCalledWith('warn', 'onSessionEvent fallo', expect.objectContaining({ sessionId: 's1', error: 'boom' }));
  });
  it('onSessionEvent_sinGancho_noHaceNada', () => {
    expect(() => harness().emit(RATE_LIMIT)).not.toThrow();
  });
});

describe('SessionCoordinator: onSend', () => {
  it('onSend_envioAceptado_avisa', () => {
    const onSend = vi.fn();
    const h = harness({ onSend });
    h.coordinator.send({ sessionId: h.id, text: 'hola', commandId: 'c1' });
    expect(onSend).toHaveBeenCalledWith('s1');
  });
  it('onSend_mismoCommandIdRepetido_noAvisaDeNuevo', () => {
    const onSend = vi.fn();
    const h = harness({ onSend });
    h.coordinator.send({ sessionId: h.id, text: 'hola', commandId: 'c1' });
    h.coordinator.send({ sessionId: h.id, text: 'hola', commandId: 'c1' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
  it('onSend_envioQueElMotorRechaza_noAvisa', () => {
    const onSend = vi.fn();
    const h = harness({ onSend });
    vi.mocked(h.sessions.sendMessage).mockImplementation(() => { throw new Error('motor caído'); });
    expect(() => h.coordinator.send({ sessionId: h.id, text: 'hola' })).toThrow('motor caído');
    expect(onSend).not.toHaveBeenCalled();
  });
  it('onSend_quienLanza_noDeshaceElEnvio', () => {
    const h = harness({ onSend: () => { throw new Error('boom'); } });
    expect(h.coordinator.send({ sessionId: h.id, text: 'hola', commandId: 'c1' })).toEqual({ status: 'accepted', commandId: 'c1' });
    expect(h.sessions.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('SessionCoordinator: resumeOnReset', () => {
  it('resumeOnResetOf_sesionNueva_apagada', () => {
    const h = harness();
    expect(h.coordinator.resumeOnResetOf(h.id)).toBe(false);
  });
  it('setResumeOnReset_enciendeYApaga', () => {
    const h = harness();
    h.coordinator.setResumeOnReset(h.id, true);
    expect(h.coordinator.resumeOnResetOf(h.id)).toBe(true);
    h.coordinator.setResumeOnReset(h.id, false);
    expect(h.coordinator.resumeOnResetOf(h.id)).toBe(false);
  });
  it('resumeOnResetOf_sesionQueNoSeSigue_apagadaSinLanzar', () => {
    const h = harness();
    expect(h.coordinator.resumeOnResetOf('otra')).toBe(false);
  });
  it('setResumeOnReset_sesionQueNoSeSigue_lanza', () => {
    const h = harness();
    expect(() => h.coordinator.setResumeOnReset('otra', true)).toThrow();
  });
  it('resumeOnResetOf_trasPararLaSesion_apagada', () => {
    const h = harness();
    h.coordinator.setResumeOnReset(h.id, true);
    h.coordinator.stop(h.id);
    expect(h.coordinator.resumeOnResetOf(h.id)).toBe(false);
  });
});
