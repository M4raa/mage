import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { seededAppSettings, seedTestAccounts, TEST_ACCOUNT_EXPIRES_AT, TEST_ACCOUNT_TOKEN } from './profileSeed.mjs';

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

describe('seedTestAccounts', () => {
  let tmp = null;
  afterEach(() => {
    if (tmp !== null) fs.rmSync(tmp, { recursive: true, force: true });
    tmp = null;
  });

  it('seedTestAccounts_homeAbsoluto_creaDosCuentasConLogin', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-seed-'));

    const dirs = seedTestAccounts(tmp);

    expect(dirs).toEqual([path.join(tmp, '.claude'), path.join(tmp, '.claude-vg2')]);
    for (const dir of dirs) {
      const oauth = JSON.parse(fs.readFileSync(path.join(dir, '.credentials.json'), 'utf-8')).claudeAiOauth;
      expect(oauth.accessToken).toBe(TEST_ACCOUNT_TOKEN);
      expect(oauth.refreshToken).toBe(TEST_ACCOUNT_TOKEN);
      expect(oauth.expiresAt).toBe(TEST_ACCOUNT_EXPIRES_AT);
    }
  });

  it('seedTestAccounts_homeRelativo_lanzaConElValor', () => {
    expect(() => seedTestAccounts('relativo')).toThrow('HOME de prueba no valido: "relativo"');
  });

  it('seedTestAccounts_tokenDePrueba_noCaduca', () => {
    expect(TEST_ACCOUNT_EXPIRES_AT).toBeGreaterThan(Date.now());
  });
});
