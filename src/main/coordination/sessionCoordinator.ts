import type { CreateSessionParams, SessionEventPayload } from '@shared/ipc';
import type { MageEvent } from '@shared/events';
import type { ConversationId, ConversationSnapshot, CoordinatedState, NativeSessionRef } from '@shared/coordination';
import { writesClaudeTranscript } from '@shared/providers';
import type { SessionManager } from '../engine/sessionManager';
import type { SessionLogFn } from '../engine/agentSession';

// Coordinacion de sesiones, primer paso (F2.1, §3.5 del plan): un unico propietario en main que da a cada
// evento su conversacion de Mage y una secuencia monotona, y mantiene una instantanea consultable de cada
// sesion viva. Va SOBRE `SessionManager` (no hay otra lista de procesos): crear y parar pasan por aqui para
// que el seguimiento no se desincronice. Cola y permisos siguen en el renderer hasta F2.2/F2.3.

// Evento de sesion con su identidad y su secuencia. Los campos nuevos son opcionales en el contrato del
// IPC (`SessionEventPayload`) para que un cliente que no los usa siga igual.
export interface SequencedSessionEvent extends SessionEventPayload {
  readonly conversationId: ConversationId | null;
  readonly seq: number;
  readonly at: number;
}

export type SequencedSink = (payload: SequencedSessionEvent) => void;

// Lo que necesita del indice de conversaciones (`ConversationIndexStore`).
export interface ConversationIdentityIndex {
  resolveConversation(ref: NativeSessionRef): { readonly conversationId: ConversationId; readonly lastSeq: number };
  recordLastSeq(conversationId: ConversationId, seq: number): void;
}

export type CoordinatedSessions = Pick<SessionManager, 'create' | 'stop' | 'stopOwnedBy' | 'stopByConfigDir' | 'stopAll'>;

export interface SessionCoordinatorDeps {
  readonly sessions: CoordinatedSessions;
  readonly index: ConversationIdentityIndex;
  readonly now: () => number;
  readonly log: SessionLogFn;
}

// Seguimiento mutable de una sesion; hacia fuera solo salen copias (`snapshot`).
interface Tracked {
  sessionId: string;
  readonly provider: string;
  readonly accountDir: string;
  conversationId: ConversationId | null;
  nativeRef: NativeSessionRef | null;
  lastSeq: number;
  state: CoordinatedState;
}

export class SessionCoordinator {
  private readonly tracked = new Map<string, Tracked>();

  constructor(private readonly deps: SessionCoordinatorDeps) {}

  // Crea la sesion (ver `SessionManager.create`) y la sigue. `params.accountDir` es el config dir EFECTIVO.
  // El registro existe antes del arranque: un evento emitido durante `start()` ya lleva su secuencia.
  create(params: CreateSessionParams, sink: SequencedSink, ownerId?: number): string {
    const tracked: Tracked = { sessionId: '', provider: params.provider, accountDir: params.accountDir, conversationId: null, nativeRef: null, lastSeq: 0, state: 'starting' };
    const sessionId = this.deps.sessions.create(params, (payload) => this.relay(tracked, payload, sink), ownerId);
    tracked.sessionId = sessionId;
    this.tracked.set(sessionId, tracked);
    const nativeId = initialNativeId(params, sessionId);
    if (nativeId !== null) this.bind(tracked, nativeId);
    return sessionId;
  }

  snapshot(sessionId: string): ConversationSnapshot {
    const tracked = this.require(sessionId);
    return { sessionId: tracked.sessionId, provider: tracked.provider, conversationId: tracked.conversationId, nativeRef: tracked.nativeRef, lastSeq: tracked.lastSeq, state: tracked.state };
  }

  // ConversationId de una sesion viva, o null si no se sigue o aun no se conoce su id nativo.
  conversationIdOf(sessionId: string): ConversationId | null {
    return this.tracked.get(sessionId)?.conversationId ?? null;
  }

  stop(sessionId: string): void {
    this.deps.sessions.stop(sessionId);
    this.release(sessionId);
  }

  stopOwnedBy(ownerId: number): readonly string[] {
    const stopped = this.deps.sessions.stopOwnedBy(ownerId);
    for (const sessionId of stopped) this.release(sessionId);
    return stopped;
  }

  stopByConfigDir(configDir: string): readonly string[] {
    const stopped = this.deps.sessions.stopByConfigDir(configDir);
    for (const sessionId of stopped) this.release(sessionId);
    return stopped;
  }

  stopAll(): void {
    this.deps.sessions.stopAll();
    for (const sessionId of [...this.tracked.keys()]) this.release(sessionId);
  }

