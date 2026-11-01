// Decisiones puras de las señales de la terminal (F7.3, tabla D4): qué hace Ctrl+C, una línea escrita o la
// respuesta a un permiso. No toca E/S ni el reloj: el controlador le pasa el estado y la hora.

export const DOUBLE_CTRL_C_MS = 2000;

const EXIT_WORDS = new Set(['exit', '/exit', 'salir', '/salir']);
const ALLOW_WORDS = new Set(['s', 'si', 'sí', 'y', 'yes']);
const DENY_WORDS = new Set(['n', 'no']);

// «Hay turno en marcha» = el último estado conocido es `running` o `requires_action`.
export function isTurnActive(state) {
  return state === 'running' || state === 'requires_action';
}

// Primera pulsación con turno: interrumpe y apunta la hora. Segunda en menos de 2 s, o sin turno: sale.
export function decideCtrlC(signalState, nowMs) {
  if (!Number.isInteger(nowMs)) throw new Error(`La hora de Ctrl+C debe ser un entero finito: ${String(nowMs)}`);
  const { turnActive, lastInterruptAt } = signalState;
  if (!turnActive) return { action: 'exit', next: { turnActive, lastInterruptAt } };
  const isSecondPress = lastInterruptAt !== null && nowMs - lastInterruptAt < DOUBLE_CTRL_C_MS;
  if (isSecondPress) return { action: 'exit', next: { turnActive, lastInterruptAt } };
  return { action: 'interrupt', next: { turnActive, lastInterruptAt: nowMs } };
}

export function decideLine(text) {
  const trimmed = text.trim();
  if (EXIT_WORDS.has(trimmed)) return 'exit';
  if (trimmed.length === 0) return 'empty';
  return 'send';
}

export function decidePermissionAnswer(text) {
  const normalized = text.trim().toLowerCase();
  if (ALLOW_WORDS.has(normalized)) return 'allow';
  if (DENY_WORDS.has(normalized)) return 'deny';
  return null;
}
