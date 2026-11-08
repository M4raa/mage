import { describe, expect, it, vi } from 'vitest';
import type { ConversationSnapshot, PendingRequest } from '@shared/coordination';
import type { MageEvent } from '@shared/events';
import { foreignText } from '@shared/i18n/localizedText';
import type { WidgetSessionsPayload } from '@shared/widget';
import type { SequencedSessionEvent } from '../coordination/sessionCoordinator';
import { WidgetSessionTracker, type WidgetTrackedSessions } from './widgetSessionTracker';

type Listener = Parameters<WidgetTrackedSessions['subscribe']>[1];

const baseSnapshot = (sessionId: string, overrides: Partial<ConversationSnapshot> = {}): ConversationSnapshot => ({
  sessionId, provider: 'claude', conversationId: null, nativeRef: null, lastSeq: 0, state: 'idle', queue: [], pending: [], background: false, ...overrides,
});

const permissionPending = (requestId: string): PendingRequest => ({
  kind: 'permission',
  request: { requestId, toolUseId: 't', toolName: 'Bash', input: { command: 'ls' }, description: null, requiresUserInteraction: false, displayName: null },
});

const eventOf = (event: MageEvent): SequencedSessionEvent => ({ sessionId: 's1', event, conversationId: null, seq: 1, at: 0 });

function setup(initial: readonly ConversationSnapshot[] = [baseSnapshot('s1')]) {
  const live: ConversationSnapshot[] = [...initial];
  const listeners = new Map<string, Listener>();
  const unsubscribes = new Map<string, ReturnType<typeof vi.fn>>();
  const sessions: WidgetTrackedSessions = {
    listSessions: () => live,
    subscribe: vi.fn((id: string, listener: Listener) => {
      listeners.set(id, listener);
      const unsubscribe = vi.fn();
      unsubscribes.set(id, unsubscribe);
      return { unsubscribe };
    }),
  };
  const deferred: Array<() => void> = [];
  const cancelTimer = vi.fn();
  const payloads: WidgetSessionsPayload[] = [];
  const onNewRequest = vi.fn();
  const tracker = new WidgetSessionTracker({
    sessions,
    onChange: (payload) => payloads.push(payload),
    onNewRequest,
    defer: (fn) => deferred.push(fn),
    every: () => cancelTimer,
  });
  const flush = (): void => {
    const pending = deferred.splice(0);
    for (const fn of pending) fn();
  };
  const emitEvent = (id: string, event: MageEvent): void => listeners.get(id)?.sink(eventOf(event));
  const outcomeOf = (id: string) => payloads.at(-1)?.sessions.find((s) => s.sessionId === id)?.outcome;
  return { live, listeners, unsubscribes, sessions, tracker, flush, payloads, cancelTimer, onNewRequest, emitEvent, outcomeOf };
}

