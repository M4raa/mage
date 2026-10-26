import { describe, expect, it } from 'vitest';
import { ANOTHER_INSTANCE_MESSAGE, HEADLESS_FLAG, HEADLESS_GUI_UNAVAILABLE, isHeadlessHost, lockFailureMessage, NO_SANDBOX_WARNING, startupWarnings } from './startupMode';

const linux = { platform: 'linux' as const, argv: ['electron', '.'], env: {} };

describe('isHeadlessHost', () => {
  it('isHeadlessHost_linuxSinDisplayNiWayland_true', () => {
    expect(isHeadlessHost(linux)).toBe(true);
  });

  it.each([['DISPLAY', ':0'], ['WAYLAND_DISPLAY', 'wayland-0']])('isHeadlessHost_linuxCon%s_false', (name, value) => {
    expect(isHeadlessHost({ ...linux, env: { [name]: value } })).toBe(false);
  });

  it('isHeadlessHost_displayVacio_cuentaComoAusente', () => {
    expect(isHeadlessHost({ ...linux, env: { DISPLAY: '' } })).toBe(true);
  });

  it.each(['win32', 'darwin'] as const)('isHeadlessHost_%sSinDisplay_false', (platform) => {
    expect(isHeadlessHost({ platform, argv: [], env: {} })).toBe(false);
  });

  it('isHeadlessHost_flagExplicito_trueEnCualquierPlataforma', () => {
    expect(isHeadlessHost({ platform: 'win32', argv: ['x', HEADLESS_FLAG], env: {} })).toBe(true);
    expect(isHeadlessHost({ platform: 'linux', argv: [HEADLESS_FLAG], env: { DISPLAY: ':0' } })).toBe(true);
  });
});

describe('startupWarnings', () => {
  it('startupWarnings_linuxConNoSandbox_avisaConElMotivoYLaRecomendacion', () => {
    const warnings = startupWarnings({ platform: 'linux', hasNoSandboxSwitch: true });

    expect(warnings).toEqual([NO_SANDBOX_WARNING]);
    expect(NO_SANDBOX_WARNING.body).toMatch(/\.deb/);
    expect(NO_SANDBOX_WARNING.body).toMatch(/espacios de nombres/);
  });

  it('startupWarnings_linuxSinElSwitch_sinAvisos', () => {
    expect(startupWarnings({ platform: 'linux', hasNoSandboxSwitch: false })).toEqual([]);
  });

  it.each(['win32', 'darwin'] as const)('startupWarnings_%sConElSwitch_sinAvisos', (platform) => {
    expect(startupWarnings({ platform, hasNoSandboxSwitch: true })).toEqual([]);
  });
});

describe('lockFailureMessage', () => {
  it('lockFailureMessage_elQueTieneElLockEsUnHostSinPantalla_dicePorQueNoHayInterfazYNoPrometeEnfocar', () => {
    const message = lockFailureMessage('headless');

    expect(message).toContain(HEADLESS_GUI_UNAVAILABLE);
    expect(message).not.toMatch(/se enfoca/);
  });

  it.each([['gui' as const], [null]])('lockFailureMessage_holder%s_elAvisoDeSiempre', (mode) => {
    expect(lockFailureMessage(mode)).toBe(ANOTHER_INSTANCE_MESSAGE);
  });
});
