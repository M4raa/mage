import type { CreateSessionParams, SendMessageParams, SessionEventPayload } from '@shared/ipc';
import type { MageEvent, PermissionDecision, PermissionRequest } from '@shared/events';
import type { ElicitationAnswer } from '@shared/elicitation';
import type { AnswerReceipt, CloseReceipt, ConversationId, ConversationSnapshot, CoordinatedState, NativeSessionRef, PendingRequest, QueuedMessage, SendReceipt } from '@shared/coordination';
import { enqueueMessage, removeQueuedMessage, takeNextMessage } from '@shared/messageQueue';
import { writesClaudeTranscript } from '@shared/providers';
import { automaticAnswer, automaticDecision, CREATE_PR_PROMPT, type AutomaticAnswer } from '@shared/permissionPolicy';
import type { SessionManager } from '../engine/sessionManager';
import type { SessionLogFn } from '../engine/agentSession';

// Coordinacion de sesiones, primer paso (F2.1, §3.5 del plan): un unico propietario en main que da a cada
// evento su conversacion de Mage y una secuencia monotona, y mantiene una instantanea consultable de cada
// sesion viva. Va SOBRE `SessionManager` (no hay otra lista de procesos): crear y parar pasan por aqui para
// que el seguimiento no se desincronice. Desde F2.2 es tambien el UNICO dueño de la cola de mensajes: decide
// en un solo paso si un envio va al motor o espera, y saca el siguiente al acabar el turno. Y desde F2.3 lleva
// las peticiones que esperan al usuario (permisos, preguntas y elicitations): cada una se contesta UNA vez,
// gane quien gane, y la respuesta aceptada se anuncia a todos los clientes. Desde F2.4 decide tambien las
// respuestas automaticas (barrera del turno de PR > fuera del proyecto > «Permitir siempre» > preguntar) ANTES de
// anunciar el permiso: lo que contesta main no llega a ningun cliente como peticion.

// Evento de sesion con su identidad y su secuencia. Los campos nuevos son opcionales en el contrato del
// IPC (`SessionEventPayload`) para que un cliente que no los usa siga igual.
export interface SequencedSessionEvent extends SessionEventPayload {
  readonly conversationId: ConversationId | null;
  readonly seq: number;
  readonly at: number;
}

export type SequencedSink = (payload: SequencedSessionEvent) => void;

// Un cliente suscrito a una sesion (F2.6): su sumidero y el aviso de que la sesion termino. El renderer que la
// creo es uno mas; el host local (terminal, MCP, widget) suma los suyos con `subscribe`.
export interface SessionListener {
  readonly sink: SequencedSink;
  readonly onClosed: () => void;
}

export interface SessionSubscription {
  // La instantanea y los eventos posteriores van juntos: todo lo que llegue despues tiene `seq` mayor que `snapshot.lastSeq`.
  readonly snapshot: ConversationSnapshot;
  readonly unsubscribe: () => void;
}

// Lo que necesita del indice de conversaciones (`ConversationIndexStore`).
export interface ConversationIdentityIndex {
  resolveConversation(ref: NativeSessionRef): { readonly conversationId: ConversationId; readonly lastSeq: number };
  recordLastSeq(conversationId: ConversationId, seq: number): void;
}

export type CoordinatedSessions = Pick<SessionManager,
  'create' | 'stop' | 'stopOwnedBy' | 'stopByConfigDir' | 'stopAll' | 'sendMessage' | 'interrupt' | 'answerPermission' | 'answerElicitation'>;

export interface SessionCoordinatorDeps {
  readonly sessions: CoordinatedSessions;
  readonly index: ConversationIdentityIndex;
  readonly now: () => number;
  readonly log: SessionLogFn;
  // Id de un envio que no trae el suyo (`randomUUID` en produccion).
  readonly newId: () => string;
  // Reglas «Permitir siempre» de una conversacion (su ConversationId, o el id de la sesion si aun no lo tiene).
  readonly alwaysAllowTools: (key: string) => readonly string[];
  // Aplaza la respuesta automatica (`queueMicrotask` en produccion): el motor termina de emitir la peticion
  // (el runtime emite despues `requires_action`) antes de recibir la respuesta.
  readonly defer: (fn: () => void) => void;
  // Temporizador cancelable (`setTimeout` en produccion): la caducidad del segundo plano.
  readonly setTimer: (fn: () => void, ms: number) => () => void;
}

