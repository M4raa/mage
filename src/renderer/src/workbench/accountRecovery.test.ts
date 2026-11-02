import { describe, expect, it } from 'vitest';
import { accountRecovery } from './accountRecovery';

const claude = { isMain: false, loginStatus: 'expired', providerId: 'claude', apiBilled: false } as const;

describe('accountRecovery (#18)', () => {
  it('accountRecovery_conLoginValido_null', () => {
    expect(accountRecovery({ ...claude, loginStatus: 'logged_in' })).toBeNull();
  });

  it('accountRecovery_principalDeClaudeCaducada_ofreceIniciarSesionSinEliminar', () => {
    expect(accountRecovery({ ...claude, isMain: true })).toEqual({ relogin: true, remove: false });
  });

  it('accountRecovery_secundariaDeClaudeSinLogin_ofreceAmbas', () => {
    expect(accountRecovery({ ...claude, loginStatus: 'logged_out' })).toEqual({ relogin: true, remove: true });
  });

  it('accountRecovery_cuentaDeApi_noOfreceIniciarSesion', () => {
    expect(accountRecovery({ ...claude, apiBilled: true })).toEqual({ relogin: false, remove: true });
  });

  it('accountRecovery_otroProveedorPrincipal_nada', () => {
    expect(accountRecovery({ ...claude, providerId: 'codex', isMain: true })).toBeNull();
  });
});