  // Cada evento: identidad (antes, si el evento la trae), estado, secuencia y salida. El reinicio de
  // conversacion (`/clear`) sale con la conversacion VIEJA y despues se liga a la nueva.
  private relay(tracked: Tracked, payload: SessionEventPayload, sink: SequencedSink): void {
    this.follow(tracked, payload.sessionId);
    const { event } = payload;
    if (event.kind === 'session_init' && event.sessionId !== tracked.nativeRef?.nativeId) this.bind(tracked, event.sessionId);
    tracked.state = nextState(tracked.state, event);
    tracked.lastSeq += 1;
    sink({ ...payload, conversationId: tracked.conversationId, seq: tracked.lastSeq, at: this.deps.now() });
    if (event.kind === 'conversation_reset') this.rebind(tracked, event.newSessionId);
  }

  // `SessionManager` re-etiqueta la sesion tras un `/clear` (o no, si el id nuevo no sirve): el seguimiento
  // usa la misma clave que el gestor, que es la que llega en el evento.
  private follow(tracked: Tracked, sessionId: string): void {
    if (tracked.sessionId === '' || tracked.sessionId === sessionId) return;
    this.tracked.delete(tracked.sessionId);
    tracked.sessionId = sessionId;
    this.tracked.set(sessionId, tracked);
  }

  private rebind(tracked: Tracked, nativeId: string): void {
    this.persist(tracked);
    tracked.conversationId = null;
    this.bind(tracked, nativeId);
  }

  // Liga la sesion a su conversacion por su id nativo. La secuencia continua la ultima guardada, asi que es
  // monotona tambien entre sesiones de la misma conversacion. Un fallo del indice no corta los eventos: la
  // sesion sigue sin ConversationId y queda trazado.
  private bind(tracked: Tracked, nativeId: string): void {
    const nativeRef: NativeSessionRef = { provider: tracked.provider, accountDir: tracked.accountDir, nativeId };
    tracked.nativeRef = nativeRef;
    try {
      const { conversationId, lastSeq } = this.deps.index.resolveConversation(nativeRef);
      tracked.conversationId = conversationId;
      tracked.lastSeq = Math.max(tracked.lastSeq, lastSeq);
    } catch (err) {
      this.deps.log('warn', 'No se pudo ligar la sesion a su conversacion', { sessionId: tracked.sessionId, nativeId, error: describe(err) });
    }
  }

  private release(sessionId: string): void {
    const tracked = this.tracked.get(sessionId);
    if (tracked === undefined) return;
    this.tracked.delete(sessionId);
    this.persist(tracked);
  }

  private persist(tracked: Tracked): void {
    if (tracked.conversationId === null) return;
    try {
      this.deps.index.recordLastSeq(tracked.conversationId, tracked.lastSeq);
    } catch (err) {
      this.deps.log('warn', 'No se pudo guardar la secuencia de la conversacion', { conversationId: tracked.conversationId, error: describe(err) });
    }
  }

  private require(sessionId: string): Tracked {
    const tracked = this.tracked.get(sessionId);
    if (tracked === undefined) throw new Error(`Sesion inexistente: ${sessionId}`);
    return tracked;
  }
}

// Id nativo conocido al crear: el de la conversacion que se reanuda, o el propio id de la sesion en los
// proveedores cuya transcripcion lleva el id de Mage (Claude y el runtime propio). Codex y agy nuevos lo
// dicen en su `session_init`.
function initialNativeId(params: CreateSessionParams, sessionId: string): string | null {
  const resume = typeof params.resumeSessionId === 'string' && params.resumeSessionId.length > 0 ? params.resumeSessionId : null;
  if (writesClaudeTranscript(params.provider)) return sessionId;
  return resume;
}

// Solo Claude y el runtime propio dicen su estado (`session_state`); Codex y agy no. Para ellos manda el
// turno: lista al arrancar, en marcha con la primera salida del modelo y en reposo con su `result`.
const RUNNING_EVENTS: ReadonlySet<MageEvent['kind']> = new Set(['request_started', 'stream_delta', 'thinking_delta', 'tool_use']);

function nextState(current: CoordinatedState, event: MageEvent): CoordinatedState {
  if (event.kind === 'session_state') return event.state;
  if (event.kind === 'session_restarting') return 'restarting';
  if (event.kind === 'result') return 'idle';
  if (event.kind === 'session_init' && current === 'starting') return 'idle';
  if (RUNNING_EVENTS.has(event.kind) && current !== 'requires_action') return 'running';
  return current;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
