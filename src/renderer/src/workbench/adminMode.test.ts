import { describe, expect, it } from 'vitest';
import { isAdminToggle } from './adminMode';

const key = (over: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }>) => ({ code: 'F12', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...over });

describe('isAdminToggle', () => {
  it('isAdminToggle_ctrlShiftF12EnWindowsYLinux_true', () => {
    expect(isAdminToggle(key({ ctrlKey: true, shiftKey: true }), false)).toBe(true);
  });

  it('isAdminToggle_cmdShiftF12EnMac_true', () => {
    expect(isAdminToggle(key({ metaKey: true, shiftKey: true }), true)).toBe(true);
    expect(isAdminToggle(key({ ctrlKey: true, shiftKey: true }), true)).toBe(false);
  });

  it.each([
    ['sin shift', { ctrlKey: true }],
    ['con alt', { ctrlKey: true, shiftKey: true, altKey: true }],
    ['otra tecla', { ctrlKey: true, shiftKey: true, code: 'F11' }],
    ['solo F12 (DevTools)', {}],
    ['ctrl y meta a la vez', { ctrlKey: true, metaKey: true, shiftKey: true }],
  ])('isAdminToggle_%s_false', (_, over) => {
    expect(isAdminToggle(key(over), false)).toBe(false);
  });
});
