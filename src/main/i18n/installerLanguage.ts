import type { UiLanguagePreference } from '@shared/i18n/language';
import type { SessionLogFn } from '../engine/agentSession';

// Idioma elegido en el instalador de Windows (U3 de F3): el instalador deja `es` o `en` en este fichero de userData y
// Mage lo usa como preferencia inicial mientras el usuario no elija otro en Ajustes. En Linux y macOS no existe.
export const INSTALLER_LANGUAGE_FILE = 'installer-language';
const INSTALLER_LANGUAGES: readonly UiLanguagePreference[] = ['es', 'en'];

export interface InstallerLanguageDeps {
  readonly filePath: string;
  // Contenido del fichero, o null si no existe.
  readonly readFile: (path: string) => string | null;
  readonly log: SessionLogFn;
}

// Sin fichero: no hay preferencia inicial. Con un contenido que no se entiende se avisa en el log y se sigue al sistema.
export function readInstallerLanguage(deps: InstallerLanguageDeps): UiLanguagePreference | undefined {
  const text = deps.readFile(deps.filePath);
  if (text === null) return undefined;
  const value = text.trim();
  const language = INSTALLER_LANGUAGES.find((candidate) => candidate === value);
  if (language === undefined) deps.log('warn', 'Idioma del instalador no reconocido: se sigue al sistema', { file: deps.filePath, value: value.slice(0, 16) });
  return language;
}
