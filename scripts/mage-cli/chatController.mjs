// Lógica de la conversación de `mage chat` (F7.3): suscripción a la sesión, envío, permisos, señales de D4 y
// reconexión de D2. SIN readline ni `process`: todo lo de fuera llega por `deps` (inyección), así se prueba con
// un host falso. Sin dependencias: solo `node:*`.
import { randomUUID } from 'node:crypto';
import { PendingSends } from './pendingSends.mjs';
import { renderEvent } from './render.mjs';
import { decideCtrlC, decideLine, decidePermissionAnswer, isTurnActive } from './signals.mjs';

const UNKNOWN_SESSION_CODE = -32004;
const DENIED_FROM_TERMINAL = 'Denegado desde la terminal';

// Un error con `code` numérico es la respuesta JSON-RPC del host; sin él (o con código de socket en texto) la
// conexión se cayó y lo trata `onDisconnected`.
const isHostError = (error) => typeof error?.code === 'number';

export class ChatController {
  // Enlace actual: `mage.mjs` lo sustituye por el nuevo al reconectar (lo hace `onDisconnected`).
  link;
  #deps;
  #turnActive = false;
  #lastInterruptAt = null;
  #lastSeq = 0;
  #subscriptionId = null;
  #pendingPermission = null;
  #resendQueue = [];
  #pending = new PendingSends();
  #closing = false;

  constructor(deps) {
    this.#deps = deps;
    this.link = deps.link;
  }

