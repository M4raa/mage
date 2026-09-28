import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { findGitBinary, gitCommandName, type GitResolverDeps } from './gitBinaryResolver';

const WIN: GitResolverDeps = {
  platform: 'win32',
  fileExists: () => false,
  commandInPath: () => false,
  programFiles: 'C:\\Program Files',
};
const POSIX: GitResolverDeps = { ...WIN, platform: 'linux', programFiles: undefined };

describe('gitCommandName', () => {
  it('gitCommandName_win32_exe', () => {
    expect(gitCommandName('win32')).toBe('git.exe');
  });

  it('gitCommandName_posix_desnudo', () => {
    expect(gitCommandName('darwin')).toBe('git');
  });
});

describe('findGitBinary', () => {
  it('findGitBinary_conOverride_loDevuelveSinMirarNada', () => {
    const fileExists = vi.fn(() => true);

    expect(findGitBinary({ ...WIN, fileExists, binOverride: 'D:\\git\\git.exe' })).toBe('D:\\git\\git.exe');
    expect(fileExists).not.toHaveBeenCalled();
  });

  it('findGitBinary_windowsConGitForWindows_devuelveSuRuta', () => {
    const expected = join('C:\\Program Files', 'Git', 'cmd', 'git.exe');

    expect(findGitBinary({ ...WIN, fileExists: (p) => p === expected })).toBe(expected);
  });

  it('findGitBinary_enElPath_devuelveElComando', () => {
    expect(findGitBinary({ ...POSIX, commandInPath: (bin) => bin === 'git' })).toBe('git');
  });

  it('findGitBinary_sinGit_null', () => {
    expect(findGitBinary(WIN)).toBeNull();
    expect(findGitBinary(POSIX)).toBeNull();
  });

  it('findGitBinary_windowsSinProgramFiles_vaAlPath', () => {
    expect(findGitBinary({ ...WIN, programFiles: undefined, commandInPath: (bin) => bin === 'git.exe' })).toBe('git.exe');
  });
});
