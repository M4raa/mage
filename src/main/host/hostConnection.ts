import type { ZodTypeAny } from 'zod';
import type { PermissionDecision } from '@shared/events';
import type { ElicitationAnswer } from '@shared/elicitation';
import type { AnswerReceipt, ConversationSnapshot, QueuedMessage, SendReceipt } from '@shared/coordination';
import type { SendMessageParams } from '@shared/ipc';
import { UserFacingError, renderForLog } from '@shared/i18n/localizedText';
import type { Translate } from '@shared/i18n/translator';
import type { SessionLogFn } from '../engine/agentSession';
import type { SequencedSessionEvent } from '../coordination/sessionCoordinator';
import { MAX_LINE_BYTES, NdjsonFramer } from './ndjsonFramer';
import { TrustRequiredError, UnknownAccountError, UnknownConversationError, UnsupportedMethodError } from './hostErrors';
import type { HostControl } from './hostControl';
import type { HostMode } from './hostServer';
import {
  CHALLENGE_METHOD,
  CHALLENGE_PARAMS_SCHEMA,
  errorResponse,
  HELLO_PARAMS_SCHEMA,
  HOST_CAPABILITIES,
  HOST_METHOD_SCHEMAS,
  HOST_PROTOCOL,
  HostErrorCode,
  isHostMethod,
  notification,
  protocolMismatch,
  REQUEST_ENVELOPE_SCHEMA,
  resultResponse,
  SUBSCRIPTION_CLOSED_NOTIFICATION,
  withLegacyText,
  type HostCreateRequest,
  type HostErrorBody,
  type HostMethod,
  type HostOptionKey,
  type RequestEnvelope,
  type RequestId,
} from './hostProtocol';
import { challengeProof, tokenMatches } from './hostToken';

// Una conexión del host local (F2.6). Sin E/S propia: habla con un `HostTransport` (el socket, en producción) y
// con `HostSessions` (el coordinador), los dos inyectados, así que se prueba entera con dobles.

// Lo que necesita del socket.
export interface HostTransport {
  write(data: string): void;
  end(): void;
  // Bytes encolados sin enviar: un cliente que no lee no puede hacer crecer la memoria de main.
  readonly bufferedBytes: () => number;
}

export interface SessionSubscription {
  readonly snapshot: ConversationSnapshot;
  readonly unsubscribe: () => void;
}

// El coordinador visto por un cliente del host (`SessionCoordinator` lo satisface estructuralmente).
export interface HostSessions {
  listSessions(): readonly ConversationSnapshot[];
  snapshot(sessionId: string): ConversationSnapshot;
  subscribe(sessionId: string, listener: { readonly sink: (event: SequencedSessionEvent) => void; readonly onClosed: () => void }): SessionSubscription;
  send(params: SendMessageParams): SendReceipt;
  interrupt(sessionId: string): readonly QueuedMessage[];
  removeQueued(sessionId: string, messageId: string): QueuedMessage | null;
  updateQueued(sessionId: string, messageId: string, text: string): QueuedMessage | null;
  answerPermission(sessionId: string, requestId: string, decision: PermissionDecision): AnswerReceipt;
  answerElicitation(answer: ElicitationAnswer): AnswerReceipt;
}

export interface HostConnectionDeps {
  readonly sessions: HostSessions;
  readonly token: string;
  readonly hostVersion: string;
  readonly log: SessionLogFn;
  readonly newId: () => string;
  // Temporizador cancelable: el plazo para el `hello`.
  readonly setTimer: (fn: () => void, ms: number) => () => void;
  readonly maxLineBytes?: number;
  // Idioma de main: con él se traduce el campo de siempre de los eventos con `localized` (clientes 1.0).
  readonly translate: Translate;
  readonly mode: HostMode;
  readonly control: HostControl;
}

// Una conexión que no se identifica en este tiempo se cierra: no puede retener un socket sin dar el token.
export const HELLO_DEADLINE_MS = 5_000;
// Más que esto sin enviar al cliente = consumidor lento: se corta, nunca se acumula sin tope.
export const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

type Phase = 'handshake' | 'ready' | 'closed';

