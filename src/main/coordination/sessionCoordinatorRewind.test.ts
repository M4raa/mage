import { describe, expect, it, vi } from 'vitest';
import type { CreateSessionParams, SessionEventPayload } from '@shared/ipc';
import type { MageEvent } from '@shared/events';
import type { NativeSessionRef } from '@shared/coordination';
import { SessionCoordinator, type CoordinatedSessions, type SequencedSessionEvent } from './sessionCoordinator';

const ACCOUNT = '/home/u/.claude';
const UUID = '33333333-3333-4333-8333-333333333333';
const TIMEOUT_MS = 5_000;

// Mismos dobles que `sessionCoordinator.test.ts`, reducidos a lo que usa el rewind.
function harness(onUserMessageSent?: (ref: NativeSessionRef) => void) {
  const sinks = new Map<string, (payload: SessionEventPayload) => void>();
  const sessions: CoordinatedSessions = {
    create: vi.fn((_params: CreateSessionParams, sink: (payload: SessionEventPayload) => void) => {
      sinks.set('s1', sink);
      return 's1';
    }),
    stop: vi.fn(), sendMessage: vi.fn(), steerMessage: vi.fn(), engineRequest: vi.fn(), interrupt: vi.fn(), answerPermission: vi.fn(),
    answerElicitation: vi.fn(), stopOwnedBy: vi.fn().mockReturnValue([]), stopByConfigDir: vi.fn().mockReturnValue([]), stopAll: vi.fn(),
  };
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  let ids = 0;
  const log = vi.fn();
  const coordinator = new SessionCoordinator({
    sessions,
    index: { resolveConversation: (ref) => ({ conversationId: `conv-${ref.nativeId}`, lastSeq: 0 }), recordLastSeq: vi.fn() },
    now: () => 1, log, newId: () => `cmd-${++ids}`, alwaysAllowTools: () => [], defer: (fn) => fn(),
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    ...(onUserMessageSent === undefined ? {} : { onUserMessageSent }),
  });
  const received: SequencedSessionEvent[] = [];
  const id = coordinator.create({ accountDir: ACCOUNT, cwd: '/p', provider: 'claude' } as CreateSessionParams, (p) => received.push(p));
  const emit = (event: MageEvent) => sinks.get(id)?.({ sessionId: id, event });
  const fire = (index: number) => timers[index]!.fn();
  return { coordinator, sessions, id, received, emit, timers, fire, log };
}

const state = (value: 'idle' | 'running'): MageEvent => ({ kind: 'session_state', state: value });
const response = (requestId: string): MageEvent => ({ kind: 'engine_response', requestId, ok: true, result: { x: 1 }, error: null });

