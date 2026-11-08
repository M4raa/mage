import { describe, expect, it, vi } from 'vitest';
import {
  createParkingHost,
  HIDDEN_DEFAULT_BOUNDS,
  ViewPlacement,
  type PlacementHandle,
  type PlacementWindow,
} from './viewPlacement';

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
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
    const { window } = fakeWindow();
    const handle = fakeHandle();

    placement.show(handle, window, BOUNDS);

    expect(window.contentView.addChildView).toHaveBeenCalledWith(handle.view);
    expect(handle.setBounds).toHaveBeenCalledWith(BOUNDS);
    expect(handle.setVisible).toHaveBeenCalledWith(true);
  });

  it('show_sameWindow_noReAdd', () => {
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
    const { window } = fakeWindow();
    const handle = fakeHandle();

    placement.show(handle, window, BOUNDS);
    placement.show(handle, window, { ...BOUNDS, width: 400 });

    expect(window.contentView.addChildView).toHaveBeenCalledTimes(1);
    expect(window.contentView.removeChildView).not.toHaveBeenCalled();
    expect(handle.setBounds).toHaveBeenLastCalledWith({ ...BOUNDS, width: 400 });
  });

  it('show_otherWindow_movesView', () => {
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
    const first = fakeWindow();
    const second = fakeWindow();
    const handle = fakeHandle();

    placement.show(handle, first.window, BOUNDS);
    placement.show(handle, second.window, BOUNDS);

    expect(first.window.contentView.removeChildView).toHaveBeenCalledWith(handle.view);
    expect(second.window.contentView.addChildView).toHaveBeenCalledWith(handle.view);
  });

  it('show_oldWindowDestroyed_noRemove', () => {
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
    const first = fakeWindow();
    const second = fakeWindow();
    const handle = fakeHandle();

    placement.show(handle, first.window, BOUNDS);
    first.state.destroyed = true;
    placement.show(handle, second.window, BOUNDS);

    expect(first.window.contentView.removeChildView).not.toHaveBeenCalled();
    expect(second.window.contentView.addChildView).toHaveBeenCalledTimes(1);
  });

  it('show_fromParking_movesToPanel', () => {
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
    const { window } = fakeWindow();
    const handle = fakeHandle();
    placement.ensureHosted(handle);

    placement.show(handle, window, BOUNDS);

    expect(parking.window.contentView.removeChildView).toHaveBeenCalledWith(handle.view);
    expect(window.contentView.addChildView).toHaveBeenCalledWith(handle.view);
    expect(handle.setBounds).toHaveBeenLastCalledWith(BOUNDS);
  });

  it('hide_placed_movesToParkingVisible', () => {
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
    const { window } = fakeWindow();
    const handle = fakeHandle();
    placement.show(handle, window, BOUNDS);

    placement.hide(handle);

    expect(window.contentView.removeChildView).toHaveBeenCalledWith(handle.view);
    expect(parking.window.contentView.addChildView).toHaveBeenCalledWith(handle.view);
    expect(handle.setBounds).toHaveBeenLastCalledWith(HIDDEN_DEFAULT_BOUNDS);
    expect(handle.setVisible).not.toHaveBeenCalledWith(false);
  });

  it('hide_notPlaced_noop', () => {
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
    const handle = fakeHandle();

    placement.hide(handle);

    expect(handle.setVisible).not.toHaveBeenCalled();
    expect(parking.window.contentView.addChildView).not.toHaveBeenCalled();
  });

  it('hide_alreadyParked_noReAdd', () => {
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
    const handle = fakeHandle();
    placement.ensureHosted(handle);

    placement.hide(handle);

    expect(parking.window.contentView.addChildView).toHaveBeenCalledTimes(1);
  });

  it('ensureHosted_notPlaced_parksVisibleWithDefaultBounds', () => {
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
    const handle = fakeHandle();

    placement.ensureHosted(handle);

    expect(parking.window.contentView.addChildView).toHaveBeenCalledWith(handle.view);
    expect(handle.setBounds).toHaveBeenCalledWith(HIDDEN_DEFAULT_BOUNDS);
    expect(handle.setVisible).toHaveBeenCalledWith(true);
    expect(handle.setVisible).not.toHaveBeenCalledWith(false);
  });

  it('ensureHosted_alreadyPlaced_noop', () => {
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
    const first = fakeWindow();
    const handle = fakeHandle();
    placement.show(handle, first.window, BOUNDS);

    placement.ensureHosted(handle);

    expect(parking.window.contentView.addChildView).not.toHaveBeenCalled();
    expect(handle.setVisible).not.toHaveBeenCalledWith(false);
  });

  it('forget_removesFromWindow', () => {
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
    const { window } = fakeWindow();
    const handle = fakeHandle();
    placement.show(handle, window, BOUNDS);

    placement.forget(handle);
    placement.hide(handle);

    expect(window.contentView.removeChildView).toHaveBeenCalledWith(handle.view);
    expect(handle.setVisible).not.toHaveBeenCalledWith(false);
  });

  it('windowClosed_forgetsHost', () => {
    const parking = fakeWindow();
    const placement = new ViewPlacement(() => parking.window);
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

describe('createParkingHost', () => {
  it('createParkingHost_firstCall_createsWindow', () => {
    const made = fakeWindow();
    const factory = vi.fn(() => made.window);

    const result = createParkingHost(factory)();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result).toBe(made.window);
  });

  it('createParkingHost_secondCall_reusesWindow', () => {
    const factory = vi.fn(() => fakeWindow().window);
    const host = createParkingHost(factory);

    const first = host();
    const second = host();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('createParkingHost_destroyed_createsNew', () => {
    const made = fakeWindow();
    const factory = vi.fn().mockReturnValueOnce(made.window).mockReturnValueOnce(fakeWindow().window);
    const host = createParkingHost(factory);
    const first = host();

    made.state.destroyed = true;
    const second = host();

    expect(factory).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });
});
