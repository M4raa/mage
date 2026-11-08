import { describe, expect, it } from 'vitest';
import { parsePrKey, prKeyToString, samePrKey } from './pr';

describe('PrKey', () => {
  it('prKeyToString_lowercases', () => {
    expect(prKeyToString({ host: 'GitHub.com', owner: 'Acme', repo: 'Demo', number: 7 })).toBe('github.com/acme/demo#7');
  });

  it('parsePrKey_roundTrip', () => {
    const key = { host: 'github.com', owner: 'acme', repo: 'my_repo.js', number: 12 };

    expect(parsePrKey(prKeyToString(key))).toEqual(key);
    expect(parsePrKey('GitHub.com/Acme/Demo#7')).toEqual({ host: 'github.com', owner: 'acme', repo: 'demo', number: 7 });
  });

  it('parsePrKey_badHost_null', () => {
    expect(parsePrKey('-evil/acme/demo#1')).toBeNull();
    expect(parsePrKey('acme/demo#1')).toBeNull();
    expect(parsePrKey('')).toBeNull();
  });

  it('parsePrKey_zeroNumber_null', () => {
    expect(parsePrKey('github.com/acme/demo#0')).toBeNull();
    expect(parsePrKey('github.com/acme/demo#-3')).toBeNull();
    expect(parsePrKey('github.com/acme/demo#1.5')).toBeNull();
    expect(parsePrKey('github.com/acme/demo')).toBeNull();
  });

  it('parsePrKey_traversal_null', () => {
    expect(parsePrKey('github.com/../x#1')).toBeNull();
    expect(parsePrKey('github.com/acme/..#1')).toBeNull();
  });

  it('samePrKey_caseInsensitive', () => {
    const a = { host: 'github.com', owner: 'Acme', repo: 'Demo', number: 7 };

    expect(samePrKey(a, { host: 'github.com', owner: 'acme', repo: 'demo', number: 7 })).toBe(true);
    expect(samePrKey(a, { ...a, number: 8 })).toBe(false);
  });
});
