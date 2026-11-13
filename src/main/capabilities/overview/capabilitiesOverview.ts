// Lector de las capacidades de una cuenta de Claude: políticas de la organización, plugins instalados y ajustes
// gestionados del equipo. Solo lee; el FS se inyecta. Ver `policyFiles.ts` y `pluginFiles.ts` para las formas medidas.
import { dirname, join, relative } from 'node:path';
import type { CapabilitiesOverview, ManagedSettingsView } from '@shared/capabilities';
import type { CapabilityFs } from '../capabilityFs';
import { parseInstalledPlugins } from './pluginFiles';
import { parseManagedFile, parsePolicyLimits, parseRemoteSettings } from './policyFiles';

export type OverviewFs = Pick<CapabilityFs, 'exists' | 'readFile' | 'listFiles'>;
export interface OverviewDeps { readonly fs: OverviewFs; readonly managedDir: string }

export const POLICY_LIMITS_FILE = 'policy-limits.json';
export const REMOTE_SETTINGS_FILE = 'remote-settings.json';
export const MANAGED_SETTINGS_FILE = 'managed-settings.json';
export const MANAGED_DROP_IN_DIR = 'managed-settings.d';
const JSON_EXTENSION = '.json';

// Carpeta de los ajustes gestionados del equipo. MEDIDA en las cadenas del binario de Claude Code 2.1.319: el CLI la fija
// así, sin variables de entorno. Con el HOME de prueba de verify:gui, una carpeta dentro de él: la tanda nunca escribe en
// la del sistema.
export function managedSettingsDir(platform: NodeJS.Platform, testHome: string | null): string {
  if (testHome !== null) return join(testHome, 'managed-settings');
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode';
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode';
  return '/etc/claude-code';
}

function readTextOrNull(fs: OverviewFs, path: string): string | null {
  return fs.exists(path) ? fs.readFile(path).toString('utf8') : null;
}

// managed-settings.json y los .json directos de managed-settings.d, en ese orden.
export function readManagedSettings(deps: OverviewDeps): ManagedSettingsView {
  const main = join(deps.managedDir, MANAGED_SETTINGS_FILE);
  const dropInDir = join(deps.managedDir, MANAGED_DROP_IN_DIR);
  const dropIns = deps.fs
    .listFiles(dropInDir)
    .filter((file) => dirname(file) === dropInDir && file.endsWith(JSON_EXTENSION))
    .sort();
  const files = [main, ...dropIns]
    .filter((file) => deps.fs.exists(file))
    .map((file) => parseManagedFile(relative(deps.managedDir, file), readTextOrNull(deps.fs, file)));
  return { dir: deps.managedDir, files };
}

// Todo lo que Mage enseña de UNA cuenta de Claude, ya resumido y sin valores que puedan ser secretos.
export function readCapabilitiesOverview(deps: OverviewDeps, accountDir: string): CapabilitiesOverview {
  const read = (...parts: string[]): string | null => readTextOrNull(deps.fs, join(accountDir, ...parts));
  const installed = parseInstalledPlugins(read('plugins', 'installed_plugins.json'), read('settings.json'));
  return {
    accountDir,
    policies: { ...parsePolicyLimits(read(POLICY_LIMITS_FILE)), ...parseRemoteSettings(read(REMOTE_SETTINGS_FILE)) },
    managed: readManagedSettings(deps),
    pluginsState: installed.state,
    plugins: installed.plugins,
  };
}
