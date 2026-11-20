import { describe, expect, it, vi } from 'vitest';
import { BrowserPopouts, type PopoutWindow } from './browserPopout';
import { BrowserControlError, type BrowserHandle } from './browserRegistry';
import { ViewPlacement } from './viewPlacement';

const BOUNDS = { x: 0, y: 40, width: 800, height: 560 };

// Ventana falsa con sus oyentes: `fire('close')` simula que el usuario la cierra.
function fakeWindow() {
  const listeners = new Map<string, (() => void)[]>();
  const state = { destroyed: false };
  const fire = (event: string): void => {
    for (const listener of listeners.get(event) ?? []) listener();
  };
  const window = {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    isDestroyed: () => state.destroyed,
    once: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    }),
    close: vi.fn(() => {
      fire('close');
      state.destroyed = true;
      fire('closed');
    }),
    focus: vi.fn(),
  };
  return { window: window as PopoutWindow & typeof window, state, fire };
}

function setup() {
  const handle = { view: {}, setBounds: vi.fn(), setVisible: vi.fn() } as unknown as BrowserHandle;
  const parking = fakeWindow();
  const placement = new ViewPlacement<PopoutWindow>(() => parking.window);
  const created: ReturnType<typeof fakeWindow>[] = [];
  const createWindow = vi.fn((_sessionId: string, _title: string) => {
    const made = fakeWindow();
    created.push(made);
    return made.window;
  });
  const registry = { get: vi.fn((sessionId: string) => (sessionId === 'A' ? handle : null)), notifyChange: vi.fn() };
  const popouts = new BrowserPopouts({ registry, placement, createWindow });
  return { handle, parking, placement, created, createWindow, registry, popouts };
}

describe('BrowserPopouts', () => {
  it('popOut_open_createsWindowDetachesAndNotifies', () => {
    const { popouts, placement, handle, created, createWindow, registry } = setup();

    popouts.popOut('A', 'Mi conversación');

    expect(createWindow).toHaveBeenCalledWith('A', 'Mi conversación');
    expect(placement.detachedWindowOf(handle)).toBe(created[0]?.window);
    expect(registry.notifyChange).toHaveBeenCalledTimes(1);
  });

  it('popOut_alreadyOut_focusesSameWindow', () => {
    const { popouts, created, createWindow } = setup();
    popouts.popOut('A', 't');

    popouts.popOut('A', 't');

    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(created[0]?.window.focus).toHaveBeenCalledTimes(1);
  });

  it('popOut_noBrowser_browserNotOpen', () => {
    const { popouts, createWindow } = setup();

    expect(() => popouts.popOut('B', 't')).toThrow(BrowserControlError);
    expect(createWindow).not.toHaveBeenCalled();
  });

  it('userClosesWindow_viewBackToParkingAlive', () => {
    const { popouts, placement, handle, created, parking, registry } = setup();
    popouts.popOut('A', 't');
    placement.show(handle, created[0]!.window, BOUNDS);

    created[0]!.window.close();

    expect(placement.detachedWindowOf(handle)).toBeNull();
    expect(created[0]!.window.contentView.removeChildView).toHaveBeenCalledWith(handle.view);
    expect(parking.window.contentView.addChildView).toHaveBeenCalledWith(handle.view);
    expect(registry.notifyChange).toHaveBeenCalledTimes(2);
  });

  it('popIn_out_bringsBackAndClosesWindowOnce', () => {
    const { popouts, placement, handle, created, registry } = setup();
    popouts.popOut('A', 't');
    placement.show(handle, created[0]!.window, BOUNDS);

    popouts.popIn('A');

    expect(placement.detachedWindowOf(handle)).toBeNull();
    expect(created[0]!.window.close).toHaveBeenCalledTimes(1);
    expect(registry.notifyChange).toHaveBeenCalledTimes(2);
  });

  it('popIn_notOut_noop', () => {
    const { popouts, registry } = setup();

    popouts.popIn('A');

    expect(registry.notifyChange).not.toHaveBeenCalled();
  });

  it('forget_out_closesWindowWithoutRescuing', () => {
    const { popouts, placement, handle, created, parking } = setup();
    popouts.popOut('A', 't');
    placement.show(handle, created[0]!.window, BOUNDS);

    popouts.forget(handle);

    expect(created[0]!.window.close).toHaveBeenCalledTimes(1);
    expect(parking.window.contentView.addChildView).not.toHaveBeenCalled();
    expect(placement.detachedWindowOf(handle)).toBeNull();
  });

  it('forget_notOut_onlyForgetsPlacement', () => {
    const { popouts, placement, handle, parking } = setup();
    placement.ensureHosted(handle);

    popouts.forget(handle);

    expect(parking.window.contentView.removeChildView).toHaveBeenCalledWith(handle.view);
  });
});
