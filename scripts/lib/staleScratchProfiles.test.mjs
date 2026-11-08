import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { localMageRootFor, PROFILE_DIR_PATTERN, profileHash, staleProfileDirs, userProfilePaths } from './staleScratchProfiles.mjs';

describe('profileHash', () => {
  it('profileHash_mismaRuta_mismoHashDe16Hex', () => {
    const userData = 'C:\\Users\\u\\AppData\\Roaming\\mage';

    expect(profileHash(userData)).toMatch(PROFILE_DIR_PATTERN);
    expect(profileHash(userData)).toBe(profileHash(userData));
  });

  it('profileHash_vacio_lanzaConElValor', () => {
    expect(() => profileHash('')).toThrow('""');
  });
});

describe('staleProfileDirs', () => {
  it('staleProfileDirs_conservaLosDelUsuarioYLoQueNoEsPerfil', () => {
    const real = 'C:\\Users\\u\\AppData\\Roaming\\mage';
    const entries = [profileHash(real), 'locks', 'aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'no-es-hash'];

    expect(staleProfileDirs(entries, [real])).toEqual(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']);
  });

  it('staleProfileDirs_sinEntradas_vacio', () => {
    expect(staleProfileDirs([], ['C:\\x'])).toEqual([]);
  });
});

describe('rutas del sistema', () => {
  it('localMageRootFor_windowsSinLocalAppData_bajoElHome', () => {
    expect(localMageRootFor({ platform: 'win32', env: {}, home: 'C:\\Users\\u' })).toBe(join('C:\\Users\\u', 'AppData', 'Local', 'mage'));
  });

  it('userProfilePaths_windows_mageYMageDev', () => {
    expect(userProfilePaths({ platform: 'win32', env: { APPDATA: 'C:\\A' }, home: 'H' })).toEqual([join('C:\\A', 'mage'), join('C:\\A', 'mage-dev')]);
  });

  it('userProfilePaths_linux_xdgConfig', () => {
    expect(userProfilePaths({ platform: 'linux', env: {}, home: '/home/u' })).toEqual([join('/home/u', '.config', 'mage'), join('/home/u', '.config', 'mage-dev')]);
  });
});