// Una sesion en segundo plano que nadie reclama se para a la semana (decision del usuario, 2026-09-15): su CLI
// ya no le sirve a nadie. Cabe en un setTimeout (el tope son ~24,8 dias).
export const BACKGROUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Recibos recordados por sesion para deduplicar reintentos: los ultimos, no todos.
const MAX_RECEIPTS = 100;

// Seguimiento mutable de una sesion; hacia fuera solo salen copias (`snapshot`).
interface Tracked {
  sessionId: string;
  readonly provider: string;
  readonly accountDir: string;
  conversationId: ConversationId | null;
  nativeRef: NativeSessionRef | null;
  lastSeq: number;
  state: CoordinatedState;
  queue: readonly QueuedMessage[];
  readonly receipts: Map<string, SendReceipt>;
  // Peticiones que esperan al usuario, por requestId (en orden de llegada).
  readonly pending: Map<string, PendingRequest>;
  // El turno en marcha lleva el prompt de «Crear PR»: sus barreras estan armadas hasta el `result`.
  prGuard: boolean;
  // En segundo plano: cancela su caducidad. null si tiene cliente.
  cancelExpiry: (() => void) | null;
  // Webcontents que la creo (null si no se dijo): solo el y la ventana principal le dan ordenes (F2.6).
  readonly ownerId: number | null;
  // Clientes suscritos: el que la creo y los que se sumen despues.
  readonly listeners: Set<SessionListener>;
  // Emite un evento propio de la coordinacion por el mismo camino que los del motor (con secuencia).
  emit: (event: MageEvent) => void;
}

export class SessionCoordinator {
  private readonly tracked = new Map<string, Tracked>();

  constructor(private readonly deps: SessionCoordinatorDeps) {}

  // Crea la sesion (ver `SessionManager.create`) y la sigue. `params.accountDir` es el config dir EFECTIVO.
  // El registro existe antes del arranque: un evento emitido durante `start()` ya lleva su secuencia.
  create(params: CreateSessionParams, sink: SequencedSink, ownerId?: number): string {
    const tracked: Tracked = {
      sessionId: '', provider: params.provider, accountDir: params.accountDir, conversationId: null, nativeRef: null, lastSeq: 0, state: 'starting',
      queue: [], receipts: new Map(), pending: new Map(), prGuard: false, cancelExpiry: null, ownerId: ownerId ?? null,
      listeners: new Set([{ sink, onClosed: () => undefined }]), emit: () => undefined,
    };
    tracked.emit = (event) => this.relay(tracked, { sessionId: tracked.sessionId, event });
    const sessionId = this.deps.sessions.create(params, (payload) => this.relay(tracked, payload), ownerId);
    tracked.sessionId = sessionId;
    this.tracked.set(sessionId, tracked);
    const nativeId = initialNativeId(params, sessionId);
    if (nativeId !== null) this.bind(tracked, nativeId);
    return sessionId;
  }

  // Quien puede dar ordenes: el id del webContents que creo la sesion, null si no tiene, undefined si no se sigue.
  ownerOf(sessionId: string): number | null | undefined {
    return this.tracked.get(sessionId)?.ownerId;
  }

  // Instantaneas de todas las sesiones vivas (para un cliente que llega y no conoce ningun id).
  listSessions(): readonly ConversationSnapshot[] {
    return [...this.tracked.keys()].map((sessionId) => this.snapshot(sessionId));
  }

  // Suma un cliente a la sesion (F2.6). Todo es sincrono: la instantanea y el primer evento posterior no dejan
  // hueco ni repeticion. `onClosed` avisa cuando la sesion para; soltar la suscripcion es idempotente.
  subscribe(sessionId: string, listener: SessionListener): SessionSubscription {
    const tracked = this.require(sessionId);
    tracked.listeners.add(listener);
    return { snapshot: this.snapshot(sessionId), unsubscribe: () => { tracked.listeners.delete(listener); } };
  }

  snapshot(sessionId: string): ConversationSnapshot {
    const tracked = this.require(sessionId);
    const { sessionId: id, provider, conversationId, nativeRef, lastSeq, state, queue } = tracked;
    return { sessionId: id, provider, conversationId, nativeRef, lastSeq, state, queue, pending: [...tracked.pending.values()], background: tracked.cancelExpiry !== null };
  }

