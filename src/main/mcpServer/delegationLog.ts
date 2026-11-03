import { parseAskUserQuestion } from '@shared/askUserQuestion';
import type { ConversationSnapshot } from '@shared/coordination';
import type { MageEvent } from '@shared/events';
import type { SequencedSessionEvent, SessionCoordinator } from '../coordination/sessionCoordinator';
import type { CreatedBy, PublicMessage, SessionState } from './types';

// Registro de delegaciones de main (D-M11): sigue a cada sesión que una conversación crea por el MCP y guarda,
// por delegada, su estado público, sus mensajes y su contador de turnos. Es UNO para todas las conexiones: el
// puerto de cada conexión lo consulta y filtra por descendencia. La delegada se sigue con una suscripción más
// del coordinador; `closeFromWindow` descuenta esa suscripción (`watchCount`) para que cerrar la ventana de la
// delegada no la deje viva por culpa del propio registro.

export const MAX_MESSAGES_PER_SESSION = 500;
export const MAX_DELEGATIONS = 200;
export const MAX_ANNOUNCED_TEXT_CHARS = 4000;

export interface DelegatedSession {
  readonly sessionId: string;
  readonly conversationId: string;
  readonly creatorSessionId: string;
  readonly creatorConversationId: string;
  readonly title: string;
  readonly provider: string;
  readonly accountId: string;
  readonly projectId: string;
  readonly createdBy: CreatedBy;
  readonly creatorChain: readonly string[];
}
// Los estados públicos de `mage_get_status` son los de `SessionState` del núcleo MCP.
export type McpState = SessionState;

export interface DelegationView {
  readonly child: DelegatedSession;
  readonly state: McpState;
  readonly turnCount: number;
  readonly lastEventAt: string;
  readonly closed: boolean;
}
export interface DelegationLogDeps {
  readonly coordinator: Pick<SessionCoordinator, 'subscribe' | 'snapshot' | 'announce' | 'ownerOf'>;
  readonly now: () => number;
}
interface Entry {
  readonly child: DelegatedSession;
  readonly messages: PublicMessage[];
  nextSeq: number;
  turnCount: number;
  lastEventAt: string;
  state: McpState;
  closed: boolean;
  lastAssistant: string | null;
  // U26: la delegada preguntó a su creadora con `mage_ask_creator`; `turnEnded` marca que el turno que preguntó ya acabó.
  awaiting: { turnEnded: boolean } | null;
  readonly unsubscribe: () => void;
}

// Un evento de estos DESPUÉS del result del turno que preguntó es un turno nuevo: la pregunta queda contestada (U26).
const TURN_START_KINDS: ReadonlySet<MageEvent['kind']> = new Set(['request_started', 'stream_delta', 'thinking_delta', 'tool_use', 'assistant_text', 'queued_message_sent']);

export function mcpStateOf(input: {
  readonly snapshot: ConversationSnapshot | null; readonly closed: boolean; readonly turnCount: number; readonly awaitingCreator?: boolean;
}): McpState {
  const { snapshot, closed, turnCount, awaitingCreator } = input;
  if (closed || snapshot === null) return 'interrupted';
  if (snapshot.pending.some(isQuestionRequest)) return 'waiting_answer';
  if (snapshot.pending.length > 0) return 'permission_pending';
  if (awaitingCreator === true) return 'waiting_answer';
  switch (snapshot.state) {
    case 'running': case 'starting': case 'restarting': return 'working';
    case 'requires_action': return 'permission_pending';
    case 'error': return 'interrupted';
    case 'idle': return turnCount > 0 ? 'done' : 'working';
  }
}
function isQuestionRequest(pending: ConversationSnapshot['pending'][number]): boolean {
  if (pending.kind === 'elicitation') return true;
  return parseAskUserQuestion(pending.request.input) !== null;
}

export class DelegationLog {
  private readonly entries = new Map<string, Entry>();
  private readonly byConversation = new Map<string, Entry>();

  constructor(private readonly deps: DelegationLogDeps) {}

  watch(child: DelegatedSession): void {
    if (this.entries.has(child.sessionId)) throw new Error(`La sesión ya está en el registro de delegaciones: ${child.sessionId}`);
    const { coordinator, now } = this.deps;
    const holder: { entry: Entry | null } = { entry: null };
    const subscription = coordinator.subscribe(child.sessionId, {
      sink: (event) => { if (holder.entry !== null) this.onEvent(holder.entry, event); },
      onClosed: () => { if (holder.entry !== null) this.onClosed(holder.entry); },
    });
    const entry: Entry = {
      child, messages: [], nextSeq: 1, turnCount: 0, lastEventAt: new Date(now()).toISOString(),
      state: mcpStateOf({ snapshot: subscription.snapshot, closed: false, turnCount: 0 }), closed: false, lastAssistant: null, awaiting: null, unsubscribe: subscription.unsubscribe,
    };
    holder.entry = entry;
    this.entries.set(child.sessionId, entry);
    this.byConversation.set(child.conversationId, entry);
    this.evictOldest();
  }

  recordInstruction(sessionId: string, text: string): void {
    this.push(this.require(sessionId), 'user', text);
  }

  // U26: la delegada pregunta a su creadora. Sin creadora viva no se registra nada.
  recordQuestion(sessionId: string, text: string): 'recorded' | 'creator_closed' {
    const entry = this.require(sessionId);
    if (this.deps.coordinator.ownerOf(entry.child.creatorSessionId) === undefined) return 'creator_closed';
    this.push(entry, 'question', text);
    this.announceToCreator(entry, { kind: 'delegation_message', fromId: entry.child.conversationId, toId: entry.child.creatorConversationId, messageKind: 'question', text: text.slice(0, MAX_ANNOUNCED_TEXT_CHARS) });
    this.setAwaiting(entry, { turnEnded: false });
    return 'recorded';
  }

