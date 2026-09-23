import { describe, expect, it } from 'vitest';
import { resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('resolveTheme_systemAndPrefersDark_returnsDark', () => {
    expect(resolveTheme('system', true)).toBe('dark');
  });

  it('resolveTheme_systemAndPrefersLight_returnsLight', () => {
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('resolveTheme_explicitLight_ignoresPrefersDark', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('resolveTheme_explicitDark_ignoresPrefersDark', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
