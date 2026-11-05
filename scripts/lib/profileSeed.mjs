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
