import type { SessionCoordinator } from '../coordination/sessionCoordinator';
import type { LogFn } from '../debug/logBus';
import type { ConversationIndexStore, HostSessionRecord } from '../state/conversationIndexStore';

// Las sesiones del host (terminal y MCP) no tienen una ventana que guarde en el índice con qué cuenta y modelo se usan:
// lo guarda main en cuanto la sesión tiene conversación (y otra vez si cambia, p. ej. tras un /clear), marcándola como de
// esa cuenta para que la ventana nunca la abra con otra (facturación). Es un suscriptor más del coordinador que NO
// mantiene viva la sesión: `closeFromWindow` lo descuenta con `watchCount`, como el registro de delegaciones.
export interface HostOwnershipDeps {
  readonly coordinator: Pick<SessionCoordinator, 'subscribe'>;
  readonly index: Pick<ConversationIndexStore, 'recordHostSession'>;
  readonly log: LogFn;
}

interface Watched {
  record: HostSessionRecord;
  conversationId: string | null;
  unsubscribe: () => void;
}

export class HostOwnership {
  private readonly watched = new Map<string, Watched>();

  constructor(private readonly deps: HostOwnershipDeps) {}

  watch(sessionId: string, record: HostSessionRecord): void {
    if (this.watched.has(sessionId)) throw new Error(`HostOwnership: la sesión ${sessionId} ya está vigilada`);
    const entry: Watched = { record, conversationId: null, unsubscribe: () => undefined };
    this.watched.set(sessionId, entry);
    const subscription = this.deps.coordinator.subscribe(sessionId, {
      sink: (payload) => this.onConversation(sessionId, payload.conversationId),
      onClosed: () => this.forget(sessionId),
    });
    entry.unsubscribe = subscription.unsubscribe;
    this.onConversation(sessionId, subscription.snapshot.conversationId);
  }

  // Un cambio de modelo, esfuerzo o modo hecho fuera de la ventana (`mage chat`) también queda en el índice.
  updateOptions(sessionId: string, options: Partial<Pick<HostSessionRecord, 'model' | 'effort' | 'permissionMode'>>): void {
    const entry = this.watched.get(sessionId);
    if (entry === undefined) return;
    entry.record = { ...entry.record, ...options };
    if (entry.conversationId !== null) this.save(sessionId, entry.conversationId, entry.record);
  }

  watchCount(sessionId: string): number {
    return this.watched.has(sessionId) ? 1 : 0;
  }

  private onConversation(sessionId: string, conversationId: string | null): void {
    const entry = this.watched.get(sessionId);
    if (entry === undefined || conversationId === null || conversationId === entry.conversationId) return;
    entry.conversationId = conversationId;
    this.save(sessionId, conversationId, entry.record);
  }

  // Un fallo de disco no corta la sesión: se traza, y la conversación queda sin marca (se abre como una de la ventana).
  private save(sessionId: string, conversationId: string, record: HostSessionRecord): void {
    try {
      this.deps.index.recordHostSession(conversationId, record);
    } catch (err) {
      this.deps.log('warn', 'No se pudo guardar en el índice la cuenta de la sesión del host', { sessionId, conversationId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  private forget(sessionId: string): void {
    const entry = this.watched.get(sessionId);
    if (entry === undefined) return;
    entry.unsubscribe();
    this.watched.delete(sessionId);
  }
}
