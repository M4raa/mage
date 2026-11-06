import type { RewindStateStore } from './rewindStateStore';

// Lo que Mage guarda de una conversación borrada, sea del proveedor que sea: su entrada del índice (2.1; sin esto el
// fichero crece para siempre), su catálogo de PR, sus pensamientos (si no, queda un `.jsonl` huérfano) y su estado del
// rewind (corte pendiente, fork, copia y keep-alive).
export interface DeletedConversationDeps {
  readonly index: { forgetConversation(sessionId: string): void };
  readonly prCatalog: { forgetConversation(sessionId: string): void };
  readonly thinking: { forget(sessionId: string): void };
  readonly rewindState: Pick<RewindStateStore, 'forgetThread'>;
}

export function forgetDeletedConversation(deps: DeletedConversationDeps, sessionId: string): void {
  deps.index.forgetConversation(sessionId);
  deps.prCatalog.forgetConversation(sessionId);
  deps.thinking.forget(sessionId);
  deps.rewindState.forgetThread(sessionId);
}