  // Cierra la conversacion de un cliente. Con trabajo en vuelo NO se corta: queda en segundo plano (la cola se
  // descarta en el MISMO paso, asi que el `result` ya no saca nada) y caduca a la semana. Sin trabajo, se para.
  close(sessionId: string): CloseReceipt {
    const tracked = this.require(sessionId);
    if (!isBusy(tracked.state)) {
      this.stop(sessionId);
      return { background: false };
    }
    if (tracked.queue.length > 0) this.setQueue(tracked, []);
    tracked.cancelExpiry?.();
    tracked.cancelExpiry = this.deps.setTimer(() => this.expire(tracked), BACKGROUND_TTL_MS);
    return { background: true };
  }

  // Contesta un permiso (o pregunta) UNA vez. La respuesta aceptada sale de pendientes ANTES de llegar al
  // motor, asi que una segunda —de otro cliente o un doble clic— se rechaza sin tocarlo. Si el motor lanza,
  // la peticion no vuelve a pendientes: el CLI ya no la espera, y el error llega a quien contesto.
  answerPermission(sessionId: string, requestId: string, decision: PermissionDecision): AnswerReceipt {
    const tracked = this.require(sessionId);
    if (tracked.pending.get(requestId)?.kind !== 'permission') return ALREADY_ANSWERED;
    tracked.pending.delete(requestId);
    this.answerEngine(tracked, requestId, decision);
    const answers = answersOf(decision);
    tracked.emit({ kind: 'permission_resolved', requestId, behavior: decision.behavior, ...(answers === null ? {} : { answers }) });
    return ACCEPTED;
  }

  // Igual para una elicitation; su resolucion la anuncia la propia sesion (`elicitation_resolved`).
  answerElicitation(answer: ElicitationAnswer): AnswerReceipt {
    const tracked = this.require(answer.sessionId);
    if (tracked.pending.get(answer.requestId)?.kind !== 'elicitation') return ALREADY_ANSWERED;
    tracked.pending.delete(answer.requestId);
    this.deps.sessions.answerElicitation(answer);
    return ACCEPTED;
  }

  // Envia, o deja en la cola si hay un turno en marcha: la decision y el cambio de estado van juntos, asi que
  // dos envios seguidos nunca salen los dos al motor. El mismo `commandId` devuelve el mismo recibo.
  send(params: SendMessageParams): SendReceipt {
    const tracked = this.require(params.sessionId);
    const commandId = params.commandId ?? this.deps.newId();
    const previous = tracked.receipts.get(commandId);
    if (previous !== undefined) return previous;
    const receipt = isBusy(tracked.state) ? this.enqueue(tracked, commandId, params) : this.deliver(tracked, commandId, params);
    remember(tracked.receipts, commandId, receipt);
    return receipt;
  }

  // Un Stop no envia la cola: la vacia ANTES de interrumpir (el `result` del turno parado ya no saca nada) y
  // devuelve sus mensajes para que vuelvan al input.
  interrupt(sessionId: string): readonly QueuedMessage[] {
    const taken = this.takeQueue(sessionId);
    this.deps.sessions.interrupt(sessionId);
    return taken;
  }

  removeQueued(sessionId: string, messageId: string): QueuedMessage | null {
    const tracked = this.require(sessionId);
    const message = tracked.queue.find((m) => m.id === messageId) ?? null;
    if (message === null) return null;
    this.setQueue(tracked, removeQueuedMessage(tracked.queue, messageId));
    return message;
  }

