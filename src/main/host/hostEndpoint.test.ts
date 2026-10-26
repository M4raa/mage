import { describe, expect, it } from 'vitest';
import { MAX_UNIX_SOCKET_PATH_BYTES, profileHash, resolveHostEndpoint, tokenFilePath } from './hostEndpoint';

describe('profileHash', () => {
  it('profileHash_mismaRuta_mismoHashDeDoceHex', () => {
    expect(profileHash('/home/u/.config/Mage', 'linux')).toMatch(/^[0-9a-f]{12}$/);
    expect(profileHash('/home/u/.config/Mage', 'linux')).toBe(profileHash('/home/u/.config/Mage', 'linux'));
  });

  it('profileHash_windowsMayusculasDistintas_mismoHash', () => {
    expect(profileHash('C:\\Users\\Ana\\AppData\\Roaming\\mage', 'win32')).toBe(profileHash('c:\\users\\ana\\appdata\\roaming\\Mage', 'win32'));
  });

  it('profileHash_linuxMayusculasDistintas_hashDistinto', () => {
    expect(profileHash('/home/u/Mage', 'linux')).not.toBe(profileHash('/home/u/mage', 'linux'));
  });

  it('profileHash_rutaVacia_lanza', () => {
    expect(() => profileHash('', 'linux')).toThrow(/vacío/);
  });
});

describe('resolveHostEndpoint', () => {
  it('resolveHostEndpoint_windows_namedPipeSinDirectorio', () => {
    const endpoint = resolveHostEndpoint({ platform: 'win32', userDataDir: 'C:\\Users\\Ana\\AppData\\Roaming\\mage', xdgRuntimeDir: undefined });

    expect(endpoint.kind).toBe('pipe');
    expect(endpoint.address).toMatch(/^\\\\\.\\pipe\\mage-[0-9a-f]{12}-v1$/);
    expect(endpoint.directory).toBeNull();
  });

  it('resolveHostEndpoint_linuxConXdg_socketEnRuntimeDir', () => {
    const endpoint = resolveHostEndpoint({ platform: 'linux', userDataDir: '/home/u/.config/Mage', xdgRuntimeDir: '/run/user/1000' });

    expect(endpoint.kind).toBe('unix');
    expect(endpoint.directory).toBe('/run/user/1000/mage');
    expect(endpoint.address).toMatch(/^\/run\/user\/1000\/mage\/[0-9a-f]{12}\.sock$/);
  });

  it('resolveHostEndpoint_sinXdg_socketEnUserDataRun', () => {
    const endpoint = resolveHostEndpoint({ platform: 'darwin', userDataDir: '/Users/u/Library/Application Support/Mage', xdgRuntimeDir: undefined });

    expect(endpoint.directory).toBe('/Users/u/Library/Application Support/Mage/run');
  });

  it('resolveHostEndpoint_xdgVacio_cuentaComoAusente', () => {
    const endpoint = resolveHostEndpoint({ platform: 'linux', userDataDir: '/home/u/.config/Mage', xdgRuntimeDir: '' });

    expect(endpoint.directory).toBe('/home/u/.config/Mage/run');
  });

  it('resolveHostEndpoint_rutaDemasiadoLarga_lanzaConLosBytesYLaRuta', () => {
    const userDataDir = `/home/${'a'.repeat(120)}/Mage`;

    expect(() => resolveHostEndpoint({ platform: 'linux', userDataDir, xdgRuntimeDir: undefined })).toThrow(
      new RegExp(`máximo es ${MAX_UNIX_SOCKET_PATH_BYTES}.*${'a'.repeat(120)}`),
    );
  });

  it('resolveHostEndpoint_rutaDeExactamenteElTope_seAcepta', () => {
    const hash = profileHash('/x', 'linux');
    const overhead = Buffer.byteLength(`/${hash}.sock`, 'utf8');
    const xdg = `/${'b'.repeat(MAX_UNIX_SOCKET_PATH_BYTES - overhead - '/mage'.length - 1)}`;

    const endpoint = resolveHostEndpoint({ platform: 'linux', userDataDir: '/x', xdgRuntimeDir: xdg });

    expect(Buffer.byteLength(endpoint.address, 'utf8')).toBe(MAX_UNIX_SOCKET_PATH_BYTES);
  });
});

describe('tokenFilePath', () => {
  it('tokenFilePath_cualquierPlataforma_vivePorDebajoDeUserDataRun', () => {
    expect(tokenFilePath({ platform: 'linux', userDataDir: '/home/u/.config/Mage', xdgRuntimeDir: undefined })).toBe('/home/u/.config/Mage/run/host-token');
  });
});
