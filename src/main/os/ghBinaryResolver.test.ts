import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { findGhBinary, ghCommandName, type GhResolverDeps } from './ghBinaryResolver';

const WIN: GhResolverDeps = {
  platform: 'win32',
  fileExists: () => false,
  commandInPath: () => false,
  programFiles: 'C:\\Program Files',
  localAppData: 'C:\\Users\\quien\\AppData\\Local',
};

describe('findGhBinary', () => {
  it('conOverride_loDevuelveSinMirarNada', () => {
    const fileExists = vi.fn(() => true);

    const found = findGhBinary({ ...WIN, fileExists, binOverride: 'D:\\gh.exe' });

    expect(found).toBe('D:\\gh.exe');
    expect(fileExists).not.toHaveBeenCalled();
  });

  it('windowsEnProgramFiles_ganaAlPath', () => {
    const expected = join('C:\\Program Files', 'GitHub CLI', 'gh.exe');

    const found = findGhBinary({ ...WIN, fileExists: (p) => p === expected, commandInPath: () => true });

    expect(found).toBe(expected);
  });

  it('windowsSoloEnLocalAppData_loEncuentra', () => {
    const expected = join('C:\\Users\\quien\\AppData\\Local', 'Programs', 'GitHub CLI', 'gh.exe');

    expect(findGhBinary({ ...WIN, fileExists: (p) => p === expected })).toBe(expected);
  });

  it('soloEnElPath_devuelveElNombreDelComando', () => {
    expect(findGhBinary({ ...WIN, commandInPath: (bin) => bin === 'gh.exe' })).toBe('gh.exe');
    expect(findGhBinary({ ...WIN, platform: 'linux', commandInPath: (bin) => bin === 'gh' })).toBe('gh');
  });

  it('enNingunSitio_devuelveNull', () => {
    expect(findGhBinary(WIN)).toBeNull();
    expect(findGhBinary({ ...WIN, binOverride: '', programFiles: undefined, localAppData: '' })).toBeNull();
  });

  it('posix_noInventaCandidatos', () => {
    const fileExists = vi.fn(() => true);

    findGhBinary({ ...WIN, platform: 'darwin', fileExists });

    expect(fileExists).not.toHaveBeenCalled();
    expect(ghCommandName('darwin')).toBe('gh');
  });
});
