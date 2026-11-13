// U17: funciones PURAS (sin E/S) con las que la ventana principal convierte una sesión viva creada por el
// host (terminal o MCP) en una pestaña: decide si ya está ligada, si reutiliza una pestaña restaurada de
// esa conversación o si crea otra, construye la `Tab` y traduce la instantánea de main a estado de pestaña.
import type { MageEvent } from '@shared/events';
import type { ConversationSnapshot, CoordinatedState } from '@shared/coordination';
import type { AdoptableSession } from '@shared/ipc';
import { writesClaudeTranscript } from '@shared/providers';
import type { BackgroundSession, BackgroundState } from './backgroundWork';
import { conversationIdOfTab } from './conversationId';
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

// El host no usa worktree de Mage.
export function adoptedTab(session: AdoptableSession, ids: AdoptedTabIds): Tab {
  return {
    id: ids.tabId,
    accountId: session.accountId,
    accountAlias: ids.accountAlias,
    cwd: session.cwd,
    model: session.model,
    provider: session.provider,
    title: ids.title,
    accountPinned: true,
    resolvedConfigDir: session.configDir,
    ...(session.createdBy === null ? {} : { createdBy: session.createdBy }),
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

// #29: la pestaña de la sesión que encargó esta (la de `createdBy.sessionId`), o null si no hay marca o ya se cerró.
export function creatorTabOf(
  state: Pick<WorkbenchState, 'tabs' | 'sessionIdByChat'>,
  tab: Tab,
): { readonly tabId: string; readonly title: string } | null {
  if (tab.createdBy === undefined) return null;
  const { sessionId } = tab.createdBy;
  const creator = state.tabs.find((t) => state.sessionIdByChat[t.id] === sessionId);
  return creator === undefined ? null : { tabId: creator.id, title: creator.title };
}

// Pestaña de una conversación creada fuera de la ventana cuya cuenta ya no está en Mage: queda de solo lectura (no se
// envía con otra cuenta, que cobraría a quien no es).
export function pinnedAccountMissing(tab: Pick<Tab, 'accountPinned' | 'accountId'>, accounts: readonly { readonly id: string }[]): boolean {
  return tab.accountPinned === true && !accounts.some((account) => account.id === tab.accountId);
}

// Decisión 13-11: una subsesión creada por otra conversación con `mage_create_session` no abre pestaña mientras su
// adopción fuera una pestaña NUEVA; las de la terminal, enlazadas o con pestaña restaurada, como siempre.
export function adoptsWithoutTab(state: Pick<WorkbenchState, 'tabs' | 'sessionIdByChat'>, session: AdoptableSession): boolean {
  return session.origin === 'mcp' && adoptionTarget(state, session).kind === 'new';
}

// Estado de segundo plano según la instantánea de main (D-3). `lastSeq === 0` = recién lanzada, con su primer
// mensaje en camino.
export function backgroundStateOf(snapshot: Pick<ConversationSnapshot, 'state' | 'lastSeq'>): BackgroundState {
  if (snapshot.state === 'requires_action') return 'needs_action';
  if (chatStatusOf(snapshot.state) === 'streaming') return 'working';
  return snapshot.state === 'idle' && snapshot.lastSeq === 0 ? 'working' : 'done';
}

// Entrada de segundo plano de una subsesión sin pestaña. Su conversación, con la misma regla que una pestaña
// (`conversationIdOfTab`).
export function delegatedBackgroundEntry(session: AdoptableSession, state: BackgroundState, nowMs: number): BackgroundSession {
  const tabLike = session.nativeId === null ? { provider: session.provider } : { provider: session.provider, resumeSessionId: session.nativeId };
  return {
    sessionId: session.sessionId,
    conversationId: conversationIdOfTab(tabLike, session.sessionId),
    title: session.title ?? '',
    accountId: session.accountId,
    state,
    sinceMs: nowMs,
    hostSession: session,
  };
}

// Sesión del host con la que se abre la pestaña de una subsesión que estaba sin ella: en Codex y agy, con el hilo
// que se supo sin pestaña (si no, la pestaña nunca lo apuntaría).
export function delegatedSessionToOpen(entry: BackgroundSession): AdoptableSession {
  if (entry.hostSession === undefined) throw new Error(`La entrada ${JSON.stringify(entry.sessionId)} no es una subsesión del MCP`);
  if (entry.conversationId === undefined || writesClaudeTranscript(entry.hostSession.provider)) return entry.hostSession;
  return { ...entry.hostSession, nativeId: entry.conversationId };
}
