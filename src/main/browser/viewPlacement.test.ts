import { describe, expect, it, vi } from 'vitest';
import { HIDDEN_DEFAULT_BOUNDS, ViewPlacement, type PlacementHandle, type PlacementWindow } from './viewPlacement';

const BOUNDS = { x: 10, y: 20, width: 300, height: 200 };

function fakeWindow() {
  let closedListener: (() => void) | null = null;
  const state = { destroyed: false };
  const window = {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    isDestroyed: () => state.destroyed,
    once: vi.fn((_event: 'closed', listener: () => void) => {
      closedListener = listener;
    }),
  };
  return { window: window as PlacementWindow & typeof window, state, close: () => closedListener?.() };
}

function fakeHandle() {
  return { view: {}, setBounds: vi.fn(), setVisible: vi.fn() } as unknown as PlacementHandle & {
    setBounds: ReturnType<typeof vi.fn>;
    setVisible: ReturnType<typeof vi.fn>;
  };
}

describe('ViewPlacement', () => {
  it('show_firstTime_addsBoundsVisible', () => {
    const placement = new ViewPlacement();
    const { window } = fakeWindow();
    const handle = fakeHandle();

    placement.show(handle, window, BOUNDS);

    expect(window.contentView.addChildView).toHaveBeenCalledWith(handle.view);
    expect(handle.setBounds).toHaveBeenCalledWith(BOUNDS);
    expect(handle.setVisible).toHaveBeenCalledWith(true);
  });

  it('show_sameWindow_noReAdd', () => {
    const placement = new ViewPlacement();
    const { window } = fakeWindow();
    const handle = fakeHandle();

    placement.show(handle, window, BOUNDS);
    placement.show(handle, window, { ...BOUNDS, width: 400 });

    expect(window.contentView.addChildView).toHaveBeenCalledTimes(1);
    expect(window.contentView.removeChildView).not.toHaveBeenCalled();
    expect(handle.setBounds).toHaveBeenLastCalledWith({ ...BOUNDS, width: 400 });
  });

  it('show_otherWindow_movesView', () => {
    const placement = new ViewPlacement();
    const first = fakeWindow();
    const second = fakeWindow();
    const handle = fakeHandle();

    placement.show(handle, first.window, BOUNDS);
    placement.show(handle, second.window, BOUNDS);

    expect(first.window.contentView.removeChildView).toHaveBeenCalledWith(handle.view);
    expect(second.window.contentView.addChildView).toHaveBeenCalledWith(handle.view);
  });

  it('show_oldWindowDestroyed_noRemove', () => {
    const placement = new ViewPlacement();
    const first = fakeWindow();
    const second = fakeWindow();
    const handle = fakeHandle();

    placement.show(handle, first.window, BOUNDS);
    first.state.destroyed = true;
    placement.show(handle, second.window, BOUNDS);

    expect(first.window.contentView.removeChildView).not.toHaveBeenCalled();
    expect(second.window.contentView.addChildView).toHaveBeenCalledTimes(1);
  });

  it('hide_placed_invisible', () => {
    const placement = new ViewPlacement();
    const { window } = fakeWindow();
    const handle = fakeHandle();
    placement.show(handle, window, BOUNDS);

    placement.hide(handle);

    expect(handle.setVisible).toHaveBeenLastCalledWith(false);
  });

  it('hide_notPlaced_noop', () => {
    const placement = new ViewPlacement();
    const handle = fakeHandle();

    placement.hide(handle);

    expect(handle.setVisible).not.toHaveBeenCalled();
  });

  it('ensureHosted_noFallback_noop', () => {
    const placement = new ViewPlacement();
    const handle = fakeHandle();

    placement.ensureHosted(handle, null);

    expect(handle.setBounds).not.toHaveBeenCalled();
    expect(handle.setVisible).not.toHaveBeenCalled();
  });

  it('ensureHosted_fallback_hiddenDefaultBounds', () => {
    const placement = new ViewPlacement();
    const { window } = fakeWindow();
    const handle = fakeHandle();

    placement.ensureHosted(handle, window);

    expect(window.contentView.addChildView).toHaveBeenCalledWith(handle.view);
    expect(handle.setBounds).toHaveBeenCalledWith(HIDDEN_DEFAULT_BOUNDS);
    expect(handle.setVisible).toHaveBeenCalledWith(false);
  });

  it('ensureHosted_alreadyPlaced_noop', () => {
    const placement = new ViewPlacement();
    const first = fakeWindow();
    const fallback = fakeWindow();
    const handle = fakeHandle();
    placement.show(handle, first.window, BOUNDS);

    placement.ensureHosted(handle, fallback.window);

    expect(fallback.window.contentView.addChildView).not.toHaveBeenCalled();
    expect(handle.setVisible).not.toHaveBeenCalledWith(false);
  });

  it('forget_removesFromWindow', () => {
    const placement = new ViewPlacement();
    const { window } = fakeWindow();
    const handle = fakeHandle();
    placement.show(handle, window, BOUNDS);

    placement.forget(handle);
    placement.hide(handle);

    expect(window.contentView.removeChildView).toHaveBeenCalledWith(handle.view);
    expect(handle.setVisible).not.toHaveBeenCalledWith(false);
  });

  it('windowClosed_forgetsHost', () => {
    const placement = new ViewPlacement();
    const first = fakeWindow();
    const second = fakeWindow();
    const handle = fakeHandle();
    placement.show(handle, first.window, BOUNDS);

    first.close();
    placement.show(handle, second.window, BOUNDS);

    expect(first.window.contentView.removeChildView).not.toHaveBeenCalled();
    expect(second.window.contentView.addChildView).toHaveBeenCalledTimes(1);
  });
});
