import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commandOnPathCheck, executableFileCheck, isOnPath, type CommandLookupDeps } from './commandOnPath';

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

// H2 de la devolución 17: en Arch no hay `which`, y con él todo salía «no está». En POSIX se recorre el PATH.
describe('commandOnPathCheck', () => {
  const linux = (executables: readonly string[], where = (): boolean => { throw new Error('no debía llamar a where'); }): CommandLookupDeps => ({
    platform: 'linux',
    env: { PATH: ['/usr/local/bin', '/usr/bin'].join(delimiter) },
    isExecutableFile: (path) => executables.includes(path),
    where,
  });

  it('lookup_linuxSinWhich_encuentraElComandoEnElPath', () => {
    expect(commandOnPathCheck(linux([join('/usr/bin', 'claude')]))('claude')).toBe(true);
  });

  it('lookup_linuxNoEsta_false', () => {
    expect(commandOnPathCheck(linux([join('/usr/bin', 'claude')]))('codex')).toBe(false);
  });

  it('lookup_linuxConBarra_esUnaRutaYNoSeBuscaEnElPath', () => {
    const check = commandOnPathCheck(linux(['/opt/agy/bin/agy']));

    expect(check('/opt/agy/bin/agy')).toBe(true);
    expect(check('/opt/otra/agy')).toBe(false);
  });

  it('lookup_windows_usaWhere', () => {
    const asked: string[] = [];
    const check = commandOnPathCheck({ platform: 'win32', env: {}, isExecutableFile: () => false, where: (bin) => { asked.push(bin); return bin === 'code'; } });

    expect(check('code')).toBe(true);
    expect(check('cursor')).toBe(false);
    expect(asked).toEqual(['code', 'cursor']);
  });

  it('lookup_comandoVacio_lanza', () => {
    expect(() => commandOnPathCheck(linux([]))('')).toThrow('vacío');
  });
});
