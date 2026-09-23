import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLaunchParams, type DefaultsDeps } from './sessionDefaults';

function deps(overrides: Partial<DefaultsDeps>): DefaultsDeps {
  return {
    homedir: '/home/u',
    fileExists: () => true,
    listHome: () => [],
    resolveSharedConfigArgs: () => [],
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

  it('resolve_permissionModeDefault_noSePropaga', () => {
    expect(resolveLaunchParams('s1', { ...params, permissionMode: 'default' }, deps({})).permissionMode).toBeUndefined();
    expect(resolveLaunchParams('s1', params, deps({})).permissionMode).toBeUndefined();
  });

  it('resolve_permissionModeInvalido_lanza', () => {
    expect(() =>
      resolveLaunchParams('s1', { ...params, permissionMode: 'yolo' as never }, deps({})),
    ).toThrow(/modo de permiso/i);
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

  it('resolve_sharedConfigArgs_seTomanDelDeps', () => {
    const args = ['--mcp-config', '/x/mcp-common.json'];
    const result = resolveLaunchParams('s1', params, deps({ resolveSharedConfigArgs: () => args }));

    expect(result.sharedConfigArgs).toEqual(args);
  });

  it('resolve_sinConfiguracionComun_sharedConfigArgsEsArrayVacio', () => {
    const result = resolveLaunchParams('s1', params, deps({}));

    expect(result.sharedConfigArgs).toEqual([]);
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
