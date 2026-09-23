import { describe, expect, it } from 'vitest';
import {
  decideCredentialsConvergence,
  parseCredentialsSide,
  type CredentialsSide,
} from './credentialsConvergence';

const ACCOUNT = '/home/u/.claude-p/.credentials.json';
const PROFILE = '/home/u/.claude-p/mage-private/.credentials.json';

// Lado utilizable por defecto; cada test cambia solo lo que le interesa.
function side(path: string, overrides: Partial<CredentialsSide> = {}): CredentialsSide {
  return { path, exists: true, expiresAt: 5_000, hasTokens: true, ...overrides };
}

describe('decideCredentialsConvergence', () => {
  it('decideCredentialsConvergence_samePath_throws', () => {
    expect(() => decideCredentialsConvergence(side(ACCOUNT), side(ACCOUNT))).toThrow(/misma ruta/i);
  });

  it('decideCredentialsConvergence_neitherUsable_returnsNone', () => {
    const decision = decideCredentialsConvergence(
      side(ACCOUNT, { exists: false, expiresAt: null, hasTokens: false }),
      side(PROFILE, { exists: false, expiresAt: null, hasTokens: false }),
    );

    expect(decision.action).toBe('none');
  });

  it('decideCredentialsConvergence_onlyAccountUsable_copiesToProfile', () => {
    const decision = decideCredentialsConvergence(
      side(ACCOUNT),
      side(PROFILE, { exists: false, expiresAt: null, hasTokens: false }),
    );

    expect(decision).toMatchObject({ action: 'copy', from: ACCOUNT, to: PROFILE });
  });

  it('decideCredentialsConvergence_onlyProfileUsable_copiesToAccount', () => {
    // Direccion INVERSA a la del hard link original (S2): si la sesion privada refresco el token, el
    // dir de la cuenta se quedo atras y hay que traerlo de vuelta, no pisarlo.
    const decision = decideCredentialsConvergence(
      side(ACCOUNT, { exists: false, expiresAt: null, hasTokens: false }),
      side(PROFILE),
    );

    expect(decision).toMatchObject({ action: 'copy', from: PROFILE, to: ACCOUNT });
  });

  it('decideCredentialsConvergence_profileEmptiedByCli_copiesAccountOverIt', () => {
    // EL CASO QUE MATA UN CRITERIO POR FECHA: en disco este lado es el MAS RECIENTE (el CLI acaba de
    // vaciarlo al no poder refrescar) pero es inservible. Debe ganar la cuenta, mas antigua y buena.
    // La recencia ni siquiera llega al modulo: por eso no puede volver a decidir mal.
    const decision = decideCredentialsConvergence(
      side(ACCOUNT, { expiresAt: 9_000 }),
      side(PROFILE, { expiresAt: null, hasTokens: false }),
    );

    expect(decision).toMatchObject({ action: 'copy', from: ACCOUNT, to: PROFILE });
  });

  it('decideCredentialsConvergence_bothUsableProfileFresher_copiesProfileOverAccount', () => {
    const decision = decideCredentialsConvergence(
      side(ACCOUNT, { expiresAt: 5_000 }),
      side(PROFILE, { expiresAt: 8_000 }),
    );

    expect(decision).toMatchObject({ action: 'copy', from: PROFILE, to: ACCOUNT });
  });

  it('decideCredentialsConvergence_bothUsableAccountFresher_copiesAccountOverProfile', () => {
    const decision = decideCredentialsConvergence(
      side(ACCOUNT, { expiresAt: 8_000 }),
      side(PROFILE, { expiresAt: 5_000 }),
    );

    expect(decision).toMatchObject({ action: 'copy', from: ACCOUNT, to: PROFILE });
  });

  it('decideCredentialsConvergence_sameExpiry_returnsNoneWithoutWriting', () => {
    // Estado ya coherente: no se escribe. Cada escritura es un rename que rompe enlaces ajenos.
    const decision = decideCredentialsConvergence(
      side(ACCOUNT, { expiresAt: 7_000 }),
      side(PROFILE, { expiresAt: 7_000 }),
    );

    expect(decision.action).toBe('none');
  });

  it('decideCredentialsConvergence_tokensPresentButExpiryZero_treatsSideAsUnusable', () => {
    // expiresAt 0 es lo que escribe el CLI al vaciar; no debe considerarse vigente.
    const decision = decideCredentialsConvergence(
      side(ACCOUNT, { expiresAt: null }),
      side(PROFILE, { expiresAt: 3_000 }),
    );

    expect(decision).toMatchObject({ action: 'copy', from: PROFILE, to: ACCOUNT });
  });
});

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
