import { describe, expect, it } from 'vitest';
import { seededAppSettings } from './profileSeed.mjs';

describe('seededAppSettings', () => {
  it('seededAppSettings_sinCarpetas_noEscribeTrustedFolders', () => {
    const settings = seededAppSettings({ appVersion: '0.1.4' });

    expect(settings).toEqual({ version: 1, notificationRules: [], onboardingCompletedVersion: 9999, lastSeenReleaseNotesVersion: '0.1.4' });
    expect(Object.hasOwn(settings, 'trustedFolders')).toBe(false);
  });

  it('seededAppSettings_conCarpeta_laConfia', () => {
    const settings = seededAppSettings({ appVersion: '0.1.4', trustedFolders: ['C:\perfil\vg-t3-cwd'] });

    expect(settings.trustedFolders).toEqual(['C:\perfil\vg-t3-cwd']);
  });

  it('seededAppSettings_versionVacia_lanzaConElValor', () => {
    expect(() => seededAppSettings({ appVersion: '' })).toThrow('appVersion no valida: ""');
  });

  it('seededAppSettings_carpetaVacia_lanzaConElValor', () => {
    expect(() => seededAppSettings({ appVersion: '0.1.4', trustedFolders: [''] })).toThrow('trustedFolders no validas: [""]');
  });
});