describe('SessionCoordinator — rewind (K04)', () => {
  it('rewindContext_trackedSession_returnsCwdAndState', () => {
    const h = harness();
    h.emit(state('running'));

    expect(h.coordinator.rewindContext(h.id)).toEqual({
      provider: 'claude', accountDir: ACCOUNT, cwd: '/p', nativeId: 's1', busy: true, background: false, queueLength: 0, pendingCount: 0, historyMode: null,
    });
  });

  it('engineRequest_responseArrives_resolvesAndNotFannedOut', async () => {
    const h = harness();
    const pending = h.coordinator.engineRequest(h.id, { kind: 'thread_turns', cursor: null }, TIMEOUT_MS);

    h.emit(response('cmd-1'));

    await expect(pending).resolves.toMatchObject({ kind: 'engine_response', requestId: 'cmd-1', ok: true });
    expect(h.sessions.engineRequest).toHaveBeenCalledWith('s1', 'cmd-1', { kind: 'thread_turns', cursor: null });
    expect(h.received.filter((p) => p.event.kind === 'engine_response')).toEqual([]);
    expect(h.timers[0]!.cancelled).toBe(true);
  });

  it('engineRequest_noResponse_rejectsAfterTimeout', async () => {
    const h = harness();
    const pending = h.coordinator.engineRequest(h.id, { kind: 'thread_turns', cursor: null }, TIMEOUT_MS);

    h.fire(0);

    expect(h.timers[0]!.ms).toBe(TIMEOUT_MS);
    await expect(pending).rejects.toThrow('engine_request_timeout thread_turns');
    h.emit(response('cmd-1')); // tardia: nadie la espera, solo log
    expect(h.log).toHaveBeenCalledWith('warn', expect.any(String), expect.objectContaining({ requestId: 'cmd-1' }));
  });

  it('engineRequest_sessionThrows_rejectsAndForgetsWaiter', async () => {
    const h = harness();
    vi.mocked(h.sessions.engineRequest).mockImplementationOnce(() => { throw new Error('no admite'); });

    await expect(h.coordinator.engineRequest(h.id, { kind: 'thread_turns', cursor: null }, TIMEOUT_MS)).rejects.toThrow('no admite');

    expect(h.timers[0]!.cancelled).toBe(true);
    h.emit(response('cmd-1'));
    expect(h.log).toHaveBeenCalledWith('warn', expect.any(String), expect.objectContaining({ requestId: 'cmd-1' }));
  });

  it('waitForIdle_alreadyIdle_resolvesNow', async () => {
    const h = harness();
    h.emit(state('idle'));

    await expect(h.coordinator.waitForIdle(h.id, TIMEOUT_MS)).resolves.toBeUndefined();

    expect(h.timers).toHaveLength(0);
  });

  it('waitForIdle_resultArrives_resolves', async () => {
    const h = harness();
    h.emit(state('running'));
    const idle = h.coordinator.waitForIdle(h.id, TIMEOUT_MS);

    h.emit({ kind: 'result', result: { subtype: 'success' } } as unknown as MageEvent);

    await expect(idle).resolves.toBeUndefined();
    expect(h.timers[0]!.cancelled).toBe(true);
  });

  it('waitForIdle_timeout_rejects', async () => {
    const h = harness();
    h.emit(state('running'));
    const idle = h.coordinator.waitForIdle(h.id, TIMEOUT_MS);

    h.fire(0);

    await expect(idle).rejects.toThrow('idle_timeout');
  });

  it('returnQueueToDrafts_emitsQueueReturnedAndEmptiesQueue', () => {
    const h = harness();
    h.emit(state('running'));
    h.coordinator.send({ sessionId: h.id, text: 'A', commandId: 'a' });
    h.coordinator.send({ sessionId: h.id, text: 'B', commandId: 'b' });
    h.received.length = 0;

    const returned = h.coordinator.returnQueueToDrafts(h.id);

    expect(returned.map((m) => m.text)).toEqual(['A', 'B']);
    expect(h.received.map((p) => p.event.kind)).toEqual(['queue_changed', 'queue_returned']);
    expect(h.coordinator.snapshot(h.id).queue).toEqual([]);
    expect(h.sessions.sendMessage).not.toHaveBeenCalled();
  });

  it('returnQueueToDrafts_emptyQueue_noEvents', () => {
    const h = harness();

    expect(h.coordinator.returnQueueToDrafts(h.id)).toEqual([]);
    expect(h.received).toEqual([]);
  });

  it('announce_event_goesThroughSequencedPath', () => {
    const h = harness();

    h.coordinator.announce(h.id, { kind: 'conversation_rewound', targetNativeId: UUID, action: 'rewind' });

    expect(h.received).toHaveLength(1);
    expect(h.received[0]).toMatchObject({ seq: 1, event: { kind: 'conversation_rewound', targetNativeId: UUID } });
  });

  it('relay_threadHistory_storesMode', () => {
    const h = harness();

    h.emit({ kind: 'thread_history', mode: 'paginated' });

    expect(h.coordinator.rewindContext(h.id).historyMode).toBe('paginated');
    expect(h.received.map((p) => p.event.kind)).toEqual(['thread_history']);
  });

  it('deliver_uuidCommandId_passesMessageId', () => {
    const h = harness();

    h.coordinator.send({ sessionId: h.id, text: 'hola', commandId: UUID });

    expect(h.sessions.sendMessage).toHaveBeenCalledWith('s1', 'hola', [], UUID);
  });

  it('deliver_nonUuidCommandId_noMessageId', () => {
    const h = harness();

    h.coordinator.send({ sessionId: h.id, text: 'hola', commandId: 'no-uuid' });

    expect(vi.mocked(h.sessions.sendMessage).mock.calls[0]![3]).toBeUndefined();
  });

  it('drain_passesQueuedIdAsMessageId', () => {
    const h = harness();
    h.emit(state('running'));
    h.coordinator.send({ sessionId: h.id, text: 'luego', commandId: UUID });

    h.emit({ kind: 'result', result: { subtype: 'success' } } as unknown as MageEvent);

    expect(h.sessions.sendMessage).toHaveBeenCalledWith('s1', 'luego', [], UUID);
  });

  it('deliver_callsOnUserMessageSent', () => {
    const sent = vi.fn();
    const h = harness(sent);

    h.coordinator.send({ sessionId: h.id, text: 'hola', commandId: 'c1' });

    expect(sent).toHaveBeenCalledWith({ provider: 'claude', accountDir: ACCOUNT, nativeId: 's1' });
  });

  it('deliver_engineThrows_doesNotCallOnUserMessageSent', () => {
    const sent = vi.fn();
    const h = harness(sent);
    vi.mocked(h.sessions.sendMessage).mockImplementationOnce(() => { throw new Error('stdin cerrado'); });

    expect(() => h.coordinator.send({ sessionId: h.id, text: 'hola', commandId: 'c1' })).toThrow('stdin cerrado');

    expect(sent).not.toHaveBeenCalled();
  });
});
