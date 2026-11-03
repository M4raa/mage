import { describe, expect, it, vi } from 'vitest';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import type { AnswerReceipt, PendingRequest } from '@shared/coordination';
import { IpcChannel } from '@shared/ipc';
import { registerWidgetIpc } from './widgetIpc';

const WIDGET_ID = 7;
const OTHER_ID = 1;

const permission = (): PendingRequest => ({
  kind: 'permission',
  request: { requestId: 'r1', toolUseId: 't1', toolName: 'Bash', input: { command: 'ls' }, description: null, requiresUserInteraction: false, displayName: null },
});

function setup(options: { pending?: readonly PendingRequest[]; queue?: readonly unknown[]; owner?: number | null | undefined; receipt?: AnswerReceipt } = {}) {
  const listeners = new Map<string, (event: never, arg: unknown) => unknown>();
  const register = (channel: string, listener: (event: never, arg: unknown) => unknown): void => {
    listeners.set(channel, listener);
  };
  const sessions = {
    ownerOf: vi.fn().mockReturnValue('owner' in options ? options.owner : 1),
    snapshot: vi.fn().mockReturnValue({ pending: options.pending ?? [permission()], queue: options.queue ?? [] }),
    answerPermission: vi.fn().mockReturnValue(options.receipt ?? { status: 'accepted' }),
    interrupt: vi.fn().mockReturnValue([]),
  };
  const prefs = { load: vi.fn().mockReturnValue({ expanded: false, doNotDisturb: false }), update: vi.fn((p) => ({ expanded: false, doNotDisturb: false, ...p })) };
  const openSession = vi.fn();
  const onPrefsChanged = vi.fn();
  registerWidgetIpc({
    handle: register as never,
    on: register as never,
    sessions: sessions as never,
    prefs,
    isWidget: (id) => id === WIDGET_ID,
    openSession,
    onPrefsChanged,
  });
  const call = (channel: string, arg: unknown, senderId: number = WIDGET_ID): unknown => {
    const listener = listeners.get(channel);
    if (listener === undefined) throw new Error(`canal sin registrar: ${channel}`);
    return listener({ sender: { id: senderId } } as unknown as IpcMainInvokeEvent & IpcMainEvent as never, arg);
  };
  return { sessions, prefs, openSession, onPrefsChanged, call };
}

const ANSWER = { sessionId: 's1', requestId: 'r1', choice: { kind: 'allow' } };
const REJECTED = { status: 'rejected', reason: 'already_answered' };

describe('registerWidgetIpc', () => {
  it('answer_fromOtherWindow_throws', () => {
    const t = setup();
    expect(() => t.call(IpcChannel.WidgetAnswer, ANSWER, OTHER_ID)).toThrow('solo lo puede usar la ventana del widget');
    expect(t.sessions.answerPermission).toHaveBeenCalledTimes(0);
  });

  it('answer_invalidInput_throws', () => {
    const t = setup();
    expect(() => t.call(IpcChannel.WidgetAnswer, { sessionId: 's1' })).toThrow('Entrada inválida');
  });

  it('answer_sessionGone_rejected', () => {
    const t = setup({ owner: undefined });
    expect(t.call(IpcChannel.WidgetAnswer, ANSWER)).toEqual(REJECTED);
    expect(t.sessions.snapshot).toHaveBeenCalledTimes(0);
  });

  it('answer_requestAlreadyAnswered_rejected', () => {
    const t = setup({ pending: [] });
    expect(t.call(IpcChannel.WidgetAnswer, ANSWER)).toEqual(REJECTED);
    expect(t.sessions.answerPermission).toHaveBeenCalledTimes(0);
  });

  it('answer_allow_callsCoordinatorWithDecision', () => {
    const t = setup();
    expect(t.call(IpcChannel.WidgetAnswer, ANSWER)).toEqual({ status: 'accepted' });
    expect(t.sessions.answerPermission).toHaveBeenCalledWith('s1', 'r1', { behavior: 'allow' });
  });

  it('answer_coordinatorRejectsSecond_returnsRejected', () => {
    const t = setup({ receipt: { status: 'rejected', reason: 'already_answered' } });
    expect(t.call(IpcChannel.WidgetAnswer, ANSWER)).toEqual(REJECTED);
  });

  it('interrupt_withQueue_throws', () => {
    const t = setup({ queue: [{ id: 'q1' }] });
    expect(() => t.call(IpcChannel.WidgetInterrupt, 's1')).toThrow('Con mensajes en cola');
    expect(t.sessions.interrupt).toHaveBeenCalledTimes(0);
  });

  it('interrupt_withoutQueue_callsCoordinator', () => {
    const t = setup();
    expect(t.call(IpcChannel.WidgetInterrupt, 's1')).toBeUndefined();
    expect(t.sessions.interrupt).toHaveBeenCalledWith('s1');
  });

  it('interrupt_sessionGone_noop', () => {
    const t = setup({ owner: undefined });
    expect(t.call(IpcChannel.WidgetInterrupt, 's1')).toBeUndefined();
    expect(t.sessions.interrupt).toHaveBeenCalledTimes(0);
  });

  it('openSession_fromWidget_callsDep', () => {
    const t = setup();
    t.call(IpcChannel.WidgetOpenSession, 's1');
    expect(t.openSession).toHaveBeenCalledWith('s1');
  });

  it('openSession_fromOtherWindow_throws', () => {
    const t = setup();
    expect(() => t.call(IpcChannel.WidgetOpenSession, 's1', OTHER_ID)).toThrow('solo lo puede usar la ventana del widget');
    expect(t.openSession).toHaveBeenCalledTimes(0);
  });

  it('setPrefs_fromAnyWindow_updatesAndNotifies', () => {
    const t = setup();
    const result = t.call(IpcChannel.WidgetSetPrefs, { doNotDisturb: true }, OTHER_ID);
    expect(t.prefs.update).toHaveBeenCalledWith({ doNotDisturb: true });
    expect(t.onPrefsChanged).toHaveBeenCalledWith(result);
  });

  it('setPrefs_unknownKey_throws', () => {
    const t = setup();
    expect(() => t.call(IpcChannel.WidgetSetPrefs, { foo: true })).toThrow();
  });
});
