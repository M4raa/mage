import { describe, expect, it } from 'vitest';
import { clearLockout, EMPTY_LOCKOUT_STATE, isLockedOut, lockOut, remainingLockoutMs } from './lockoutPolicy';

describe('lockOut + isLockedOut', () => {
  it('claveRecienBloqueada_estaBloqueadaHastaQueExpire', () => {
    const state = lockOut(EMPTY_LOCKOUT_STATE, 'acc1', 1_000, 5_000);

    expect(isLockedOut(state, 'acc1', 1_000)).toBe(true);
    expect(isLockedOut(state, 'acc1', 5_999)).toBe(true);
    expect(isLockedOut(state, 'acc1', 6_000)).toBe(false); // exactamente al expirar, ya no
  });

  it('claveNuncaBloqueada_noEstaBloqueada', () => {
    expect(isLockedOut(EMPTY_LOCKOUT_STATE, 'acc1', 1_000)).toBe(false);
  });

  it('dosClavesDistintas_sonIndependientes', () => {
    const state = lockOut(EMPTY_LOCKOUT_STATE, 'acc1', 1_000, 5_000);

    expect(isLockedOut(state, 'acc2', 1_000)).toBe(false);
  });

  it('segundoLockout_sobrescribeElAnterior', () => {
    const first = lockOut(EMPTY_LOCKOUT_STATE, 'acc1', 1_000, 5_000); // bloqueado hasta 6_000
    const second = lockOut(first, 'acc1', 1_000, 100); // ahora hasta 1_100

    // 1_150 esta DENTRO del bloqueo largo original (hasta 6_000) pero FUERA del corto (hasta 1_100):
    // si el largo siguiera mandando, esto seguiria bloqueado.
    expect(isLockedOut(second, 'acc1', 1_150)).toBe(false);
  });

  it('durationMsNoPositiva_lanza', () => {
    expect(() => lockOut(EMPTY_LOCKOUT_STATE, 'acc1', 1_000, 0)).toThrow(/positivo/);
    expect(() => lockOut(EMPTY_LOCKOUT_STATE, 'acc1', 1_000, -1)).toThrow(/positivo/);
  });

  it('noMutaElEstadoRecibido', () => {
    lockOut(EMPTY_LOCKOUT_STATE, 'acc1', 1_000, 5_000);

    expect(EMPTY_LOCKOUT_STATE.lockedUntilByKey).toEqual({});
  });
});

describe('remainingLockoutMs', () => {
  it('bloqueada_devuelveLoQueQueda', () => {
    const state = lockOut(EMPTY_LOCKOUT_STATE, 'acc1', 1_000, 5_000);

    expect(remainingLockoutMs(state, 'acc1', 2_000)).toBe(4_000);
  });

  it('yaExpirada_devuelveCero', () => {
    const state = lockOut(EMPTY_LOCKOUT_STATE, 'acc1', 1_000, 5_000);

    expect(remainingLockoutMs(state, 'acc1', 9_000)).toBe(0);
  });

  it('nuncaBloqueada_devuelveCero', () => {
    expect(remainingLockoutMs(EMPTY_LOCKOUT_STATE, 'acc1', 1_000)).toBe(0);
  });
});

describe('clearLockout', () => {
  it('claveBloqueada_laDesbloquea', () => {
    const state = lockOut(EMPTY_LOCKOUT_STATE, 'acc1', 1_000, 5_000);

    expect(isLockedOut(clearLockout(state, 'acc1'), 'acc1', 1_000)).toBe(false);
  });

  it('claveNoBloqueada_devuelveLaMismaReferencia', () => {
    expect(clearLockout(EMPTY_LOCKOUT_STATE, 'acc1')).toBe(EMPTY_LOCKOUT_STATE);
  });

  it('soloAfectaALaClaveIndicada', () => {
    const state = lockOut(lockOut(EMPTY_LOCKOUT_STATE, 'acc1', 1_000, 5_000), 'acc2', 1_000, 5_000);

    const cleared = clearLockout(state, 'acc1');

    expect(isLockedOut(cleared, 'acc1', 1_000)).toBe(false);
    expect(isLockedOut(cleared, 'acc2', 1_000)).toBe(true);
  });
});