  // `announce: false` en la resuscripción tras reconectar: no se repite la ayuda.
  // Devuelve false si la sesión ya no existe en el host (ya se ha dicho y se ha salido).
  async attach({ announce = true } = {}) {
    const { sessionId, messages } = this.#deps;
    this.link.rpc.onNotification((method, params) => this.#onNotification(method, params));
    let subscribed;
    try {
      subscribed = await this.link.rpc.call('session.subscribe', { sessionId });
    } catch (error) {
      if (error?.code !== UNKNOWN_SESSION_CODE) throw error;
      this.#say(messages.sessionClosed());
      this.#deps.exit(0);
      return false;
    }
    const { subscriptionId, snapshot } = subscribed;
    this.#subscriptionId = subscriptionId;
    this.#lastSeq = snapshot.lastSeq;
    this.#turnActive = isTurnActive(snapshot.state);
    if (announce) this.#say(messages.attached(snapshot.conversationId ?? sessionId));
    for (const request of snapshot.pending) this.#showPending(request);
    return true;
  }

  async onLine(text) {
    if (this.#resendQueue.length > 0) return this.#handleResendAnswer(text);
    if (this.#pendingPermission !== null) return this.#handlePermissionAnswer(text);
    const decision = decideLine(text);
    if (decision === 'exit') return this.leave();
    if (decision === 'empty') return undefined;
    return this.#send(randomUUID(), text);
  }

  async onCtrlC() {
    const { action, next } = decideCtrlC({ turnActive: this.#turnActive, lastInterruptAt: this.#lastInterruptAt }, this.#deps.now());
    if (action === 'exit') return this.leave();
    this.#lastInterruptAt = next.lastInterruptAt;
    const { messages } = this.#deps;
    const outcome = await this.#hostCall('session.interrupt', { sessionId: this.#deps.sessionId });
    if (outcome.status !== 'ok') return undefined;
    this.#say(messages.interrupted(outcome.value.queued.length));
    this.#say(messages.interruptAgainToExit());
    return undefined;
  }

  // Ctrl+D: salir no es cancelar.
  onEndOfInput() {
    if (this.#closing) return;
    this.leave();
  }

  // SIGHUP / SIGTERM: sale SIN llamar a nada del host (conserva sesión, trabajo y permiso pendiente).
  onKilled() {
    this.#closing = true;
    this.#deps.exit(0);
  }

  // Nunca llama a `session.interrupt` ni a nada del host.
  leave() {
    this.#closing = true;
    this.#say(this.#deps.messages.leaving());
    this.#deps.exit(0);
  }

  async onDisconnected() {
    if (this.#closing) return;
    const { messages } = this.#deps;
    this.#say(messages.connectionLost());
    // Los inciertos pasan a la cola de preguntas: al reenviar, `track` los vuelve a registrar.
    this.#resendQueue.push(...this.#pending.markAllUncertain());
    this.#pending.takeUncertain();
    this.#pendingPermission = null;
    const previousSeq = this.#lastSeq;
    if (!(await this.#reconnect())) return;
    if (!(await this.attach({ announce: false }))) return;
    this.#say(messages.reconnected(Math.max(0, this.#lastSeq - previousSeq)));
    // NUNCA reenvía sin respuesta del usuario.
    if (this.#resendQueue.length > 0) this.#say(messages.resendAsk(this.#resendQueue[0].text));
  }

  async #reconnect() {
    try {
      this.link = await this.#deps.reconnect();
      return true;
    } catch (error) {
      this.#closing = true;
      this.#say(this.#deps.messages.error(error.message));
      this.#deps.exit(1);
      return false;
    }
  }

  #say(text) {
    this.#deps.write(`${text}\n`);
  }

  #onNotification(method, params) {
    if (method !== 'event' || params.subscriptionId !== this.#subscriptionId) return;
    this.#lastSeq = params.seq;
    const { event } = params;
    if (event.kind === 'session_state') this.#turnActive = isTurnActive(event.state);
    if (event.kind === 'permission_request') this.#showPending({ kind: 'permission', request: event.request });
    if (event.kind === 'permission_resolved' && this.#pendingPermission?.requestId === event.requestId) this.#pendingPermission = null;
    const text = renderEvent(event, this.#deps.messages);
    if (text !== null) this.#deps.write(text);
  }

  // Los permisos se contestan en la terminal; las preguntas y elicitations, solo en la ventana de Mage.
  #showPending(pending) {
    const { messages } = this.#deps;
    // Una elicitation en vivo ya la anuncia `renderEvent`: aquí solo llegan las de la instantánea.
    if (pending.kind !== 'permission' || pending.request.requiresUserInteraction) {
      this.#say(messages.answerInMage());
      return;
    }
    const { request } = pending;
    this.#pendingPermission = { requestId: request.requestId };
    this.#say(messages.permissionAsk(request.displayName ?? request.toolName, request.description));
  }

  async #handleResendAnswer(text) {
    const answer = decidePermissionAnswer(text);
    if (answer === null) return this.#say(this.#deps.messages.answerYesNo());
    const [first] = this.#resendQueue.splice(0, 1);
    if (answer === 'allow') await this.#send(first.commandId, first.text);
    if (this.#resendQueue.length > 0) this.#say(this.#deps.messages.resendAsk(this.#resendQueue[0].text));
    return undefined;
  }

  async #handlePermissionAnswer(text) {
    const answer = decidePermissionAnswer(text);
    if (answer === null) return this.#say(this.#deps.messages.answerYesNo());
    const { requestId } = this.#pendingPermission;
    this.#pendingPermission = null;
    const decision = answer === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: DENIED_FROM_TERMINAL };
    await this.#hostCall('session.answerPermission', { sessionId: this.#deps.sessionId, requestId, decision });
    return undefined;
  }

  // El `commandId` es el mismo al reenviar: el host deduplica lo que ya hubiera llegado.
  async #send(commandId, text) {
    this.#pending.track(commandId, text);
    const outcome = await this.#hostCall('session.send', { sessionId: this.#deps.sessionId, text, commandId });
    // Sin respuesta (conexión caída) queda sin resolver: lo recoge `onDisconnected`.
    if (outcome.status === 'lost') return;
    this.#pending.settle(commandId);
    if (outcome.status === 'ok' && outcome.value.status === 'queued') this.#say(this.#deps.messages.queued());
  }

  // Llama al host y clasifica el resultado: `ok`, `hostError` (ya escrito) o `lost` (conexión caída).
  async #hostCall(method, params) {
    try {
      return { status: 'ok', value: await this.link.rpc.call(method, params) };
    } catch (error) {
      if (!isHostError(error)) return { status: 'lost', value: undefined };
      this.#say(this.#deps.messages.error(error.message));
      return { status: 'hostError', value: undefined };
    }
  }
}
