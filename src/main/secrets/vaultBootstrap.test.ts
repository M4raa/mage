import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executableFileCheck, isOnPath } from './vaultBootstrap';

describe('isOnPath', () => {
  it('isOnPath_binarioEnUnDirectorioDelPath_true', () => {
    const present = join('/usr/bin', 'gnome-keyring-daemon');

    expect(isOnPath('gnome-keyring-daemon', { env: { PATH: ['/bin', '/usr/bin'].join(delimiter) }, isExecutableFile: (path) => path === present })).toBe(true);
  });

  it('isOnPath_sinPathOVacio_false', () => {
    expect(isOnPath('gnome-keyring-daemon', { env: {}, isExecutableFile: () => true })).toBe(false);
    expect(isOnPath('gnome-keyring-daemon', { env: { PATH: '' }, isExecutableFile: () => true })).toBe(false);
  });
});

describe('executableFileCheck', () => {
  const fail = (code: string) => () => {
    throw Object.assign(new Error(code), { code });
  };

  it.each(['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'])('check_%s_false', (code) => {
    expect(executableFileCheck({ accessSync: fail(code), statSync: () => ({ isFile: () => true }), executableMode: 1 })('/x')).toBe(false);
  });

  it('check_otroError_sePropaga', () => {
    expect(() => executableFileCheck({ accessSync: fail('EIO'), statSync: () => ({ isFile: () => true }), executableMode: 1 })('/x')).toThrow('EIO');
  });

  it('check_directorioEjecutable_false', () => {
    expect(executableFileCheck({ accessSync: () => undefined, statSync: () => ({ isFile: () => false }), executableMode: 1 })('/usr/bin')).toBe(false);
  });

  it('check_ficheroEjecutable_true', () => {
    expect(executableFileCheck({ accessSync: () => undefined, statSync: () => ({ isFile: () => true }), executableMode: 1 })('/usr/bin/x')).toBe(true);
  });
});
