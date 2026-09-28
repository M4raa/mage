import { buildAnswers, type AskQuestion } from '@shared/askUserQuestion';

// Recorrido de una pregunta del agente (AskUserQuestion) en el dock de encima del input (P-026 3.3,
// D14–D16). PURO: el componente solo pinta y traduce eventos. El CLI manda TODAS las preguntas en una
// sola peticion y hay que contestarlas juntas, asi que las respuestas se acumulan paso a paso.

// D14: «Omitir» contesta este texto fijo (la tool necesita una respuesta por pregunta).
export const SKIPPED_ANSWER = 'El usuario omitió esta pregunta';

export interface QuestionFlowState {
  readonly step: number;
  // Etiquetas elegidas POR PREGUNTA (con multiSelect, varias).
  readonly chosen: readonly (readonly string[])[];
  // Texto libre de «Otra cosa», por pregunta: cuenta como una etiqueta mas.
  readonly other: readonly string[];
  // Opcion resaltada con el teclado en el paso actual.
  readonly cursor: number;
}

export function initialFlow(questions: readonly AskQuestion[]): QuestionFlowState {
  return { step: 0, chosen: questions.map(() => []), other: questions.map(() => ''), cursor: 0 };
}

export function toggle(state: QuestionFlowState, question: AskQuestion, label: string): QuestionFlowState {
  const chosen = state.chosen.map((labels, i) => {
    if (i !== state.step) return labels;
    if (!question.multiSelect) return labels.includes(label) ? [] : [label];
    return labels.includes(label) ? labels.filter((l) => l !== label) : [...labels, label];
  });
  return { ...state, chosen };
}

export function setOther(state: QuestionFlowState, value: string): QuestionFlowState {
  return { ...state, other: state.other.map((v, i) => (i === state.step ? value : v)) };
}

// Para avanzar hay que haber elegido algo o escrito en «Otra cosa» (sola, vale).
export function canAdvance(state: QuestionFlowState): boolean {
  return (state.chosen[state.step] ?? []).length > 0 || (state.other[state.step] ?? '').trim().length > 0;
}

export function isLast(state: QuestionFlowState): boolean {
  return state.step >= state.chosen.length - 1;
}

// Bloqueado sin respuesta, y nunca pasa de la ultima (ahi se contesta).
export function next(state: QuestionFlowState): QuestionFlowState {
  if (!canAdvance(state) || isLast(state)) return state;
  return { ...state, step: state.step + 1, cursor: 0 };
}

export function prev(state: QuestionFlowState): QuestionFlowState {
  return state.step === 0 ? state : { ...state, step: state.step - 1, cursor: 0 };
}

// D14: la pregunta actual queda contestada con el texto fijo y se pasa a la siguiente.
export function skip(state: QuestionFlowState): QuestionFlowState {
  const answered: QuestionFlowState = {
    ...state,
    chosen: state.chosen.map((labels, i) => (i === state.step ? [SKIPPED_ANSWER] : labels)),
    other: state.other.map((v, i) => (i === state.step ? '' : v)),
  };
  return isLast(answered) ? answered : { ...answered, step: answered.step + 1, cursor: 0 };
}

export function toAnswers(state: QuestionFlowState, questions: readonly AskQuestion[]): Readonly<Record<string, string>> {
  const withOther = state.chosen.map((labels, i) => {
    const free = (state.other[i] ?? '').trim();
    return free.length === 0 ? labels : [...labels, free];
  });
  return buildAnswers(questions, withOther);
}

export type FlowKeyAction =
  | { readonly type: 'toggle'; readonly label: string }
  | { readonly type: 'cursor'; readonly index: number }
  | { readonly type: 'prev' }
  | { readonly type: 'next' }
  | { readonly type: 'submit' }
  | { readonly type: 'close' };

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
      return { type: 'cursor', index: Math.min(state.cursor + 1, options.length - 1) };
    case 'ArrowUp':
      return { type: 'cursor', index: Math.max(state.cursor - 1, 0) };
    case ' ': {
      const option = options[state.cursor];
      return option === undefined ? null : { type: 'toggle', label: option.label };
    }
    case 'ArrowLeft':
      return { type: 'prev' };
    case 'ArrowRight':
      return { type: 'next' };
    case 'Enter':
      return isLast(state) ? { type: 'submit' } : { type: 'next' };
    case 'Escape':
      return { type: 'close' };
    default:
      return null;
  }
}
