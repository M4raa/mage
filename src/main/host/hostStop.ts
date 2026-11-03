import type { ConversationSnapshot } from '@shared/coordination';
import type { HostMode } from './hostServer';

// `mage stop` (U18 y la tabla de señales D4): qué hace el host cuando un cliente le pide cerrarse. Puro.
// - Con ventana: siempre rechaza, también con `force`. La terminal nunca cierra una ventana que se está usando.
// - Sin ventana y con trabajo activo: rechaza y lista las sesiones, salvo `force`.
// - Sin ventana y sin trabajo (o con `force`): se cierra.

// Lo que tarda main en salir tras contestar «stopping»: da tiempo a que la respuesta llegue al cliente.
export const HOST_STOP_DELAY_MS = 200;

export interface ActiveSessionSummary {
  readonly sessionId: string;
  readonly conversationId: string | null;
  readonly provider: string;
  readonly state: ConversationSnapshot['state'];
}

export type HostStopResult =
  | { readonly outcome: 'stopping' }
  | { readonly outcome: 'refused'; readonly reason: 'gui' }
  | { readonly outcome: 'refused'; readonly reason: 'active'; readonly sessions: readonly ActiveSessionSummary[] };

const BUSY_STATES: ReadonlySet<ConversationSnapshot['state']> = new Set(['running', 'requires_action', 'starting', 'restarting']);

// Trabajo activo = un turno en marcha o arrancando, una petición esperando respuesta o mensajes en cola.
export function hasActiveWork(snapshot: ConversationSnapshot): boolean {
  return BUSY_STATES.has(snapshot.state) || snapshot.pending.length > 0 || snapshot.queue.length > 0;
}

export function decideStop(input: { readonly mode: HostMode; readonly force: boolean; readonly sessions: readonly ConversationSnapshot[] }): HostStopResult {
  if (input.mode === 'gui') return { outcome: 'refused', reason: 'gui' };
  const active = input.sessions.filter(hasActiveWork).map(summarize);
  if (active.length > 0 && !input.force) return { outcome: 'refused', reason: 'active', sessions: active };
  return { outcome: 'stopping' };
}

function summarize(snapshot: ConversationSnapshot): ActiveSessionSummary {
  return { sessionId: snapshot.sessionId, conversationId: snapshot.conversationId, provider: snapshot.provider, state: snapshot.state };
}
