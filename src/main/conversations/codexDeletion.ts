import { localized, UserFacingError } from '@shared/i18n/localizedText';
import type { CodexHistoryService } from './codexHistory';

export interface CodexDeletionDeps {
  readonly history: Pick<CodexHistoryService, 'childThreadsOf'>;
  // `codexThreadDelete` en producción.
  readonly deleteThread: (home: string, threadId: string) => Promise<void>;
  // `rewindState.forgetThread`.
  readonly forget: (threadId: string) => void;
  readonly log: (level: 'warn', message: string, data?: unknown) => void;
}

// Lo que dice Codex (medido) al borrar un padre del que cuelga un fork.
const FORKED_HISTORY_ERROR = 'forked history still references it';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// A5: primero los hijos de review (si no, quedarían huérfanos en sessions/); después el hilo. X-3: con copias divergentes,
// Codex no deja borrar el padre y el error se traduce.
export async function deleteCodexConversation(deps: CodexDeletionDeps, home: string, threadId: string): Promise<void> {
  for (const child of deps.history.childThreadsOf(home, threadId)) await deleteChild(deps, home, child);
  try {
    await deps.deleteThread(home, threadId);
  } catch (error) {
    if (errorText(error).includes(FORKED_HISTORY_ERROR)) throw new UserFacingError(localized('errors.rewind.hasCopies'));
    throw error;
  }
  deps.forget(threadId);
}

// Es limpieza: un hijo que falla se avisa y no impide borrar el padre.
async function deleteChild(deps: CodexDeletionDeps, home: string, child: string): Promise<void> {
  try {
    await deps.deleteThread(home, child);
    deps.forget(child);
  } catch (error) {
    deps.log('warn', 'No se pudo borrar un hilo hijo de review de Codex', { threadId: child, error: errorText(error) });
  }
}
