// U17: funciones PURAS (sin E/S) con las que la ventana principal convierte una sesión viva creada por el
// host (terminal o MCP) en una pestaña: decide si ya está ligada, si reutiliza una pestaña restaurada de
// esa conversación o si crea otra, construye la `Tab` y traduce la instantánea de main a estado de pestaña.
import type { MageEvent } from '@shared/events';
import type { ConversationSnapshot, CoordinatedState } from '@shared/coordination';
import type { AdoptableSession } from '@shared/ipc';
import type { ChatStatus, Tab } from './types';
import type { WorkbenchState } from './workbenchStore';

export type AdoptionTarget =
  | { readonly kind: 'bound' }
  | { readonly kind: 'reuse'; readonly tabId: string }
  | { readonly kind: 'new' };

// `bound`: ya hay una pestaña con esa sesión. `reuse`: una pestaña restaurada de la MISMA conversación
// (y cuenta) que aún no arrancó recibe la sesión viva en vez de duplicarse. Si no, pestaña `new`.
export function adoptionTarget(state: Pick<WorkbenchState, 'tabs' | 'sessionIdByChat'>, session: AdoptableSession): AdoptionTarget {
  if (Object.values(state.sessionIdByChat).includes(session.sessionId)) return { kind: 'bound' };
  if (session.nativeId === null) return { kind: 'new' };
  const restored = state.tabs.find(
    (t) => t.resumeSessionId === session.nativeId && t.accountId === session.accountId && state.sessionIdByChat[t.id] === undefined,
  );
  return restored === undefined ? { kind: 'new' } : { kind: 'reuse', tabId: restored.id };
}

export interface AdoptedTabIds {
  readonly tabId: string;
  readonly accountAlias: string;
  readonly title: string;
  readonly nowMs: number;
}

// El host nunca crea conversaciones privadas, y no usa worktree de Mage.
export function adoptedTab(session: AdoptableSession, ids: AdoptedTabIds): Tab {
  return {
    id: ids.tabId,
    accountId: session.accountId,
    accountAlias: ids.accountAlias,
    cwd: session.cwd,
    model: session.model,
    provider: session.provider,
    title: ids.title,
    privacy: 'shared',
    resolvedConfigDir: session.configDir,
    ...(session.nativeId === null ? {} : { resumeSessionId: session.nativeId }),
    ...(session.effort === undefined ? {} : { effort: session.effort }),
    ...(session.permissionMode === undefined ? {} : { permissionMode: session.permissionMode }),
    createdAtMs: ids.nowMs,
    worktreeOff: true,
  };
}

// Estado de la sesión en main -> estado del chat. `idle` es el resto.
const CHAT_STATUS_BY_STATE: Readonly<Record<CoordinatedState, ChatStatus>> = {
  idle: 'idle',
  running: 'streaming',
  starting: 'streaming',
  restarting: 'streaming',
  requires_action: 'needs_permission',
  error: 'error',
};

export function chatStatusOf(state: CoordinatedState): ChatStatus {
  return CHAT_STATUS_BY_STATE[state] ?? 'idle';
}

// Peticiones pendientes y cola de la instantánea como los eventos que las habrían pintado en vivo.
export function snapshotEvents(snapshot: ConversationSnapshot): readonly MageEvent[] {
  const events: MageEvent[] = snapshot.pending.map((p) =>
    p.kind === 'permission' ? { kind: 'permission_request', request: p.request } : { kind: 'elicitation_request', request: p.request },
  );
  if (snapshot.queue.length > 0) events.push({ kind: 'queue_changed', queue: snapshot.queue });
  return events;
}
