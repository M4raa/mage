import { describe, expect, it } from 'vitest';
import type { AccountInfo } from '@shared/accounts';
import { toAccountView } from './accountView';

function info(overrides: Partial<AccountInfo>): AccountInfo {
  return {
    configDir: '/home/u/.claude',
    name: '.claude',
    isMain: true,
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
    const account = toAccountView(info({ configDir: '/home/u/.claude-p', name: '.claude-p' }), 0);

    expect(account.id).toBe('/home/u/.claude-p');
    expect(account.alias).toBe('claude-p'); // sin el punto inicial
    expect(account.provider).toBe('Claude');
  });

  it('toAccountView_emailPresent_monogramFromEmail', () => {
    const account = toAccountView(info({ email: 'cuenta-dos@ejemplo.com', name: '.claude-p' }), 0);

    expect(account.monogram).toBe('C');
    expect(account.email).toBe('cuenta-dos@ejemplo.com');
  });

  it('toAccountView_noEmail_monogramFromAlias', () => {
    const account = toAccountView(info({ email: null, name: '.claude-work' }), 0);

    expect(account.monogram).toBe('C'); // primera letra alfanumerica de "claude-work" -> 'C'
  });

  it('toAccountView_defaultModelNull_fallsBackToSonnet', () => {
    const account = toAccountView(info({ defaultModel: null }), 0);

    expect(account.defaultModel).toBe('sonnet');
  });

  it('toAccountView_defaultModelSet_usesIt', () => {
    const account = toAccountView(info({ defaultModel: 'opus[1m]' }), 0);

    expect(account.defaultModel).toBe('opus[1m]');
  });

  it('toAccountView_accentCyclesByIndex', () => {
    const a0 = toAccountView(info({}), 0);
    const a6 = toAccountView(info({}), 6); // 6 acentos -> vuelve al primero

    expect(a6.accent.base).toBe(a0.accent.base);
  });

  it('toAccountView_passesLoginStatus', () => {
    const account = toAccountView(info({ loginStatus: 'expired' }), 0);

    expect(account.loginStatus).toBe('expired');
  });

  it('toAccountView_passesIsMain', () => {
    expect(toAccountView(info({ isMain: true }), 0).isMain).toBe(true);
    expect(toAccountView(info({ isMain: false }), 0).isMain).toBe(false);
  });

  it('toAccountView_usageIsPlaceholder', () => {
    const account = toAccountView(info({}), 0);

    expect(account.usage.fiveHour.pct).toBe(0);
    expect(account.usage.fiveHour.label).toBe('—');
  });
});
