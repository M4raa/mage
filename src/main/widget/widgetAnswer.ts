import type { PendingRequest } from '@shared/coordination';
import type { PermissionDecision } from '@shared/events';
import { buildAnswers, buildUpdatedInput, parseAskUserQuestion } from '@shared/askUserQuestion';
import type { WidgetAnswer } from '@shared/widget';

export const WIDGET_DENY_MESSAGE = 'Denegado por el usuario'; // el mismo texto que la tarjeta del chat
export type WidgetAnswerDecision = { readonly kind: 'decision'; readonly decision: PermissionDecision } | { readonly kind: 'rejected' };

// Construye en main la decisión a partir de la petición que main TIENE; el widget solo elige.
// `rejected` = ya no está pendiente (contestada en otra vista o el turno acabó).
export function decideWidgetAnswer(pending: readonly PendingRequest[], answer: WidgetAnswer): WidgetAnswerDecision {
  const match = pending.find((p) => p.request.requestId === answer.requestId);
  if (match === undefined) return { kind: 'rejected' };
  if (match.kind === 'elicitation') throw new Error(`El widget no contesta elicitations: ${answer.requestId}`);
  const questions = parseAskUserQuestion(match.request.input);
  const { choice } = answer;
  if (choice.kind === 'deny') return { kind: 'decision', decision: { behavior: 'deny', message: WIDGET_DENY_MESSAGE } };
  if (choice.kind === 'allow') {
    if (questions !== null || match.request.requiresUserInteraction) {
      throw new Error(`Una pregunta no se permite sin respuesta: ${answer.requestId}`);
    }
    return { kind: 'decision', decision: { behavior: 'allow' } };
  }
  const [single] = questions ?? [];
  if (questions === null || questions.length !== 1 || single === undefined || single.multiSelect) {
    throw new Error(`La petición ${answer.requestId} no es una pregunta de opción única`);
  }
  if (!single.options.some((o) => o.label === choice.label)) {
    throw new Error(`Opción desconocida en ${answer.requestId}: ${JSON.stringify(choice.label)}`);
  }
  const updatedInput = buildUpdatedInput(match.request.input, buildAnswers(questions, [[choice.label]]));
  return { kind: 'decision', decision: { behavior: 'allow', updatedInput } };
}
