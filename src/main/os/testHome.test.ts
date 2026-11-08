import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { accountsFetchFor, accountsHomeFrom, decideTestHome, TEST_HOME_ENV } from './testHome';

const abs = resolve(tmpdir(), 'vg-home');

describe('decideTestHome', () => {
  it('decideTestHome_sinVariable_null', () => {
    expect(decideTestHome({ env: {}, isPackaged: false })).toBeNull();
  });
  it('decideTestHome_vacia_null', () => {
    expect(decideTestHome({ env: { [TEST_HOME_ENV]: '' }, isPackaged: false })).toBeNull();
  });
  it('decideTestHome_relativa_null', () => {
    expect(decideTestHome({ env: { [TEST_HOME_ENV]: 'vg-home' }, isPackaged: false })).toBeNull();
  });
  it('decideTestHome_empaquetada_null', () => {
    expect(decideTestHome({ env: { [TEST_HOME_ENV]: abs }, isPackaged: true })).toBeNull();
  });
  it('decideTestHome_absolutaSinEmpaquetar_laDevuelveResuelta', () => {
    expect(decideTestHome({ env: { [TEST_HOME_ENV]: abs }, isPackaged: false })).toBe(resolve(abs));
  });
});

describe('accountsHomeFrom', () => {
  it('accountsHomeFrom_conPrueba_laDePrueba', () => {
    expect(accountsHomeFrom('/test', '/real')).toBe('/test');
  });
  it('accountsHomeFrom_sinPrueba_elReal', () => {
    expect(accountsHomeFrom(null, '/real')).toBe('/real');
  });
});

describe('accountsFetchFor', () => {
  it('accountsFetchFor_sinHomeDePrueba_devuelveLaReal', () => {
    const real = vi.fn();
    expect(accountsFetchFor(null, real)).toBe(real);
  });
  it('accountsFetchFor_conHomeDePrueba_rechazaConLaUrl', async () => {
    const real = vi.fn();
    const closed = accountsFetchFor('C:\\prueba', real);
    await expect(closed('https://api.anthropic.com/api/oauth/usage')).rejects.toThrow(
      new Error('Red cerrada con MAGE_TEST_HOME: https://api.anthropic.com/api/oauth/usage'),
    );
    expect(real).not.toHaveBeenCalled();
  });
  it('accountsFetchFor_conHomeDePruebaYUrlObjeto_rechazaConLaUrl', async () => {
    const closed = accountsFetchFor('C:\\prueba', vi.fn());
    await expect(closed(new URL('https://example.invalid/x'))).rejects.toThrow(/https:\/\/example\.invalid\/x$/);
  });
});