  takeQueue(sessionId: string): readonly QueuedMessage[] {
    const tracked = this.require(sessionId);
    const taken = tracked.queue;
    if (taken.length > 0) this.setQueue(tracked, []);
    return taken;
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
  private relay(tracked: Tracked, payload: SessionEventPayload): void {
    this.follow(tracked, payload.sessionId);
    const { event } = payload;
    if (event.kind === 'permission_request' && this.answerAutomatically(tracked, event.request)) return;
    if (event.kind === 'session_init' && event.sessionId !== tracked.nativeRef?.nativeId) this.bind(tracked, event.sessionId);
    trackPending(tracked.pending, event);
    tracked.state = nextState(tracked.state, event, tracked.pending.size);
    tracked.lastSeq += 1;
    this.fanOut(tracked, { ...payload, conversationId: tracked.conversationId, seq: tracked.lastSeq, at: this.deps.now() });
    if (event.kind === 'conversation_reset') this.rebind(tracked, event.newSessionId);
    if (event.kind === 'result') {
      tracked.prGuard = false;
      this.drain(tracked);
    }
  }

  // A todos los clientes, sobre una COPIA de la lista (un cliente puede soltarse mientras recibe). Un sumidero que
  // lanza no corta a los demas ni al motor: queda en el log.
  private fanOut(tracked: Tracked, payload: SequencedSessionEvent): void {
    for (const listener of [...tracked.listeners]) {
      try {
        listener.sink(payload);
      } catch (err) {
        this.deps.log('warn', 'Un cliente de la sesion fallo al recibir un evento', { sessionId: tracked.sessionId, seq: payload.seq, error: describe(err) });
      }
    }
  }

  // H4: si el motor rechaza la respuesta, los clientes cierran la tarjeta (`permission_cancelled`) y el error
  // llega a quien contesto.
  private answerEngine(tracked: Tracked, requestId: string, decision: PermissionDecision): void {
    try {
      this.deps.sessions.answerPermission(tracked.sessionId, requestId, decision);
    } catch (err) {
      tracked.emit({ kind: 'permission_cancelled', requestId });
      throw err;
    }
  }

  // Contesta sola la peticion si la politica lo decide; true si lo hace (entonces no se anuncia). La respuesta
  // se aplaza (ver `defer`); si la sesion ya no se sigue, no llega al motor. Un fallo queda en el log.
  private answerAutomatically(tracked: Tracked, request: PermissionRequest): boolean {
    const answer = this.automaticAnswerFor(tracked, request);
    if (answer === null) return false;
    this.deps.defer(() => {
      if (this.tracked.get(tracked.sessionId) !== tracked) return;
      try {
        this.deps.sessions.answerPermission(tracked.sessionId, request.requestId, automaticDecision(answer));
      } catch (err) {
        this.deps.log('warn', 'No se pudo enviar la respuesta automática al permiso', { sessionId: tracked.sessionId, requestId: request.requestId, error: describe(err) });
        return;
      }
      tracked.emit({ kind: 'permission_auto_answered', requestId: request.requestId, toolName: request.toolName, behavior: answer.behavior, blocked: answer.behavior === 'deny' ? answer.blocked : null });
    });
    return true;
  }

  // Unas reglas que no se pueden leer no autorizan nada: se pregunta al usuario y queda trazado.
  private automaticAnswerFor(tracked: Tracked, request: PermissionRequest): AutomaticAnswer | null {
    let alwaysAllowTools: readonly string[] = [];
    try {
      alwaysAllowTools = this.deps.alwaysAllowTools(tracked.conversationId ?? tracked.sessionId);
    } catch (err) {
      this.deps.log('warn', 'No se pudieron leer las reglas «Permitir siempre» de la conversacion', { sessionId: tracked.sessionId, error: describe(err) });
    }
    return automaticAnswer({ prGuard: tracked.prGuard, alwaysAllowTools, request });
  }

  private enqueue(tracked: Tracked, commandId: string, params: SendMessageParams): SendReceipt {
    this.setQueue(tracked, enqueueMessage(tracked.queue, { id: commandId, text: params.text, attachments: params.attachments ?? [] }));
    return { status: 'queued', commandId };
  }

  // Al motor. Si lanza, el estado no cambia y el error llega a quien envio.
  private deliver(tracked: Tracked, commandId: string, params: SendMessageParams): SendReceipt {
    this.deps.sessions.sendMessage(tracked.sessionId, params.text, params.attachments ?? []);
    tracked.state = 'running';
    armPrGuard(tracked, params.text);
    return { status: 'accepted', commandId };
  }

  // Al acabar un turno sale el PRIMERO de la cola como turno propio; el siguiente espera a que acabe ese.
  private drain(tracked: Tracked): void {
    if (isBusy(tracked.state)) return;
    const { next, rest } = takeNextMessage(tracked.queue);
    if (next === null) return;
    tracked.queue = rest;
    try {
      this.deps.sessions.sendMessage(tracked.sessionId, next.text, next.attachments);
      tracked.state = 'running';
      armPrGuard(tracked, next.text);
      tracked.emit({ kind: 'queued_message_sent', message: next });
    } catch (err) {
      tracked.emit({ kind: 'queued_message_failed', message: next, error: describe(err) });
    }
    tracked.emit({ kind: 'queue_changed', queue: rest });
  }

  private setQueue(tracked: Tracked, queue: readonly QueuedMessage[]): void {
    tracked.queue = queue;
    tracked.emit({ kind: 'queue_changed', queue });
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

  private expire(tracked: Tracked): void {
    if (this.tracked.get(tracked.sessionId) !== tracked) return;
    tracked.emit({ kind: 'background_expired' });
    this.stop(tracked.sessionId);
  }

  private release(sessionId: string): void {
    const tracked = this.tracked.get(sessionId);
    if (tracked === undefined) return;
    tracked.cancelExpiry?.();
    tracked.cancelExpiry = null;
    this.tracked.delete(sessionId);
    this.persist(tracked);
    this.notifyClosed(tracked);
  }

  private notifyClosed(tracked: Tracked): void {
    const listeners = [...tracked.listeners];
    tracked.listeners.clear();
    for (const listener of listeners) {
      try {
        listener.onClosed();
      } catch (err) {
        this.deps.log('warn', 'Un cliente de la sesion fallo al enterarse de su cierre', { sessionId: tracked.sessionId, error: describe(err) });
      }
    }
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
// turno: lista al arrancar, en marcha con la primera salida del modelo y en reposo con su `result`. Mismas
// transiciones que el estado del chat en el renderer, que es lo que decidia la cola antes de F2.2: un
// reinicio o un error dejan de contar como turno en marcha.
const RUNNING_EVENTS: ReadonlySet<MageEvent['kind']> = new Set(['request_started', 'stream_delta', 'thinking_delta', 'tool_use']);
const WAITING_EVENTS: ReadonlySet<MageEvent['kind']> = new Set(['permission_request', 'elicitation_request']);
const RESOLVING_EVENTS: ReadonlySet<MageEvent['kind']> = new Set(['permission_resolved', 'permission_cancelled', 'elicitation_resolved', 'elicitation_cancelled']);

const ACCEPTED: AnswerReceipt = { status: 'accepted' };

// Respuestas de una pregunta: viajan en `updatedInput.answers` (texto por pregunta). null si no lo es.
function answersOf(decision: PermissionDecision): Readonly<Record<string, string>> | null {
  if (decision.behavior !== 'allow') return null;
  const answers = decision.updatedInput?.answers;
  if (typeof answers !== 'object' || answers === null || Array.isArray(answers)) return null;
  const entries = Object.entries(answers);
  return entries.every(([, value]) => typeof value === 'string') ? (Object.fromEntries(entries) as Record<string, string>) : null;
}
const ALREADY_ANSWERED: AnswerReceipt = { status: 'rejected', reason: 'already_answered' };

// Lo que espera al usuario: entra con su peticion y sale cuando se contesta, se cancela o el turno acaba (una
// peticion de un turno ya terminado no la espera nadie). Un reenvio del mismo requestId no se duplica.
function trackPending(pending: Map<string, PendingRequest>, event: MageEvent): void {
  if (event.kind === 'permission_request' && !pending.has(event.request.requestId)) pending.set(event.request.requestId, { kind: 'permission', request: event.request });
  if (event.kind === 'elicitation_request' && !pending.has(event.request.requestId)) pending.set(event.request.requestId, { kind: 'elicitation', request: event.request });
  if (event.kind === 'permission_cancelled' || event.kind === 'elicitation_cancelled' || event.kind === 'elicitation_resolved') pending.delete(event.requestId);
  if (event.kind === 'result' || event.kind === 'session_restarting') pending.clear();
}

function nextState(current: CoordinatedState, event: MageEvent, pendingCount: number): CoordinatedState {
  if (event.kind === 'session_state') return event.state;
  // Contestada la ultima peticion, el turno sigue (lo que hacia el chat del renderer al contestar).
  if (RESOLVING_EVENTS.has(event.kind)) return current === 'requires_action' && pendingCount === 0 ? 'running' : current;
  if (event.kind === 'session_restarting') return 'restarting';
  if (event.kind === 'result') return 'idle';
  if (event.kind === 'error') return 'error';
  if (event.kind === 'session_init' && current === 'starting') return 'idle';
  if (WAITING_EVENTS.has(event.kind)) return 'requires_action';
  if (RUNNING_EVENTS.has(event.kind) && current !== 'requires_action') return 'running';
  return current;
}

// El turno que lleva el prompt de «Crear PR» arma sus barreras hasta su `result` (como Claude Desktop).
function armPrGuard(tracked: Tracked, text: string): void {
  if (text.includes(CREATE_PR_PROMPT)) tracked.prGuard = true;
}

function isBusy(state: CoordinatedState): boolean {
  return state === 'running' || state === 'requires_action';
}

function remember(receipts: Map<string, SendReceipt>, commandId: string, receipt: SendReceipt): void {
  receipts.set(commandId, receipt);
  if (receipts.size <= MAX_RECEIPTS) return;
  const oldest = receipts.keys().next().value;
  if (oldest !== undefined) receipts.delete(oldest);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
