import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLaunchParams, type DefaultsDeps } from './sessionDefaults';
import type { SharedLaunchConfig } from './providerAdapter';

const NO_SHARED: SharedLaunchConfig = { mcpServers: [], settingsFragment: null, claudeAiConnectors: true };

function deps(overrides: Partial<DefaultsDeps>): DefaultsDeps {
  return {
    homedir: '/home/u',
    fileExists: () => true,
    listHome: () => [],
    resolveShared: () => NO_SHARED,
    ...overrides,
  };
}

const params = { accountDir: '', model: 'haiku', provider: 'claude', cwd: '' };

describe('resolveLaunchParams', () => {
  it('resolve_emptyModel_throws', () => {
    expect(() => resolveLaunchParams('s1', { ...params, model: '  ' }, deps({}))).toThrow(/modelo/i);
  });

  it('resolve_explicitAccountWithCreds_usesIt', () => {
    const result = resolveLaunchParams(
      's1',
      { ...params, accountDir: '/home/u/.claude-p' },
      deps({ fileExists: (p) => p.includes('.claude-p') }),
    );

    expect(result.accountDir).toBe('/home/u/.claude-p');
  });

  it('resolve_emptyAccountMainHasLogin_defaultsToMain', () => {
    const mainCreds = join('/home/u', '.claude', '.credentials.json');
    const result = resolveLaunchParams('s1', params, deps({ fileExists: (p) => p === mainCreds }));

    expect(result.accountDir).toBe(join('/home/u', '.claude'));
  });

  it('resolve_emptyAccountScansForLoggedIn_picksFirst', () => {
    // ~/.claude sin login; ~/.claude-p con login -> se elige .claude-p.
    const altCreds = join('/home/u', '.claude-p', '.credentials.json');
    const result = resolveLaunchParams(
      's1',
      params,
      deps({ listHome: () => ['.claude-p', '.claude-9'], fileExists: (p) => p === altCreds }),
    );

    expect(result.accountDir).toBe(join('/home/u', '.claude-p'));
  });

  it('resolve_noLoggedInAccount_throws', () => {
    expect(() =>
      resolveLaunchParams('s1', params, deps({ fileExists: () => false, listHome: () => ['.claude'] })),
    ).toThrow(/login/i);
  });

  it('resolve_emptyCwd_defaultsToHome', () => {
    const result = resolveLaunchParams('s1', params, deps({}));

    expect(result.cwd).toBe('/home/u');
  });

  it('resolve_resumeFlagDefaultsFalse_andPropagatesWhenTrue', () => {
    expect(resolveLaunchParams('s1', params, deps({})).resume).toBe(false);
    expect(resolveLaunchParams('s1', params, deps({}), true).resume).toBe(true);
  });

  it('resolve_effortValido_sePropaga', () => {
    expect(resolveLaunchParams('s1', { ...params, effort: 'high' }, deps({})).effort).toBe('high');
  });

  it('resolve_sinEffort_noLoIncluye', () => {
    expect(resolveLaunchParams('s1', params, deps({})).effort).toBeUndefined();
  });

  it('resolve_effortInvalido_lanza', () => {
    expect(() => resolveLaunchParams('s1', { ...params, effort: 'turbo' }, deps({}))).toThrow(/effort/i);
  });

  it('resolve_permissionModeValido_sePropaga', () => {
    expect(resolveLaunchParams('s1', { ...params, permissionMode: 'plan' }, deps({})).permissionMode).toBe('plan');
  });

  it('resolve_permissionModeDefaultElegido_sePropaga', () => {
    // P-026 2.3: un Manual elegido a mano viaja, para que el `defaultMode` de la cuenta no lo cambie.
    expect(resolveLaunchParams('s1', { ...params, permissionMode: 'default' }, deps({})).permissionMode).toBe('default');
  });

  it('resolve_sinPermissionMode_noSePropaga', () => {
    // Conversacion nueva: sin flag, el CLI arranca en el modo de la cuenta y Mage lo adopta.
    expect(resolveLaunchParams('s1', params, deps({})).permissionMode).toBeUndefined();
  });

  it('resolve_permissionModeAutoYBypass_seAceptan', () => {
    expect(resolveLaunchParams('s1', { ...params, permissionMode: 'auto' }, deps({})).permissionMode).toBe('auto');
    expect(resolveLaunchParams('s1', { ...params, permissionMode: 'bypassPermissions' }, deps({})).permissionMode).toBe('bypassPermissions');
  });

  it('resolve_permissionModeInvalido_lanzaConElValor', () => {
    expect(() =>
      resolveLaunchParams('s1', { ...params, permissionMode: 'yolo' as never }, deps({})),
    ).toThrow(/modo de permiso invalido para claude: "yolo"/i);
  });

  it('resolve_budgetCentsValido_sePropaga', () => {
    expect(resolveLaunchParams('s1', { ...params, maxBudgetUsdCents: 500 }, deps({})).maxBudgetUsdCents).toBe(500);
  });

  it('resolve_budgetCentsNoEntero_lanza', () => {
    expect(() => resolveLaunchParams('s1', { ...params, maxBudgetUsdCents: 5.5 }, deps({}))).toThrow(/presupuesto/i);
  });

  it('resolve_budgetCentsNoPositivo_lanza', () => {
    expect(() => resolveLaunchParams('s1', { ...params, maxBudgetUsdCents: 0 }, deps({}))).toThrow(/presupuesto/i);
  });

  it('resolve_compartido_seResuelvePorProveedorYCuenta', () => {
    const calls: [string, string][] = [];
    const shared: SharedLaunchConfig = { ...NO_SHARED, claudeAiConnectors: false };
    const resolveShared = (provider: string, accountDir: string): SharedLaunchConfig => {
      calls.push([provider, accountDir]);
      return shared;
    };

    const result = resolveLaunchParams('s1', { ...params, accountDir: '/home/u/.claude-p' }, deps({ resolveShared }));

    expect(result.shared).toBe(shared);
    expect(calls).toEqual([['claude', '/home/u/.claude-p']]);
  });

  it('resolve_nonClaudeProviderWithoutCreds_succeeds', () => {
    const result = resolveLaunchParams(
      's1',
      { ...params, provider: 'openai', accountDir: '/home/u/.claude-9' },
      deps({ fileExists: () => false }), // no credentials file at all
    );

    expect(result.accountDir).toBe('/home/u/.claude-9');
  });
});
