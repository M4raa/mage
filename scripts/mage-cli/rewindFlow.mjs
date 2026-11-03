// `/rewind` en `mage chat` (host 1.4): el análisis del comando, la elección del punto y el diálogo de
// confirmación. Sin E/S propia: el host, la salida y el cuadro de texto llegan por `deps`, así que se prueba
// con dobles. Sin dependencias más que `signals.mjs`.
import { decidePermissionAnswer } from './signals.mjs';

const COMMAND = '/rewind';
const EXCERPT_MAX = 80;
const ELLIPSIS = '…';
const FLAG_WORDS = new Map([['--files', 'files'], ['--copy', 'copy']]);

// `null` si la línea no es el comando; si lo es, las opciones o `{ error }` con la primera palabra desconocida.
export function parseRewindCommand(text) {
  const words = text.trim().split(/\s+/);
  if (words[0] !== COMMAND) return null;
  const flags = { files: false, copy: false };
  for (const word of words.slice(1)) {
    const flag = FLAG_WORDS.get(word);
    if (flag === undefined) return { error: word };
    flags[flag] = true;
  }
  return flags;
}

// Qué ha elegido el usuario de la lista de puntos: `cancel`, `invalid`, `notRewindable` o `point` con lo que pide el host.
export function pickPoint(points, answer) {
  const text = answer.trim();
  if (text === '') return { kind: 'cancel' };
  if (!/^\d+$/.test(text)) return { kind: 'invalid' };
  const found = points.find((p) => p.userIndex === Number(text) - 1);
  if (found === undefined) return { kind: 'invalid' };
  if (!found.rewindable) return { kind: 'notRewindable' };
  return { kind: 'point', point: { userIndex: found.userIndex, text: found.text, nativeId: found.nativeId } };
}

// Lo que se pedirá al host y lo que no se podrá dar de lo que el usuario quiso (`--files`, `--copy`).
export function applyOptions(plan, flags) {
  const filesAvailable = plan.files?.available === true;
  const copyAvailable = plan.canSaveCopy === true;
  return {
    restoreFiles: flags.files && filesAvailable,
    saveCopy: flags.copy && copyAvailable,
    filesUnavailable: flags.files && !filesAvailable,
    copyUnavailable: flags.copy && !copyAvailable,
  };
}

// Una sola línea, recortada a `max` caracteres con «…».
export function excerpt(text, max = EXCERPT_MAX) {
  const line = text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  if (line.length <= max) return line;
  return `${line.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

// El diálogo: `start` lista los puntos y `answer` atiende el número y la confirmación. Un error del host (que
// `hostCall` ya ha dicho) o cualquier salida del flujo deja el estado en null.
export class RewindPrompt {
  #deps;
  #state = null;

  // deps: { hostCall, say, prefill, sessionId, messages }
  constructor(deps) {
    this.#deps = deps;
  }

  get active() {
    return this.#state !== null;
  }

  async start(command) {
    const { hostCall, say, sessionId, messages } = this.#deps;
    if (command.error !== undefined) {
      say(messages.rewindUnknownOption(command.error));
      say(messages.rewindUsage());
      return;
    }
    const outcome = await hostCall('session.rewindPoints', { sessionId });
    if (outcome.status !== 'ok') return;
    const { points } = outcome.value;
    if (points.length === 0) {
      say(messages.rewindNoPoints());
      return;
    }
    for (const p of points) say(messages.rewindPointLine(p.userIndex + 1, excerpt(p.text), p.rewindable));
    say(messages.rewindAskNumber());
    this.#state = { step: 'number', points, flags: command };
  }

  async answer(text) {
    const state = this.#state;
    if (state.step === 'number') return this.#answerNumber(state, text);
    this.#state = null;
    if (decidePermissionAnswer(text) !== 'allow') return this.#deps.say(this.#deps.messages.rewindCancelled());
    return this.#apply(state);
  }

  async #answerNumber(state, text) {
    const { say, messages } = this.#deps;
    const picked = pickPoint(state.points, text);
    if (picked.kind === 'invalid' || picked.kind === 'notRewindable') {
      say(picked.kind === 'invalid' ? messages.rewindInvalidNumber() : messages.rewindNotRewindable());
      return say(messages.rewindAskNumber());
    }
    this.#state = null;
    if (picked.kind === 'cancel') return say(messages.rewindCancelled());
    return this.#plan(state.flags, picked.point);
  }

  async #plan(flags, point) {
    const { hostCall, say, sessionId, messages } = this.#deps;
    const outcome = await hostCall('session.rewindPlan', { sessionId, point, action: 'rewind' });
    if (outcome.status !== 'ok') return;
    const plan = outcome.value;
    if (plan.unavailable !== null) return say(messages.rewindUnavailable(plan.unavailable));
    const options = applyOptions(plan, flags);
    if (options.filesUnavailable) say(messages.rewindFilesUnavailable());
    if (options.copyUnavailable) say(messages.rewindCopyUnavailable());
    say(messages.rewindPlanSummary(plan));
    say(messages.rewindConfirm());
    this.#state = { step: 'confirm', point, options };
    return undefined;
  }

  async #apply({ point, options }) {
    const { hostCall, say, prefill, sessionId, messages } = this.#deps;
    const params = { sessionId, point, action: 'rewind', restoreFiles: options.restoreFiles, saveCopy: options.saveCopy };
    const outcome = await hostCall('session.rewind', params);
    if (outcome.status !== 'ok') return;
    const result = outcome.value;
    say(messages.rewindDone(result.filesRestored, result.copyThreadId));
    if (result.returnedQueue.length > 0) say(messages.rewindReturnedQueue(result.returnedQueue.length));
    if (result.draft !== '') prefill?.(result.draft);
  }
}
