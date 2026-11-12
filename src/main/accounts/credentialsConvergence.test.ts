import { describe, expect, it } from 'vitest';
import { parseCredentialsSide } from './credentialsConvergence';

const ACCOUNT = '/home/u/.claude-p/.credentials.json';
const PROFILE = '/home/u/.claude-p/perfil/.credentials.json';

describe('parseCredentialsSide', () => {
  it('parseCredentialsSide_validBlock_extractsExpiryAndTokenPresence', () => {
    const parsed = parseCredentialsSide({
      path: ACCOUNT,
      exists: true,
      json: { claudeAiOauth: { accessToken: 'a', refreshToken: 'r', expiresAt: 1_785_512_594_379 } },
    });

    expect(parsed).toEqual({
      path: ACCOUNT,
      exists: true,
      expiresAt: 1_785_512_594_379,
      hasTokens: true,
    });
  });

  it('parseCredentialsSide_emptiedByCli_reportsUnusableShape', () => {
    // Forma literal observada en disco tras un refresh fallido.
    const parsed = parseCredentialsSide({
      path: PROFILE,
      exists: true,
      json: {
        claudeAiOauth: {
          accessToken: '',
          refreshToken: '',
          expiresAt: 0,
          scopes: ['user:inference'],
          subscriptionType: 'team',
        },
      },
    });

    expect(parsed.expiresAt).toBeNull();
    expect(parsed.hasTokens).toBe(false);
  });

  it('parseCredentialsSide_missingFile_reportsAbsent', () => {
    const parsed = parseCredentialsSide({ path: PROFILE, exists: false, json: null });

    expect(parsed).toEqual({ path: PROFILE, exists: false, expiresAt: null, hasTokens: false });
  });

  it('parseCredentialsSide_malformedJson_doesNotThrow', () => {
    for (const json of [null, 42, 'texto', [], { claudeAiOauth: 'no-objeto' }, { otra: {} }]) {
      const parsed = parseCredentialsSide({ path: ACCOUNT, exists: true, json });

      expect(parsed.expiresAt).toBeNull();
      expect(parsed.hasTokens).toBe(false);
    }
  });

  it('parseCredentialsSide_nonIntegerOrNegativeExpiry_rejectsIt', () => {
    for (const expiresAt of [-1, 0, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '5000', null]) {
      const parsed = parseCredentialsSide({
        path: ACCOUNT,
        exists: true,
        json: { claudeAiOauth: { accessToken: 'a', refreshToken: 'r', expiresAt } },
      });

      expect(parsed.expiresAt).toBeNull();
    }
  });
});
