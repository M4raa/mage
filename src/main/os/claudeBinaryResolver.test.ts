import { describe, expect, it } from 'vitest';
import { resolveClaudeBinary, type ResolverDeps } from './claudeBinaryResolver';

function deps(overrides: Partial<ResolverDeps>): ResolverDeps {
  return {
    platform: 'linux',
    homedir: '/home/u',
    fileExists: () => false,
    binOverride: undefined,
    ...overrides,
  };
}

describe('resolveClaudeBinary', () => {
  it('resolve_withOverride_returnsOverride', () => {
    const result = resolveClaudeBinary(deps({ binOverride: '/custom/claude' }));

    expect(result).toBe('/custom/claude');
  });

  it('resolve_windowsLocalBinExists_returnsExePath', () => {
    const result = resolveClaudeBinary(
      deps({ platform: 'win32', homedir: 'C:\\Users\\u', fileExists: (p) => p.endsWith('claude.exe') }),
    );

    expect(result).toContain('claude.exe');
  });

  it('resolve_windowsNoCandidate_returnsExeFallback', () => {
    const result = resolveClaudeBinary(deps({ platform: 'win32', fileExists: () => false }));

    expect(result).toBe('claude.exe');
  });

  it('resolve_posixLocalClaudeInstallExists_returnsPath', () => {
    // ~/.claude/local/claude (instalacion local npm) cuando no hay ~/.local/bin/claude.
    // Matcher agnostico al separador de SO: unico candidato que incluye ".claude" y "local".
    const result = resolveClaudeBinary(
      deps({ platform: 'linux', fileExists: (p) => p.includes('.claude') && p.includes('local') }),
    );

    expect(result).toContain('claude');
    expect(result).toContain('local');
  });

  it('resolve_windowsLocalClaudeInstallExists_returnsExePath', () => {
    const result = resolveClaudeBinary(
      deps({
        platform: 'win32',
        homedir: 'C:\\Users\\u',
        fileExists: (p) => p.includes('.claude') && p.endsWith('claude.exe'),
      }),
    );

    expect(result).toContain('claude.exe');
  });

  it('resolve_posixHomebrewExists_returnsAbsolutePath', () => {
    const result = resolveClaudeBinary(
      deps({ platform: 'darwin', fileExists: (p) => p === '/opt/homebrew/bin/claude' }),
    );

    expect(result).toBe('/opt/homebrew/bin/claude');
  });

  it('resolve_posixNoCandidate_returnsPathFallback', () => {
    const result = resolveClaudeBinary(deps({ platform: 'linux', fileExists: () => false }));

    expect(result).toBe('claude');
  });
});
