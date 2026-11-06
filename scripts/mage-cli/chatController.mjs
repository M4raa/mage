// Lógica de la conversación de `mage chat` (F7.3): suscripción a la sesión, envío, permisos, señales de D4 y
// reconexión de D2. SIN readline ni `process`: todo lo de fuera llega por `deps` (inyección), así se prueba con
// un host falso. Sin dependencias: solo `node:*`.
import { randomUUID } from 'node:crypto';
import { PendingSends } from './pendingSends.mjs';
import { PromptDesk } from './promptDesk.mjs';
import { promptFromPending, promptIsSecret, promptText, replyToPrompt } from './promptFlow.mjs';
import { renderEvent } from './render.mjs';
import { parseRewindCommand, RewindPrompt } from './rewindFlow.mjs';
import { decideCtrlC, decideLine, decidePermissionAnswer, isTurnActive } from './signals.mjs';

const UNKNOWN_SESSION_CODE = -32004;
const RESOLVED_ELSEWHERE_KINDS = new Set(['permission_resolved', 'elicitation_resolved', 'elicitation_cancelled']);

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
  #desk = new PromptDesk();
  #setMuted;
  #reconnecting = false;
  #unsent = [];
  #resendQueue = [];
  #pending = new PendingSends();
  #closing = false;
  #ownTurns = 0;
  #inputEnded = false;
  #rewind;

  constructor(deps) {
    this.#deps = deps;
    this.link = deps.link;
    this.#setMuted = deps.setMuted ?? (() => undefined);
    this.#rewind = new RewindPrompt({ hostCall: (method, params) => this.#hostCall(method, params), say: (text) => this.#say(text), prefill: deps.prefill, sessionId: deps.sessionId, messages: deps.messages });
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
    if (this.#reconnecting) return this.#holdUnsent(text);
    if (this.#resendQueue.length > 0) return this.#handleResendAnswer(text);
    if (this.#desk.active() !== null) return this.#answerPrompt(text);
    if (this.#rewind.active) return this.#rewind.answer(text);
    const rewindCommand = parseRewindCommand(text);
    if (rewindCommand !== null) return this.#rewind.start(rewindCommand);
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

  // Ctrl+D o una tubería que se acaba: salir no es cancelar. Si esta terminal mandó un turno que aún no ha terminado,
  // espera a su final (se pinta) y luego sale.
  onEndOfInput() {
    if (this.#closing) return;
    this.#inputEnded = true;
    if (this.#ownTurns === 0) this.leave();
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
    this.#reconnecting = true;
    // Los inciertos pasan a la cola de preguntas: al reenviar, `track` los vuelve a registrar.
    this.#resendQueue.push(...this.#pending.markAllUncertain());
    this.#pending.takeUncertain();
    this.#desk.clear();
    this.#setMuted(false);
    const previousSeq = this.#lastSeq;
    if (!(await this.#reconnect())) return;
    if (!(await this.attach({ announce: false }))) return;
    this.#reconnecting = false;
    this.#say(messages.reconnected(Math.max(0, this.#lastSeq - previousSeq)));
    this.#queueUnsentForResend();
    // NUNCA reenvía sin respuesta del usuario.
    if (this.#resendQueue.length > 0) this.#askResend(this.#resendQueue[0]);
  }

  // Lo escrito sin conexión nunca llegó al host: se ofrece después de los inciertos, con su commandId nuevo.
  #queueUnsentForResend() {
    if (this.#unsent.length === 0) return;
    this.#say(this.#deps.messages.unsentDuringReconnect(this.#unsent.length));
    this.#resendQueue.push(...this.#unsent.splice(0).map((item) => ({ ...item, unsent: true })));
  }

  #askResend(item) {
    const { messages } = this.#deps;
    this.#say(item.unsent === true ? messages.resendUnsentAsk(item.text) : messages.resendAsk(item.text));
  }

  // Mientras se reconecta no se envía nada por el enlace caído: se guarda y se avisa.
  #holdUnsent(text) {
    const decision = decideLine(text);
    if (decision === 'empty') return undefined;
    if (decision === 'exit') return this.leave();
    this.#unsent.push({ commandId: randomUUID(), text });
    this.#say(this.#deps.messages.notSentOffline());
    return undefined;
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
    if (method === 'subscription.closed') return this.#onSubscriptionClosed(params);
    if (method !== 'event' || params.subscriptionId !== this.#subscriptionId) return undefined;
    this.#lastSeq = params.seq;
    const { event } = params;
    if (event.kind === 'session_state') this.#turnActive = isTurnActive(event.state);
    const text = renderEvent(event, this.#deps.messages);
    if (text !== null) this.#deps.write(text);
    if (event.kind === 'result') this.#onTurnResult();
    return this.#onPendingEvent(event);
  }

  // ponytail: cuenta resultados, no turnos por id; si en la cola hay un turno de otro cliente antes que el nuestro, se
  // sale un turno antes. Con ids de turno en el evento `result`, casarlos.
  #onTurnResult() {
    if (this.#ownTurns > 0) this.#ownTurns -= 1;
    if (this.#inputEnded && this.#ownTurns === 0 && !this.#closing) this.leave();
  }

  #onSubscriptionClosed(params) {
    if (params?.subscriptionId !== this.#subscriptionId) return undefined;
    this.#closing = true;
    this.#say(this.#deps.messages.sessionClosed());
    this.#deps.exit(0);
    return undefined;
  }

  #onPendingEvent(event) {
    if (event.kind === 'permission_request') this.#showPending({ kind: 'permission', request: event.request });
    if (event.kind === 'elicitation_request') this.#showPending({ kind: 'elicitation', request: event.request });
    if (RESOLVED_ELSEWHERE_KINDS.has(event.kind)) this.#resolvedElsewhere(event);
  }

  // Lo contestó otro cliente (o caducó): se quita de la mesa y se pasa a la siguiente. Si lo acaba de contestar
  // esta terminal, #settlePrompt ya lo quitó y no hay nada que decir.
  #resolvedElsewhere(event) {
    const { wasActive, next } = this.#desk.resolve(event.requestId);
    if (!wasActive) return;
    this.#setMuted(false);
    if (event.kind !== 'permission_resolved') this.#say(this.#deps.messages.answeredElsewhere());
    if (next !== null) this.#present(next);
  }

  // Lo que la terminal sabe pintar se contesta aquí, de una en una; lo demás se contesta en la ventana de Mage.
  #showPending(pending) {
    // Con la entrada cerrada nadie puede contestar desde esta terminal: se dice dónde y se sale.
    if (this.#inputEnded) {
      this.#say(this.#deps.messages.answerInMage());
      return this.leave();
    }
    const prompt = promptFromPending(pending);
    if (prompt === null) {
      this.#say(this.#deps.messages.answerInMage());
      return;
    }
    if (this.#desk.offer(prompt) === 'shown') this.#present(prompt);
  }

  #present(prompt) {
    this.#say(promptText(prompt, this.#deps.messages));
    this.#setMuted(promptIsSecret(prompt));
  }

  #invalidText(reason) {
    const { messages } = this.#deps;
    if (reason === 'yesNo') return messages.answerYesNo();
    if (reason === 'question') return messages.questionInvalid();
    return messages.elicitationInvalid(reason);
  }

  async #answerPrompt(text) {
    this.#setMuted(false);
    const active = this.#desk.active();
    const outcome = replyToPrompt(active, text);
    if (outcome.kind === 'invalid') {
      this.#say(this.#invalidText(outcome.reason));
      return this.#present(active);
    }
    if (outcome.kind === 'continue') {
      this.#desk.replaceActive(outcome.prompt);
      return this.#present(outcome.prompt);
    }
    await this.#hostCall(...this.#answerCall(active, outcome));
    return this.#settlePrompt(active.requestId);
  }

  #answerCall(active, outcome) {
    const base = { sessionId: this.#deps.sessionId, requestId: active.requestId };
    if (outcome.kind === 'answerPermission') return ['session.answerPermission', { ...base, decision: outcome.decision }];
    const content = outcome.content === undefined ? {} : { content: outcome.content };
    return ['session.answerElicitation', { ...base, action: outcome.action, ...content }];
  }

  #settlePrompt(requestId) {
    const { wasActive, next } = this.#desk.resolve(requestId);
    if (!wasActive) return;
    if (next === null) this.#setMuted(false);
    else this.#present(next);
  }

  async #handleResendAnswer(text) {
    const answer = decidePermissionAnswer(text);
    if (answer === null) return this.#say(this.#deps.messages.answerYesNo());
    const [first] = this.#resendQueue.splice(0, 1);
    if (answer === 'allow') await this.#send(first.commandId, first.text);
    if (this.#resendQueue.length > 0) this.#askResend(this.#resendQueue[0]);
    return undefined;
  }

  // El `commandId` es el mismo al reenviar: el host deduplica lo que ya hubiera llegado.
  async #send(commandId, text) {
    this.#pending.track(commandId, text);
    const outcome = await this.#hostCall('session.send', { sessionId: this.#deps.sessionId, text, commandId });
    // Sin respuesta (conexión caída) queda sin resolver: lo recoge `onDisconnected`.
    if (outcome.status === 'lost') return;
    this.#pending.settle(commandId);
    if (outcome.status === 'ok') this.#ownTurns += 1;
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