  // U26: la creadora contesta (mage_send). true si había una pregunta esperando: entonces es su respuesta, y ya no espera.
  settleQuestion(sessionId: string): boolean {
    const entry = this.require(sessionId);
    if (entry.awaiting === null) return false;
    this.setAwaiting(entry, null);
    return true;
  }

  get(conversationId: string): DelegationView | null {
    const entry = this.byConversation.get(conversationId);
    return entry === undefined ? null : viewOf(entry);
  }

  list(): readonly DelegationView[] {
    return [...this.entries.values()].map(viewOf);
  }

  messagesAfter(conversationId: string, afterSeq: number): readonly PublicMessage[] {
    const entry = this.byConversation.get(conversationId);
    if (entry === undefined) return [];
    return entry.messages.filter((message) => message.seq > afterSeq).map((message) => ({ ...message }));
  }

  // 1 si el registro sigue a la sesión y no está cerrada; `closeFromWindow` lo resta de los suscriptores.
  watchCount(sessionId: string): number {
    const entry = this.entries.get(sessionId);
    return entry === undefined || entry.closed ? 0 : 1;
  }

  private onEvent(entry: Entry, payload: SequencedSessionEvent): void {
    entry.lastEventAt = new Date(payload.at).toISOString();
    const { event } = payload;
    if (entry.awaiting?.turnEnded === true && TURN_START_KINDS.has(event.kind)) this.setAwaiting(entry, null);
    if (event.kind === 'assistant_text') {
      this.push(entry, 'assistant', event.text);
      entry.lastAssistant = event.text;
    }
    if (event.kind === 'permission_request') this.onPermission(entry, event.request.input);
    if (event.kind === 'result') {
      this.onResult(entry);
      if (entry.awaiting !== null) entry.awaiting.turnEnded = true;
    }
    this.refreshState(entry, false);
  }

  private onPermission(entry: Entry, input: Readonly<Record<string, unknown>>): void {
    const questions = parseAskUserQuestion(input);
    if (questions === null) return;
    const text = questions.map((question) => question.question).join('\n');
    this.push(entry, 'question', text);
    this.announceToCreator(entry, { kind: 'delegation_message', fromId: entry.child.conversationId, toId: entry.child.creatorConversationId, messageKind: 'question', text });
  }

  private onResult(entry: Entry): void {
    entry.turnCount += 1;
    if (entry.lastAssistant === null) return;
    const text = entry.lastAssistant.slice(0, MAX_ANNOUNCED_TEXT_CHARS);
    entry.lastAssistant = null;
    this.announceToCreator(entry, { kind: 'delegation_message', fromId: entry.child.conversationId, toId: entry.child.creatorConversationId, messageKind: 'result', text });
  }

  private onClosed(entry: Entry): void {
    entry.closed = true;
    entry.unsubscribe();
    entry.awaiting = null;
    this.refreshState(entry, true);
  }

  // Avisa a la pestaña de la delegada solo cuando cambia «espera / no espera»; con la sesión cerrada no hay a quién.
  private setAwaiting(entry: Entry, awaiting: Entry['awaiting']): void {
    const changed = (entry.awaiting === null) !== (awaiting === null);
    entry.awaiting = awaiting;
    if (changed && !entry.closed) {
      this.deps.coordinator.announce(entry.child.sessionId, { kind: 'delegation_waiting', creatorId: entry.child.creatorConversationId, waiting: awaiting !== null });
    }
    this.refreshState(entry, entry.closed);
  }

  private refreshState(entry: Entry, closed: boolean): void {
    const snapshot = closed ? null : this.deps.coordinator.snapshot(entry.child.sessionId);
    const state = mcpStateOf({ snapshot, closed, turnCount: entry.turnCount, awaitingCreator: entry.awaiting !== null });
    if (state === entry.state) return;
    entry.state = state;
    this.announceToCreator(entry, { kind: 'delegation_state', childId: entry.child.conversationId, state });
  }

  // Si la creadora ya no existe no se anuncia nada: no es un error.
  private announceToCreator(entry: Entry, event: Parameters<DelegationLogDeps['coordinator']['announce']>[1]): void {
    const { coordinator } = this.deps;
    if (coordinator.ownerOf(entry.child.creatorSessionId) === undefined) return;
    coordinator.announce(entry.child.creatorSessionId, event);
  }

  private push(entry: Entry, role: string, text: string): void {
    entry.messages.push({ seq: entry.nextSeq, role, text });
    entry.nextSeq += 1;
    if (entry.messages.length > MAX_MESSAGES_PER_SESSION) entry.messages.shift();
  }

  // ponytail: tope de MAX_DELEGATIONS; si todas siguen abiertas no se borra ninguna y el registro crece hasta que cierren.
  private evictOldest(): void {
    if (this.entries.size <= MAX_DELEGATIONS) return;
    for (const [sessionId, entry] of this.entries) {
      if (!entry.closed) continue;
      this.entries.delete(sessionId);
      this.byConversation.delete(entry.child.conversationId);
      return;
    }
  }

  private require(sessionId: string): Entry {
    const entry = this.entries.get(sessionId);
    if (entry === undefined) throw new Error(`La sesión no está en el registro de delegaciones: ${sessionId}`);
    return entry;
  }
}

function viewOf(entry: Entry): DelegationView {
  return { child: entry.child, state: entry.state, turnCount: entry.turnCount, lastEventAt: entry.lastEventAt, closed: entry.closed };
}
