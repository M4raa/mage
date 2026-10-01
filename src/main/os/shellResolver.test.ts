import { describe, expect, it } from 'vitest';
import { isShellPreference, resolveShell, type ShellResolverDeps } from './shellResolver';

function deps(overrides: Partial<ShellResolverDeps>): ShellResolverDeps {
  return {
    platform: 'win32',
    preference: 'auto',
    fileExists: () => false,
    commandInPath: () => false,
    programFiles: 'C:\\Program Files',
    gitBinary: null,
    envShell: undefined,
    ...overrides,
  };
}

describe('resolveShell', () => {
  it('resolve_windowsGitBashNextToGit_isPreferred', () => {
    const shell = resolveShell(deps({ gitBinary: 'D:\\Tools\\Git\\cmd\\git.exe', fileExists: (p) => p === 'D:\\Tools\\Git\\bin\\bash.exe' }));

    expect(shell).toMatchObject({ name: 'Git Bash', command: 'D:\\Tools\\Git\\bin\\bash.exe' });
    expect(shell.argsFor('ls')).toEqual(['-c', 'ls']);
  });

  it('resolve_windowsGitBashInProgramFiles_found', () => {
    expect(resolveShell(deps({ fileExists: (p) => p === 'C:\\Program Files\\Git\\bin\\bash.exe' })).name).toBe('Git Bash');
  });

  it('resolve_windowsNoGitBash_pwshThenWindowsPowerShell', () => {
    expect(resolveShell(deps({ commandInPath: (bin) => bin === 'pwsh.exe' })).command).toBe('pwsh.exe');
    const fallback = resolveShell(deps({}));
    expect(fallback).toMatchObject({ name: 'Windows PowerShell', command: 'powershell.exe' });
    expect(fallback.argsFor('dir')).toEqual(['-NoProfile', '-NonInteractive', '-Command', 'dir']);
  });

  it('resolve_windowsPreferencePowershell_skipsGitBash', () => {
    expect(resolveShell(deps({ preference: 'powershell', fileExists: () => true })).name).toBe('Windows PowerShell');
  });

  it('resolve_posixKnownShell_usesIt', () => {
    expect(resolveShell(deps({ platform: 'darwin', envShell: '/bin/zsh' }))).toMatchObject({ name: 'zsh', command: '/bin/zsh' });
  });

  it('resolve_posixFishOrNone_fallsBackToSh', () => {
    expect(resolveShell(deps({ platform: 'linux', envShell: '/usr/bin/fish' })).command).toBe('/bin/sh');
    expect(resolveShell(deps({ platform: 'linux' })).command).toBe('/bin/sh');
  });

  it('resolve_posixPreferencePowershellWithPwsh_usesPwsh', () => {
    expect(resolveShell(deps({ platform: 'linux', preference: 'powershell', commandInPath: () => true })).command).toBe('pwsh');
  });
});

describe('isShellPreference', () => {
  it('is_values_validated', () => {
    expect(['auto', 'bash', 'powershell', 'cmd', 3].map(isShellPreference)).toEqual([true, true, true, false, false]);
  });
});
