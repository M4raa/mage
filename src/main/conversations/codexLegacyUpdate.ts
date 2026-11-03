import { basename, join } from 'node:path';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import type { CodexHistoryService } from './codexHistory';

export interface CodexLegacyUpdateDeps {
  readonly history: Pick<CodexHistoryService, 'threadFiles' | 'historyModeOf'>;
  // join(userData, 'codex-backups')
  readonly backupRoot: string;
  // Recursivo.
  readonly mkdir: (dir: string) => void;
  readonly copyFile: (from: string, to: string) => void;
  readonly runCodex: (home: string, args: readonly string[]) => Promise<{ readonly exitCode: number | null; readonly stderr: string }>;
  readonly now: () => number;
}

const STDERR_TAIL_CHARS = 500;

// U13: copia previa de los rollout del hilo en la carpeta de copias de Mage y `codex migrate-rollouts --apply --thread <id>`.
// Lo que el comando hace con los ficheros está NO MEDIDO (punto de control de K10): por eso se copia antes y se comprueba después.
export async function updateLegacyCodexThread(deps: CodexLegacyUpdateDeps, home: string, threadId: string): Promise<{ readonly backupDir: string }> {
  if (deps.history.historyModeOf(home, threadId) !== 'legacy') throw new UserFacingError(localized('errors.rewind.notLegacy'));
  const files = deps.history.threadFiles(home, threadId);
  if (files.length === 0) throw new UserFacingError(localized('errors.rewind.notFound'));
  const backupDir = backUp(deps, threadId, files);
  const { exitCode, stderr } = await deps.runCodex(home, ['migrate-rollouts', '--apply', '--thread', threadId]);
  if (exitCode !== 0) {
    throw new UserFacingError(localized('errors.rewind.legacyUpdateFailed', { detail: stderr.trim().slice(-STDERR_TAIL_CHARS) }));
  }
  if (deps.history.historyModeOf(home, threadId) === 'legacy') {
    throw new UserFacingError(localized('errors.rewind.legacyUpdateUnverified', { backupDir }));
  }
  return { backupDir };
}

// Si una copia falla, el error se propaga y no se migra.
function backUp(deps: CodexLegacyUpdateDeps, threadId: string, files: readonly string[]): string {
  const stamp = new Date(deps.now()).toISOString().replace(/[:.]/g, '-');
  const backupDir = join(deps.backupRoot, `${threadId}-${stamp}`);
  deps.mkdir(backupDir);
  for (const file of files) deps.copyFile(file, join(backupDir, basename(file)));
  return backupDir;
}
