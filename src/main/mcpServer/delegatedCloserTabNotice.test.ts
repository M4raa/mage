import { describe, expect, it, vi } from 'vitest';
import type { CreateSessionParams } from '@shared/ipc';
import { SessionCoordinator, type CoordinatedSessions } from '../coordination/sessionCoordinator';
import { CLOSE_AFTER_DONE_MS, DelegatedCloser } from './delegatedCloser';

// Cierre de una subsesión CON su pestaña abierta: la pestaña es un cliente suscrito al coordinador, y tiene que enterarse
// (`closed_by_mage`) antes de que la sesión pare, venga el cierre del plazo `onDone` o de `mage_close_session`.
function setup() {
  const sessions: CoordinatedSessions = {
    create: vi.fn(() => 's1'),
    stop: vi.fn(), sendMessage: vi.fn(), steerMessage: vi.fn(), engineRequest: vi.fn(), interrupt: vi.fn(), answerPermission: vi.fn(),
    answerElicitation: vi.fn(), stopOwnedBy: vi.fn().mockReturnValue([]), stopByConfigDir: vi.fn().mockReturnValue([]), stopAll: vi.fn(),
  };
  let ids = 0;
  const coordinator = new SessionCoordinator({
    sessions, index: { resolveConversation: (ref) => ({ conversationId: `conv-${ref.nativeId}`, lastSeq: 0 }), recordLastSeq: vi.fn() },
    now: () => 0, log: vi.fn(), newId: () => `id-${++ids}`, alwaysAllowTools: () => [], defer: (fn) => fn(), setTimer: () => () => undefined,
  });
  const id = coordinator.create({ accountDir: '/a', cwd: '/p', provider: 'claude' } as CreateSessionParams, () => undefined);
  // La pestaña: un cliente más, como la ventana que adopta la sesión.
  const tabSaw: string[] = [];
  coordinator.subscribe(id, { sink: (payload) => { tabSaw.push(payload.event.kind); }, onClosed: () => { tabSaw.push('onClosed'); } });
  let now = 0;
  const timers: (() => void)[] = [];
  const closer = new DelegatedCloser({
    now: () => now,
    setTimer: (fn) => { timers.push(fn); return () => undefined; },
    retire: vi.fn(),
    close: (sessionId) => coordinator.closeByMage(sessionId),
    excludeFromKeepAlive: vi.fn(),
    log: vi.fn(),
  });
  return { sessions, id, tabSaw, closer, timers, advance: (ms: number) => { now += ms; } };
}

describe('subsesión cerrada con su pestaña abierta', () => {
  it('cierrePorOnDone_conPestanaAbierta_cierraYAvisa', () => {
    const h = setup();
    h.closer.register(h.id, 'close');
    h.closer.turnDone(h.id, true);

    h.advance(CLOSE_AFTER_DONE_MS);
    h.timers[0]?.();

    expect(h.sessions.stop).toHaveBeenCalledWith(h.id);
    expect(h.tabSaw).toEqual(['closed_by_mage', 'onClosed']);
    expect(h.timers).toHaveLength(1);
  });

  it('mageCloseSession_conPestanaAbierta_cierraYAvisa', () => {
    const h = setup();
    h.closer.register(h.id, 'keepAlive');

    h.closer.closeNow(h.id);

    expect(h.sessions.stop).toHaveBeenCalledWith(h.id);
    expect(h.tabSaw).toEqual(['closed_by_mage', 'onClosed']);
  });
});
