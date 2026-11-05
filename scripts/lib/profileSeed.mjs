import fs from 'node:fs';
import path from 'node:path';

// Ajustes iniciales del perfil AISLADO de verify:gui (nunca el del usuario). `trustedFolders` solo lo usa la medición de
// rendimiento: su conversación larga vive en una carpeta del perfil que, sin confianza, abre TrustFolderDialog encima
// de la medición (V7, `--prod`).
// Un número alto y no ONBOARDING_VERSION (vive en un .ts que un script no importa): subir la versión del asistente no vuelve a tapar la tanda.
const ONBOARDING_DONE_VERSION = 9999;

export function seededAppSettings({ appVersion, trustedFolders = [] }) {
  if (typeof appVersion !== 'string' || appVersion.length === 0) throw new Error(`appVersion no valida: ${JSON.stringify(appVersion)}`);
  if (!Array.isArray(trustedFolders) || trustedFolders.some((folder) => typeof folder !== 'string' || folder.length === 0)) {
    throw new Error(`trustedFolders no validas: ${JSON.stringify(trustedFolders)}`);
  }
  return { version: 1, notificationRules: [], onboardingCompletedVersion: ONBOARDING_DONE_VERSION, lastSeenReleaseNotesVersion: appVersion, ...(trustedFolders.length === 0 ? {} : { trustedFolders: [...trustedFolders] }) };
}

// Cuentas de Claude de PRUEBA con login para el HOME de prueba: un token inventado que nunca sale a la red (main cierra la
// red del uso y de la renovación con MAGE_TEST_HOME). La principal y una segunda, para «31» (cambiar de cuenta).
export const TEST_ACCOUNT_DIRS = ['.claude', '.claude-vg2'];
export const TEST_ACCOUNT_TOKEN = 'vg-token-de-prueba-sin-red';
// 2100-01-01: no caduca durante ninguna tanda.
export const TEST_ACCOUNT_EXPIRES_AT = Date.UTC(2100, 0, 1);

export function seedTestAccounts(home, fsApi = fs) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw new Error(`HOME de prueba no valido: ${JSON.stringify(home)}`);
  const credentials = { claudeAiOauth: { accessToken: TEST_ACCOUNT_TOKEN, refreshToken: TEST_ACCOUNT_TOKEN, expiresAt: TEST_ACCOUNT_EXPIRES_AT, scopes: [] } };
  return TEST_ACCOUNT_DIRS.map((dir) => {
    const accountDir = path.join(home, dir);
    fsApi.mkdirSync(accountDir, { recursive: true });
    fsApi.writeFileSync(path.join(accountDir, '.credentials.json'), JSON.stringify(credentials), 'utf-8');
    return accountDir;
  });
}