describe('WidgetSessionTracker', () => {
  it('start_twoLiveSessions_subscribesBothAndEmitsOnce', () => {
    const t = setup([baseSnapshot('s1'), baseSnapshot('s2')]);
    t.tracker.start();
    t.flush();
    expect(t.sessions.subscribe).toHaveBeenCalledTimes(2);
    expect(t.payloads).toHaveLength(1);
    expect(t.payloads[0]?.sessions).toHaveLength(2);
  });

  it('start_calledTwice_doesNotSubscribeAgain', () => {
    const t = setup();
    t.tracker.start();
    t.tracker.start();
    expect(t.sessions.subscribe).toHaveBeenCalledTimes(1);
  });

  it('sync_newSession_subscribesAndEmits', () => {
    const t = setup();
    t.tracker.start();
    t.flush();
    t.live.push(baseSnapshot('s2'));
    t.tracker.sync();
    t.flush();
    expect(t.sessions.subscribe).toHaveBeenCalledWith('s2', expect.anything());
    expect(t.payloads).toHaveLength(2);
  });

  it('sync_sessionGone_unsubscribesAndEmits', () => {
    const t = setup();
    t.tracker.start();
    t.flush();
    t.live.length = 0;
    t.tracker.sync();
    t.flush();
    expect(t.unsubscribes.get('s1')).toHaveBeenCalledTimes(1);
    expect(t.payloads.at(-1)?.sessions).toHaveLength(0);
  });

  it('onClosed_dropsSession', () => {
    const t = setup();
    t.tracker.start();
    t.flush();
    t.listeners.get('s1')?.onClosed();
    t.live.length = 0;
    t.flush();
    expect(t.unsubscribes.get('s1')).toHaveBeenCalledTimes(1);
    expect(t.payloads.at(-1)?.sessions.find((s) => s.sessionId === 's1')).toBeUndefined();
  });

  it('event_resultOk_outcomeFinished', () => {
    const t = setup();
    t.tracker.start();
    t.emitEvent('s1', { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } });
    t.flush();
    expect(t.outcomeOf('s1')).toBe('finished');
  });

  it('event_resultError_outcomeError', () => {
    const t = setup();
    t.tracker.start();
    t.emitEvent('s1', { kind: 'result', result: { isError: true, subtype: 'error_during_execution', numTurns: 1 } });
    t.flush();
    expect(t.outcomeOf('s1')).toBe('error');
  });

  it('event_errorEvent_outcomeError', () => {
    const t = setup();
    t.tracker.start();
    t.emitEvent('s1', { kind: 'error', localized: foreignText('boom') });
    t.flush();
    expect(t.outcomeOf('s1')).toBe('error');
  });

  it('event_runningAfterFinished_outcomeNone', () => {
    const t = setup();
    t.tracker.start();
    t.emitEvent('s1', { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } });
    t.emitEvent('s1', { kind: 'session_state', state: 'running' });
    t.flush();
    expect(t.outcomeOf('s1')).toBe('none');
  });

  it('event_streamDelta_doesNotEmit', () => {
    const t = setup();
    t.tracker.start();
    t.flush();
    t.emitEvent('s1', { kind: 'stream_delta', delta: { type: 'text', text: 'x' } } as unknown as MageEvent);
    t.flush();
    expect(t.payloads).toHaveLength(1);
  });

  it('event_burstOfRelevantEvents_emitsOnce', () => {
    const t = setup();
    t.tracker.start();
    t.flush();
    t.emitEvent('s1', { kind: 'session_state', state: 'running' });
    t.emitEvent('s1', { kind: 'session_state', state: 'idle' });
    t.emitEvent('s1', { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } });
    t.flush();
    expect(t.payloads).toHaveLength(2);
  });

  it('newPendingRequest_callsOnNewRequestOnce', () => {
    const t = setup();
    t.tracker.start();
    t.flush();
    t.live[0] = baseSnapshot('s1', { pending: [permissionPending('r1')] });
    t.emitEvent('s1', { kind: 'permission_cancelled', requestId: 'x' });
    t.flush();
    t.emitEvent('s1', { kind: 'session_state', state: 'requires_action' });
    t.flush();
    expect(t.onNewRequest).toHaveBeenCalledTimes(1);
  });

  it('requestResolvedThenNewOne_callsOnNewRequestAgain', () => {
    const t = setup();
    t.tracker.start();
    t.flush();
    t.live[0] = baseSnapshot('s1', { pending: [permissionPending('r1')] });
    t.emitEvent('s1', { kind: 'session_state', state: 'requires_action' });
    t.flush();
    t.live[0] = baseSnapshot('s1');
    t.emitEvent('s1', { kind: 'permission_resolved', requestId: 'r1', behavior: 'allow' });
    t.flush();
    t.live[0] = baseSnapshot('s1', { pending: [permissionPending('r2')] });
    t.emitEvent('s1', { kind: 'session_state', state: 'requires_action' });
    t.flush();
    expect(t.onNewRequest).toHaveBeenCalledTimes(2);
  });

  it('acknowledge_finished_outcomeNoneAndEmits', () => {
    const t = setup();
    t.tracker.start();
    t.emitEvent('s1', { kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1 } });
    t.flush();
    t.tracker.acknowledge('s1');
    t.flush();
    expect(t.outcomeOf('s1')).toBe('none');
    expect(t.payloads).toHaveLength(2);
  });

  it('acknowledge_unknownSession_noop', () => {
    const t = setup();
    t.tracker.start();
    t.flush();
    t.tracker.acknowledge('nope');
    t.flush();
    expect(t.payloads).toHaveLength(1);
  });

  it('stop_unsubscribesAllCancelsTimerAndIgnoresPendingDefer', () => {
    const t = setup([baseSnapshot('s1'), baseSnapshot('s2')]);
    t.tracker.start();
    t.tracker.stop();
    t.flush();
    expect(t.unsubscribes.get('s1')).toHaveBeenCalledTimes(1);
    expect(t.unsubscribes.get('s2')).toHaveBeenCalledTimes(1);
    expect(t.cancelTimer).toHaveBeenCalledTimes(1);
    expect(t.payloads).toHaveLength(0);
  });
});
