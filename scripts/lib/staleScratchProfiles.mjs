import { createHash } from 'node:crypto';
import { join } from 'node:path';

// Carpetas que dejan los perfiles de Mage en la raíz local: `<raíz local>/mage/<16 hex del sha256 de su userData>`.
export const PROFILE_DIR_PATTERN = /^[0-9a-f]{16}$/;

export function profileHash(userData) {
  if (typeof userData !== 'string' || userData.length === 0) throw new Error(`userData no válido: ${JSON.stringify(userData)}`);
  return createHash('sha256').update(userData).digest('hex').slice(0, 16);
}

// Raíz local de Mage, con la misma regla que la app: Windows %LOCALAPPDATA%/mage; Linux y macOS XDG_DATA_HOME/mage.
export function localMageRootFor({ platform, env, home }) {
  const local = platform === 'win32' ? env.LOCALAPPDATA || join(home, 'AppData', 'Local') : env.XDG_DATA_HOME || join(home, '.local', 'share');
  return join(local, 'mage');
}

// Carpeta de datos de aplicación de Electron (`appData`) en cada sistema.
function appDataFor({ platform, env, home }) {
  if (platform === 'win32') return env.APPDATA || join(home, 'AppData', 'Roaming');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support');
  return env.XDG_CONFIG_HOME || join(home, '.config');
}

// Los perfiles del usuario que nunca se tocan: el de la app instalada y el de desarrollo (`pnpm dev`).
export function userProfilePaths(system) {
  const appData = appDataFor(system);
  return [join(appData, 'mage'), join(appData, 'mage-dev')];
}

// Nombres de carpeta de perfil que NO son de ninguno de `keepUserData`. Lo que no tiene forma de perfil no se toca.
export function staleProfileDirs(entryNames, keepUserData) {
  const keep = new Set(keepUserData.map(profileHash));
  return entryNames.filter((name) => PROFILE_DIR_PATTERN.test(name) && !keep.has(name));
}
