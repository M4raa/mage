import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '@shared/accounts';
import { applyAccentOverrides, providerBadge, providerLabel, toAccountView } from './accountView';

function info(overrides: Partial<AccountInfo>): AccountInfo {
  return {
    configDir: '/home/u/.claude',
    name: '.claude',
    isMain: true,
    providerId: 'claude',
    authKind: 'subscription',
    email: null,
    org: null,
    loginStatus: 'logged_in',
    expiresAt: null,
    defaultModel: null,
    ...overrides,
  };
}

describe('toAccountView', () => {
  it('toAccountView_mapsCoreFields_fromConfigDir', () => {
    const account = toAccountView(info({ configDir: '/home/u/.claude-p', name: '.claude-p' }));

    expect(account.id).toBe('/home/u/.claude-p');
    expect(account.alias).toBe('claude-p'); // sin el punto inicial
    expect(account.provider).toBe('Claude');
  });

  it('toAccountView_nombreConPrefijoYEmail_monogramaDelNombreSinPrefijo', () => {
    const account = toAccountView(info({ email: 'cuenta-dos@ejemplo.com', name: '.claude-p' }));

    expect(account.monogram).toBe('P');
    expect(account.email).toBe('cuenta-dos@ejemplo.com');
  });

  it('toAccountView_sinEmail_monogramaDelNombreSinPrefijo', () => {
    expect(toAccountView(info({ email: null, name: '.claude-work' })).monogram).toBe('W');
    expect(toAccountView(info({ email: null, name: '.codex-xati', providerId: 'codex' })).monogram).toBe('X');
    expect(toAccountView(info({ email: null, name: 'agy-casa', providerId: 'agy' })).monogram).toBe('C');
  });

  it('toAccountView_principalSoloPrefijo_usaEmailYSiNoElPrefijo', () => {
    expect(toAccountView(info({ email: 'zeta@ejemplo.com', name: '.claude' })).monogram).toBe('Z');
    expect(toAccountView(info({ email: null, name: '.claude' })).monogram).toBe('C');
  });

  it('toAccountView_nombreSinLetras_interrogacion', () => {
    expect(toAccountView(info({ email: null, name: '.__' })).monogram).toBe('?');
  });

  it('toAccountView_defaultModelNull_fallsBackToSonnet', () => {
    const account = toAccountView(info({ defaultModel: null }));

    expect(account.defaultModel).toBe('sonnet');
  });

  it('toAccountView_defaultModelSet_usesIt', () => {
    const account = toAccountView(info({ defaultModel: 'opus[1m]' }));

    expect(account.defaultModel).toBe('opus[1m]');
  });

  it('toAccountView_passesLoginStatus', () => {
    const account = toAccountView(info({ loginStatus: 'expired' }));

    expect(account.loginStatus).toBe('expired');
  });

  it('toAccountView_passesIsMain', () => {
    expect(toAccountView(info({ isMain: true })).isMain).toBe(true);
    expect(toAccountView(info({ isMain: false })).isMain).toBe(false);
  });

  it('toAccountView_usageIsPlaceholder', () => {
    const account = toAccountView(info({}));

    expect(account.usage.fiveHour.pct).toBe(0);
    expect(account.usage.fiveHour.label).toBe('—');
  });
});

describe('accentos elegidos por el usuario (PERS-3) y marca de proveedor (P-028, 2)', () => {
  it('toAccountView_conOverride_usaElAcentoElegido', () => {
    expect(toAccountView(info({}), 4).accent.base).toBe('var(--mg-accent-4-base)');
  });

  it('applyAccentOverrides_soloCambiaLasCuentasConColorPropio', () => {
    const accounts = [toAccountView(info({ configDir: '/h/.claude' })), toAccountView(info({ configDir: '/h/.claude-p' }))];

    const result = applyAccentOverrides(accounts, { '/h/.claude-p': 5 });

    expect(result[0]?.accent).toEqual(accounts[0]?.accent);
    expect(result[1]?.accent.base).toBe('var(--mg-accent-5-base)');
  });

  it('applyAccentOverrides_sinOverrides_vuelveAlEstableDeSuIdentificador', () => {
    const accounts = [toAccountView(info({ configDir: '/h/.claude-p' }), 3)];

    expect(applyAccentOverrides(accounts, {})[0]?.accent).toEqual(toAccountView(info({ configDir: '/h/.claude-p' })).accent);
  });

  it('providerBadge_claudeTambienSeMarca_vacioNo', () => {
    expect(providerBadge('claude')).toBe('claude');
    expect(providerBadge('')).toBeNull();
  });

  it('providerBadge_otrosProveedores_idCortoSinPrefijo', () => {
    expect(providerBadge('agy')).toBe('agy');
    expect(providerBadge('openai')).toBe('openai');
    expect(providerBadge('custom:ollama')).toBe('ollama');
    expect(providerBadge('custom:un-nombre-muy-largo')).toBe('un-nombr');
  });

  it('providerLabel_claudeYOtros', () => {
    expect(providerLabel('claude')).toBe('Claude');
    expect(providerLabel('agy')).toBe('agy');
  });
});
describe('R46 — avatares', () => {
  it('applyAccentOverrides_otraCuentaDelanteAlAnadir_colorDeLaExistenteNoCambia', () => {
    const existing = toAccountView(info({ configDir: '/fixture/.claude-work', name: '.claude-work', email: 'otro@example.invalid' }));
    const added = toAccountView(info({ configDir: '/fixture/.claude-aaa', name: '.claude-aaa' }));

    const before = applyAccentOverrides([existing], {});
    const after = applyAccentOverrides([added, existing], {});

    expect(existing.monogram).toBe('W');
    expect(after[1]?.accent).toEqual(before[0]?.accent);
  });
});
