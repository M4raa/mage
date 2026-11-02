import { join } from 'node:path';

// null conserva la elección de Electron, incluido el perfil explícito de verify:gui.
export function developmentUserData(isPackaged: boolean, argv: readonly string[], appData: string): string | null {
  if (isPackaged || argv.some((arg) => arg === '--user-data-dir' || arg.startsWith('--user-data-dir='))) return null;
  return join(appData, 'mage-dev');
}
