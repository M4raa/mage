import { describe, expect, it, vi } from 'vitest';
import type { SessionListener } from '../coordination/sessionCoordinator';
import { closeFromWindow, WindowAttachments, type AttachTarget } from './windowAttachments';

const CHANNEL = 'session:event';

function setup() {
  const listeners: SessionListener[] = [];
  const unsubscribe = vi.fn();
  const snapshot = { sessionId: 's1', lastSeq: 4 };
  const coordinator = {
    subscribe: vi.fn((_id: string, listener: SessionListener) => { listeners.push(listener); return { snapshot, unsubscribe }; }),
    snapshot: vi.fn(() => snapshot),
  };
  const attachments = new WindowAttachments({ coordinator: coordinator as never, eventChannel: CHANNEL });
  return { attachments, coordinator, listeners, unsubscribe, snapshot };
}

function makeTarget(id = 7) {
  let destroyed = false;
  let onDestroyed: () => void = () => undefined;
  const send = vi.fn();
  const target: AttachTarget = {
    id,
    isDestroyed: () => destroyed,
    send,
    onceDestroyed: (fn) => { onDestroyed = fn; },
  };
  return { target, send, destroy: () => { destroyed = true; onDestroyed(); }, markDestroyedOnly: () => { destroyed = true; } };
}

const payload = { sessionId: 's1', seq: 5, event: { kind: 'state' } } as never;

describe('WindowAttachments', () => {
  it('attach_firstTime_subscribesAndReturnsSnapshot', () => {
    const { attachments, coordinator, snapshot } = setup();

    const result = attachments.attach(makeTarget().target, 's1');

    expect(result).toBe(snapshot);
    expect(coordinator.subscribe).toHaveBeenCalledTimes(1);
    expect(attachments.isAttached(7, 's1')).toBe(true);
  });

  it('attach_sameWindowTwice_doesNotDuplicateEvents', () => {
    const { attachments, coordinator, listeners } = setup();
    const window = makeTarget();

    attachments.attach(window.target, 's1');
    attachments.attach(window.target, 's1');
    listeners[0]?.sink(payload);

    expect(coordinator.subscribe).toHaveBeenCalledTimes(1);
    expect(window.send).toHaveBeenCalledTimes(1);
    expect(window.send).toHaveBeenCalledWith(CHANNEL, payload);
  });

  it('attach_eventAfterDestroyed_notSent', () => {
    const { attachments, listeners } = setup();
    const window = makeTarget();
    attachments.attach(window.target, 's1');

    window.markDestroyedOnly();
    listeners[0]?.sink(payload);

    expect(window.send).not.toHaveBeenCalled();
  });

  it('destroyed_detachesAllOfThatWindowOnly', () => {
    const { attachments, unsubscribe } = setup();
    const doomed = makeTarget(7);
    const other = makeTarget(8);
    attachments.attach(doomed.target, 's1');
    attachments.attach(doomed.target, 's2');
    attachments.attach(other.target, 's1');

    doomed.destroy();

    expect(unsubscribe).toHaveBeenCalledTimes(2);
    expect(attachments.isAttached(7, 's1')).toBe(false);
    expect(attachments.isAttached(7, 's2')).toBe(false);
    expect(attachments.isAttached(8, 's1')).toBe(true);
  });

  it('sessionClosed_forgetsAttachment', () => {
    const { attachments, listeners } = setup();
    attachments.attach(makeTarget().target, 's1');

    listeners[0]?.onClosed();

    expect(attachments.isAttached(7, 's1')).toBe(false);
  });

  it('detach_doesNotStopSession', () => {
    const { attachments, coordinator, unsubscribe } = setup();
    attachments.attach(makeTarget().target, 's1');

    expect(attachments.detach(7, 's1')).toBe(true);
    expect(attachments.detach(7, 's1')).toBe(false);

    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(Object.keys(coordinator).sort()).toEqual(['snapshot', 'subscribe']);
  });
});

describe('closeFromWindow', () => {
  const receipt = { background: true };
  const deps = (adopted: boolean, others: number) => ({
    attachments: { detach: vi.fn().mockReturnValue(adopted) },
    coordinator: { subscriberCount: vi.fn().mockReturnValue(others), close: vi.fn().mockReturnValue(receipt) },
  });

  it('closeFromWindow_adoptedWithOtherSubscriber_onlyDetaches', () => {
    const d = deps(true, 1);

    expect(closeFromWindow(d, 7, 's1')).toEqual({ background: false });
    expect(d.coordinator.close).not.toHaveBeenCalled();
  });

  it('closeFromWindow_adoptedAlone_closes', () => {
    const d = deps(true, 0);

    expect(closeFromWindow(d, 7, 's1')).toBe(receipt);
    expect(d.coordinator.close).toHaveBeenCalledWith('s1');
  });

  it('closeFromWindow_notAdopted_closes', () => {
    const d = deps(false, 3);

    expect(closeFromWindow(d, 7, 's1')).toBe(receipt);
    expect(d.coordinator.close).toHaveBeenCalledWith('s1');
  });
});
