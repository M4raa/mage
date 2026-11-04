import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { accountsHomeFrom, decideTestHome, TEST_HOME_ENV } from './testHome';

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
