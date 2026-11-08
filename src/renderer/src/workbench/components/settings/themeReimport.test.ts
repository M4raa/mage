import { describe, expect, it } from 'vitest';
import { parseOvsxThemeId } from './themeReimport';

describe('parseOvsxThemeId', () => {
  it('parseOvsxThemeId_valid_splits', () => {
    expect(parseOvsxThemeId('ovsx:arcticicestudio.nord-visual-studio-code')).toEqual({ namespace: 'arcticicestudio', name: 'nord-visual-studio-code' });
  });

  it('parseOvsxThemeId_otherPrefix_null', () => {
    expect(parseOvsxThemeId('local:acme.dark')).toBeNull();
  });

  it('parseOvsxThemeId_noDot_null', () => {
    expect(parseOvsxThemeId('ovsx:acme')).toBeNull();
    expect(parseOvsxThemeId('ovsx:.dark')).toBeNull();
    expect(parseOvsxThemeId('ovsx:acme.')).toBeNull();
  });
});