export class HostConnection {
  private phase: Phase = 'handshake';
  private challenged = false;
  private readonly framer: NdjsonFramer;
  private readonly subscriptions = new Map<string, () => void>();
  private readonly cancelHelloTimer: () => void;

  constructor(private readonly transport: HostTransport, private readonly deps: HostConnectionDeps) {
    this.framer = new NdjsonFramer(deps.maxLineBytes ?? MAX_LINE_BYTES);
    this.cancelHelloTimer = deps.setTimer(() => this.onHelloDeadline(), HELLO_DEADLINE_MS);
  }

  // Bytes que llegan del socket.
  receive(chunk: Buffer): void {
    if (this.isClosed()) return;
    for (const frame of this.framer.push(chunk)) {
      if (this.isClosed()) return;
      if (frame.kind === 'overflow') {
        this.fail(null, { code: HostErrorCode.LineTooLong, message: `Línea de más de ${frame.limit} bytes: se cierra la conexión` });
        return;
      }
      this.handleLine(frame.text);
    }
  }

  // Método y no comparación inline: `handleLine` cambia la fase y TypeScript no lo ve desde el bucle.
  private isClosed(): boolean {
    return this.phase === 'closed';
  }

  // El socket se cerró (por el cliente o por error): se sueltan sus suscripciones.
  closed(): void {
    this.shutdown();
  }

  private handleLine(text: string): void {
    const envelope = this.parseEnvelope(text);
    if (envelope === null) return;
    const { id, method, params } = envelope;
    if (this.phase === 'handshake') {
      this.handleHello(id, method, params);
      return;
    }
    this.dispatch(id, method, params);
  }

