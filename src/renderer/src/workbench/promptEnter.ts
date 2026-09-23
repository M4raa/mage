import type { TextState } from './promptEditing';

// Que hace `Enter` en el prompt (2.7), como funcion PURA y fuera del componente.
//
// Vive aparte por una razon concreta: es el UNICO sitio de todo el plan donde equivocarse cuesta un
// TURNO REAL — si `Enter` envia cuando el usuario estaba escribiendo una lista, el mensaje se va a
// medias y gasta suscripcion. Por eso la decision no puede vivir dentro de un handler de teclado
// (donde no se puede testear) y por eso el harness NO la mide pulsando Enter: los 10 casos de aqui son
// su red de seguridad.
//
// Reglas (decision del usuario en 2.7):
//   - Item de lista CON contenido -> continua la lista.
//   - Item de lista VACIO         -> envia (y `continueListOnNewline` ya sabe borrar el marcador).
//   - Cualquier otra linea        -> envia.
//   - DENTRO de una valla de codigo -> no es una lista aunque lo parezca: se inserta salto de linea.

export type EnterAction = 'send' | 'continue-list' | 'newline';

// Marcador de lista al principio de la linea (viñeta o numerada), con su sangria. Mismo patron que
// `promptEditing.continueListOnNewline`, que es quien aplica el cambio.
const LIST_ITEM = /^(\s*)(?:([-*+])|(\d+)([.)]))\s+(.*)$/;
const FENCE = /^\s*```/;

export function enterAction(state: TextState): EnterAction {
  // Una seleccion que abarca texto no es "escribir en una linea": enviar es lo esperado (y es lo que
  // hacia el textarea de siempre).
  if (state.selectionStart !== state.selectionEnd) return 'send';
  const lines = state.value.split('\n');
  const cursorLine = lineIndexAt(state.value, state.selectionStart);
  // Dentro de una valla de codigo, `Enter` es un salto de linea y nunca un envio: una lista dentro de
  // ``` no es una lista, y enviar ahi manda el mensaje a medias.
  if (isInsideFence(lines, cursorLine)) return 'newline';
  const match = LIST_ITEM.exec(lines[cursorLine] ?? '');
  if (match === null) return 'send';
  const content = match[5] ?? '';
  return content.trim().length === 0 ? 'send' : 'continue-list';
}

// Indice (0-based) de la linea donde cae `offset`.
function lineIndexAt(value: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < value.length; i += 1) {
    if (value[i] === '\n') line += 1;
  }
  return line;
}

// ¿Esta la linea `index` dentro de una valla ABIERTA? Se cuenta cuantas vallas hay por encima: impar =
// dentro. Tolerante con la valla sin cerrar, igual que el parser del chat.
function isInsideFence(lines: readonly string[], index: number): boolean {
  let fences = 0;
  for (let i = 0; i < index; i += 1) {
    if (FENCE.test(lines[i] ?? '')) fences += 1;
  }
  return fences % 2 === 1;
}
