import { afterEach, describe, expect, it } from 'vitest';
import { closeLocalPopover, hasOpenLocalPopover, openLocalPopover } from './localPopovers';

// El contador es de modulo: cada test deja el estado como lo encontro.
afterEach(() => {
  while (hasOpenLocalPopover()) closeLocalPopover();
});

describe('localPopovers', () => {
  it('localPopovers_openThenClose_backToFalse', () => {
    expect(hasOpenLocalPopover()).toBe(false);

    openLocalPopover();
    expect(hasOpenLocalPopover()).toBe(true);

    closeLocalPopover();
    expect(hasOpenLocalPopover()).toBe(false);
  });

  it('localPopovers_twoOpen_oneClosed_stillTrue', () => {
    openLocalPopover();
    openLocalPopover();

    closeLocalPopover();

    expect(hasOpenLocalPopover()).toBe(true);
  });

  it('localPopovers_closeBelowZero_throwsWithCount', () => {
    expect(() => closeLocalPopover()).toThrow('contador 0');
  });
});