  // JSON inválido o envoltorio que no es JSON-RPC: se contesta con su error y se cierra. Nunca tumba main.
  private parseEnvelope(text: string): RequestEnvelope | null {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      this.fail(null, { code: HostErrorCode.ParseError, message: `JSON inválido: ${err instanceof Error ? err.message : String(err)}` });
      return null;
    }
    const parsed = REQUEST_ENVELOPE_SCHEMA.safeParse(json);
    if (!parsed.success) {
      this.fail(null, { code: HostErrorCode.InvalidRequest, message: `Mensaje JSON-RPC inválido: ${describeIssues(parsed.error.issues)}` });
      return null;
    }
    return parsed.data;
  }

  private handleHello(id: RequestId | undefined, method: string, params: unknown): void {
    if (method === CHALLENGE_METHOD) {
      this.handleChallenge(id, params);
      return;
    }
    if (method !== 'hello') {
      this.fail(id ?? null, { code: HostErrorCode.NotAuthenticated, message: 'Hay que presentarse con «hello» antes de cualquier otra petición' });
      return;
    }
    const hello = HELLO_PARAMS_SCHEMA.safeParse(params);
    if (!hello.success) {
      this.fail(id ?? null, { code: HostErrorCode.InvalidParams, message: `Parámetros de hello inválidos: ${describeIssues(hello.error.issues)}` });
      return;
    }
    const mismatch = protocolMismatch(hello.data.protocol);
    if (mismatch !== null) {
      this.fail(id ?? null, { code: HostErrorCode.ProtocolMismatch, message: mismatch });
      return;
    }
    if (!tokenMatches(this.deps.token, hello.data.token)) {
      this.deps.log('warn', 'Un cliente del host presentó un token incorrecto', { client: hello.data.client.kind });
      this.fail(id ?? null, { code: HostErrorCode.BadToken, message: 'Token del host incorrecto' });
      return;
    }
    this.cancelHelloTimer();
    this.phase = 'ready';
    if (id !== undefined) this.transport.write(resultResponse(id, { protocol: HOST_PROTOCOL, hostVersion: this.deps.hostVersion, capabilities: HOST_CAPABILITIES }));
  }

  // Reto del cliente (F7.1): solo antes de `hello` y una vez por conexión. La fase no cambia: después hay que
  // presentarse igual, dentro del mismo plazo.
  private handleChallenge(id: RequestId | undefined, params: unknown): void {
    if (id === undefined) {
      this.fail(null, { code: HostErrorCode.InvalidRequest, message: '«host.challenge» necesita un id para poder responder' });
      return;
    }
    if (this.challenged) {
      this.fail(id, { code: HostErrorCode.InvalidRequest, message: 'Solo se admite un «host.challenge» por conexión' });
      return;
    }
    const parsed = CHALLENGE_PARAMS_SCHEMA.safeParse(params);
    if (!parsed.success) {
      this.fail(id, { code: HostErrorCode.InvalidParams, message: `Parámetros de host.challenge inválidos: ${describeIssues(parsed.error.issues)}` });
      return;
    }
    this.challenged = true;
    this.transport.write(resultResponse(id, { proof: challengeProof(this.deps.token, parsed.data.nonce) }));
  }

  private dispatch(id: RequestId | undefined, method: string, params: unknown): void {
    if (!isHostMethod(method)) {
      this.reply(id, { code: HostErrorCode.MethodNotFound, message: `Método desconocido: ${method}` });
      return;
    }
    const schema: ZodTypeAny = HOST_METHOD_SCHEMAS[method];
    const parsed = schema.safeParse(params);
    if (!parsed.success) {
      this.reply(id, { code: HostErrorCode.InvalidParams, message: `Parámetros inválidos en ${method}: ${describeIssues(parsed.error.issues)}` });
      return;
    }
    try {
      const result = this.run(method, parsed.data);
      if (id !== undefined) this.transport.write(resultResponse(id, result));
    } catch (err) {
      this.reply(id, toErrorBody(err));
    }
  }

  private run(method: HostMethod, params: unknown): unknown {
    const { sessions } = this.deps;
    switch (method) {
      case 'sessions.list': return { sessions: sessions.listSessions() };
      case 'session.snapshot': return sessions.snapshot((params as { sessionId: string }).sessionId);
      case 'session.subscribe': return this.subscribe((params as { sessionId: string }).sessionId);
      case 'session.unsubscribe': return this.unsubscribe((params as { subscriptionId: string }).subscriptionId);
      case 'session.send': return sessions.send(params as SendMessageParams);
      case 'session.interrupt': return { queued: sessions.interrupt((params as { sessionId: string }).sessionId) };
      case 'session.answerPermission': {
        const answer = params as { sessionId: string; requestId: string; decision: PermissionDecision };
        return sessions.answerPermission(answer.sessionId, answer.requestId, answer.decision);
      }
      case 'session.answerElicitation': return sessions.answerElicitation(params as ElicitationAnswer);
      default: return this.runV12(method, params);
    }
  }

  // Métodos del host 1.2 (F7.2): los que no pasan solo por el coordinador.
  private runV12(method: HostMethod, params: unknown): unknown {
    const { sessions, control } = this.deps;
    switch (method) {
      case 'host.info': return { protocol: HOST_PROTOCOL, mode: this.deps.mode, capabilities: HOST_CAPABILITIES };
      case 'projects.list': return { projects: control.listProjects() };
      case 'accounts.list': return { accounts: control.listAccounts() };
      case 'session.create': return control.createSession(params as HostCreateRequest);
      case 'session.resume': return this.resume((params as { conversationId: string }).conversationId);
      case 'session.setOption': {
        const option = params as { sessionId: string; key: HostOptionKey; value: string };
        control.setOption(option.sessionId, option.key, option.value);
        return { applied: true };
      }
      case 'session.cancelQueued': {
        const target = params as { sessionId: string; queuedId: string };
        return { removed: sessions.removeQueued(target.sessionId, target.queuedId) };
      }
      case 'session.updateQueued': {
        const target = params as { sessionId: string; queuedId: string; text: string };
        return { updated: sessions.updateQueued(target.sessionId, target.queuedId, target.text) };
      }
      default: throw new UnsupportedMethodError(method);
    }
  }

  // Solo conversaciones con sesión VIVA en este host (reanudar una cerrada no entra todavía).
  private resume(conversationId: string): ConversationSnapshot {
    const live = this.deps.sessions.listSessions().find((snapshot) => snapshot.conversationId === conversationId);
    if (live === undefined) throw new UnknownConversationError(conversationId);
    return live;
  }

  // La instantánea y los eventos siguientes van juntos: todo lo posterior a `snapshot.lastSeq` llega como
  // notificación `event`, sin huecos ni repeticiones (el coordinador entrega síncrono).
  private subscribe(sessionId: string): { subscriptionId: string; snapshot: ConversationSnapshot } {
    const subscriptionId = this.deps.newId();
    const { snapshot, unsubscribe } = this.deps.sessions.subscribe(sessionId, {
      sink: (event) => this.pushEvent(subscriptionId, event),
      onClosed: () => this.onSessionClosed(subscriptionId),
    });
    this.subscriptions.set(subscriptionId, unsubscribe);
    return { subscriptionId, snapshot };
  }

  private unsubscribe(subscriptionId: string): { released: boolean } {
    return { released: this.endSubscription(subscriptionId) };
  }

  private endSubscription(subscriptionId: string): boolean {
    const unsubscribe = this.subscriptions.get(subscriptionId);
    if (unsubscribe === undefined) return false;
    this.subscriptions.delete(subscriptionId);
    unsubscribe();
    return true;
  }

  // La sesión terminó en el host: se suelta la suscripción y se avisa al cliente (1.3), que si no se enteraría
  // solo al siguiente envío. Una suscripción ya soltada no avisa dos veces.
  private onSessionClosed(subscriptionId: string): void {
    if (!this.endSubscription(subscriptionId)) return;
    if (this.phase !== 'ready') return;
    this.transport.write(notification(SUBSCRIPTION_CLOSED_NOTIFICATION, { subscriptionId }));
  }

  private pushEvent(subscriptionId: string, event: SequencedSessionEvent): void {
    if (this.phase !== 'ready') return;
    if (this.transport.bufferedBytes() > MAX_BUFFERED_BYTES) {
      this.deps.log('warn', 'Cliente del host demasiado lento: se cierra su conexión', { buffered: this.transport.bufferedBytes() });
      this.fail(null, { code: HostErrorCode.SlowConsumer, message: 'No lees los eventos a tiempo: se cierra la conexión' });
      return;
    }
    this.transport.write(notification('event', { subscriptionId, ...event, event: withLegacyText(event.event, this.deps.translate) }));
  }

  private reply(id: RequestId | undefined, error: HostErrorBody): void {
    if (id !== undefined) this.transport.write(errorResponse(id, error));
  }

  // Responde con el error, cierra y suelta todo.
  private fail(id: RequestId | null, error: HostErrorBody): void {
    if (this.phase === 'closed') return;
    this.transport.write(errorResponse(id, error));
    this.transport.end();
    this.shutdown();
  }

  private onHelloDeadline(): void {
    if (this.phase !== 'handshake') return;
    this.fail(null, { code: HostErrorCode.NotAuthenticated, message: `No te presentaste con «hello» en ${HELLO_DEADLINE_MS} ms` });
  }

  private shutdown(): void {
    this.phase = 'closed';
    this.cancelHelloTimer();
    const pending = [...this.subscriptions.values()];
    this.subscriptions.clear();
    for (const unsubscribe of pending) unsubscribe();
  }
}

