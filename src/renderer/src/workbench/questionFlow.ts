import { buildAnswers, type AskQuestion } from '@shared/askUserQuestion';

// Recorrido de una pregunta del agente (AskUserQuestion) en el dock de encima del input (P-026 3.3,
// D14–D16; rehecho en P-038 V5). PURO: el componente solo pinta y traduce eventos. El CLI manda TODAS las
// preguntas en una sola peticion y hay que contestarlas juntas, asi que las respuestas se acumulan paso a paso.
//
// P-038 V5: se puede ir a cualquier pregunta sin contestar las anteriores, y «Responder» va siempre: lo que
// quede sin contestar sale como omitido (la tool necesita una respuesta por pregunta).

// D14: «Omitir» contesta este texto fijo (la tool necesita una respuesta por pregunta).
export const SKIPPED_ANSWER = 'El usuario omitió esta pregunta';

// Cursor sin resaltar: hasta que el usuario usa las flechas no se marca ninguna opción (antes la primera
// llevaba borde y parecía elegida).
export const NO_CURSOR = -1;

export interface QuestionFlowState {
  readonly step: number;
  // Etiquetas elegidas POR PREGUNTA (con multiSelect, varias).
  readonly chosen: readonly (readonly string[])[];
  // Texto libre de «Otra cosa», por pregunta: cuenta como una etiqueta mas.
  readonly other: readonly string[];
  // Opcion resaltada con el teclado en el paso actual (`options.length` = «Otra cosa»; NO_CURSOR = ninguna).
  readonly cursor: number;
}

export function initialFlow(questions: readonly AskQuestion[]): QuestionFlowState {
  return { step: 0, chosen: questions.map(() => []), other: questions.map(() => ''), cursor: NO_CURSOR };
}

function atStep<T>(values: readonly T[], step: number, value: T): readonly T[] {
  return values.map((current, i) => (i === step ? value : current));
}

// En una pregunta de respuesta única, elegir una opción descarta el texto de «Otra cosa» (y al revés, ver
// `setOther`): son alternativas, no se suman.
export function toggle(state: QuestionFlowState, question: AskQuestion, label: string): QuestionFlowState {
  const labels = (state.chosen[state.step] ?? []).filter((l) => l !== SKIPPED_ANSWER);
  if (!question.multiSelect) {
    const chosen = labels.includes(label) ? [] : [label];
    return { ...state, chosen: atStep(state.chosen, state.step, chosen), other: atStep(state.other, state.step, '') };
  }
  const chosen = labels.includes(label) ? labels.filter((l) => l !== label) : [...labels, label];
  return { ...state, chosen: atStep(state.chosen, state.step, chosen) };
}

export function setOther(state: QuestionFlowState, question: AskQuestion, value: string): QuestionFlowState {
  const other = atStep(state.other, state.step, value);
  const labels = (state.chosen[state.step] ?? []).filter((l) => l !== SKIPPED_ANSWER);
  const keepChoices = question.multiSelect || value.trim().length === 0;
  return { ...state, other, chosen: atStep(state.chosen, state.step, keepChoices ? labels : []) };
}

// Contestada = con alguna opción, con texto en «Otra cosa» o omitida.
export function isAnswered(state: QuestionFlowState, step: number): boolean {
  return (state.chosen[step] ?? []).length > 0 || (state.other[step] ?? '').trim().length > 0;
}

export function isSkipped(state: QuestionFlowState, step: number): boolean {
  return (state.chosen[step] ?? []).includes(SKIPPED_ANSWER);
}

export function isLast(state: QuestionFlowState): boolean {
  return state.step >= state.chosen.length - 1;
}

// Ir a cualquier pregunta (los pasos de arriba). Fuera de rango, no se mueve.
export function goTo(state: QuestionFlowState, step: number): QuestionFlowState {
  if (!Number.isInteger(step) || step < 0 || step >= state.chosen.length || step === state.step) return state;
  return { ...state, step, cursor: NO_CURSOR };
}

export function next(state: QuestionFlowState): QuestionFlowState {
  return goTo(state, state.step + 1);
}

export function prev(state: QuestionFlowState): QuestionFlowState {
  return goTo(state, state.step - 1);
}

// D14: la pregunta actual queda contestada con el texto fijo y se pasa a la siguiente.
export function skip(state: QuestionFlowState): QuestionFlowState {
  const answered: QuestionFlowState = {
    ...state,
    chosen: atStep(state.chosen, state.step, [SKIPPED_ANSWER]),
    other: atStep(state.other, state.step, ''),
  };
  return isLast(answered) ? answered : next(answered);
}

// Lo no contestado sale como omitido (V5: «Responder» siempre activo).
export function toAnswers(state: QuestionFlowState, questions: readonly AskQuestion[]): Readonly<Record<string, string>> {
  const withOther = state.chosen.map((labels, i) => {
    const free = (state.other[i] ?? '').trim();
    const all = free.length === 0 ? labels : [...labels, free];
    return all.length === 0 ? [SKIPPED_ANSWER] : all;
  });
  return buildAnswers(questions, withOther);
}

export type FlowKeyAction =
  | { readonly type: 'toggle'; readonly label: string }
  | { readonly type: 'cursor'; readonly index: number }
  | { readonly type: 'prev' }
  | { readonly type: 'next' }
  | { readonly type: 'submit' }
  | { readonly type: 'close' }
  | { readonly type: 'focus-other' };

// Teclado del dock: `1..9` eligen, `↑/↓` mueven el resaltado, `Espacio` elige el resaltado, `←/→`
// paginan, `Enter` avanza (o contesta en la ultima) y `Esc` cierra. null = la tecla no es del dock.
export function keyToAction(key: string, state: QuestionFlowState, question: AskQuestion): FlowKeyAction | null {
  const options = question.options;
  if (/^[1-9]$/.test(key)) {
    const option = options[Number(key) - 1];
    return option === undefined ? null : { type: 'toggle', label: option.label };
  }
  switch (key) {
    case 'ArrowDown':
      return { type: 'cursor', index: Math.min(state.cursor + 1, options.length) };
    case 'ArrowUp':
      return { type: 'cursor', index: Math.max(state.cursor - 1, 0) };
    case ' ':
      return spaceAction(state, question);
    case 'ArrowLeft':
      return { type: 'prev' };
    case 'ArrowRight':
      return { type: 'next' };
    case 'Enter':
      if (state.cursor === options.length) return { type: 'focus-other' };
      return isLast(state) ? { type: 'submit' } : { type: 'next' };
    case 'Escape':
      return { type: 'close' };
    default:
      return null;
  }
}

// Sin resaltado, Espacio no hace nada; sobre «Otra cosa», va a su texto.
function spaceAction(state: QuestionFlowState, question: AskQuestion): FlowKeyAction | null {
  if (state.cursor === NO_CURSOR) return null;
  const option = question.options[state.cursor];
  return option === undefined ? { type: 'focus-other' } : { type: 'toggle', label: option.label };
}
