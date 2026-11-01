import { createHash } from 'node:crypto';
import { join, relative, isAbsolute } from 'node:path';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import { resolvedPath } from './resolvedPath';
import { isTrusted } from './workspaceTrust';

export interface WorkspacePaths { readonly platform: NodeJS.Platform; readonly home: string; readonly userData: string; readonly temp: string; readonly env: NodeJS.ProcessEnv; }
// Raíz local (no itinerante) de Mage, COMPARTIDA por todos sus perfiles: Windows %LOCALAPPDATA%/mage, Linux y macOS
// XDG_DATA_HOME/mage. De aquí cuelgan los borradores de cada perfil (R32) y los locks de conversación (#55).
export function localMageRoot(paths: Pick<WorkspacePaths, 'platform' | 'home' | 'env'>): string {
  const local = paths.platform === 'win32' ? paths.env.LOCALAPPDATA || join(paths.home, 'AppData', 'Local') : paths.env.XDG_DATA_HOME || join(paths.home, '.local', 'share');
  return join(local, 'mage');
}
export function localScratchRoot(paths: WorkspacePaths): string {
  const profile = createHash('sha256').update(paths.userData).digest('hex').slice(0, 16);
  return join(localMageRoot(paths), profile, 'mage-scratch');
}
export function workspaceTrusted(cwd: string, own: readonly string[], roots: readonly string[]): boolean {
  const canonical = resolvedPath(cwd);
  return roots.some(root => within(canonical, resolvedPath(root))) || isTrusted(canonical, own.filter(folder => folder.trim().length > 0).map(folder => resolvedPath(folder)));
}
export function ensureWorkingDirectory(cwd: string, roots: readonly string[], fs: { exists: (p: string) => boolean; mkdir: (p: string) => void }): boolean {
  if (fs.exists(cwd)) return false;
  const canonical = resolvedPath(cwd);
  if (roots.some(root => { const part = relative(resolvedPath(root), canonical); return /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(part); })) { fs.mkdir(canonical); return true; }
  throw new UserFacingError(localized('errors.os.workingDirectoryGone', { cwd }));
}

function within(target: string, root: string): boolean { const part = relative(root, target); return part === '' || (!part.startsWith('..') && !isAbsolute(part)); }