function describeIssues(issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[]): string {
  return issues.map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`).join('; ');
}

// Errores propios del host 1.2 y su código JSON-RPC.
const OWN_ERROR_CODES: readonly (readonly [abstract new (...args: never[]) => Error, number])[] = [
  [TrustRequiredError, HostErrorCode.TrustRequired],
  [UnknownAccountError, HostErrorCode.UnknownAccount],
  [UnknownConversationError, HostErrorCode.UnknownConversation],
  [UnsupportedMethodError, HostErrorCode.Unsupported],
];

// Un UserFacingError lleva marca y JSON tras el castellano: al cliente solo le llega el castellano limpio.
function errorMessageOf(err: unknown): string {
  if (err instanceof UserFacingError) return renderForLog(err.localized);
  return err instanceof Error ? err.message : String(err);
}

// Un fallo del coordinador: sesión inexistente es un error propio; el resto es interno (el mensaje llega al
// cliente, que es de confianza: ya presentó el token).
function toErrorBody(err: unknown): HostErrorBody {
  const message = errorMessageOf(err);
  const own = OWN_ERROR_CODES.find(([errorClass]) => err instanceof errorClass);
  if (own !== undefined) return { code: own[1], message };
  if (message.startsWith('Sesion inexistente')) return { code: HostErrorCode.UnknownSession, message };
  return { code: HostErrorCode.Internal, message };
}
