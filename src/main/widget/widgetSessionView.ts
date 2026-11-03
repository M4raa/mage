import type { ConversationSnapshot, PendingRequest } from '@shared/coordination';
import { parseAskUserQuestion } from '@shared/askUserQuestion';
import type { WidgetOutcome, WidgetRequestView, WidgetSessionView } from '@shared/widget';

export const WIDGET_DETAIL_MAX_CHARS = 160;
// Campos del input que resumen un permiso, por orden de preferencia.
const DETAIL_INPUT_KEYS = ['command', 'file_path', 'path', 'url', 'pattern'] as const;

// Recorta a WIDGET_DETAIL_MAX_CHARS (con «…» al final) para que el widget no pinte un comando entero.
export function truncateDetail(text: string): string {
  if (text.length <= WIDGET_DETAIL_MAX_CHARS) return text;
  return `${text.slice(0, WIDGET_DETAIL_MAX_CHARS - 1)}…`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

// Resumen de un permiso: su descripción o, si no hay, el primer campo conocido del input; null si ninguno.
function detailOf(description: string | null, input: Readonly<Record<string, unknown>>): string | null {
  if (isNonEmptyString(description)) return truncateDetail(description);
  for (const key of DETAIL_INPUT_KEYS) {
    const value = input[key];
    if (isNonEmptyString(value)) return truncateDetail(value);
  }
  return null;
}

// Una petición pendiente como la pinta el widget: solo permisos y preguntas de opción única se contestan ahí.
export function toWidgetRequest(pending: PendingRequest): WidgetRequestView {
  if (pending.kind === 'elicitation') {
    return { kind: 'in_app', requestId: pending.request.requestId, tool: pending.request.server };
  }
  const request = pending.request;
  const tool = request.displayName ?? request.toolName;
  const questions = parseAskUserQuestion(request.input);
  const [single] = questions ?? [];
  if (questions !== null && questions.length === 1 && single !== undefined && !single.multiSelect) {
    return { kind: 'question', requestId: request.requestId, question: single.question, options: single.options.map((o) => o.label) };
  }
  if (questions !== null || request.requiresUserInteraction) {
    return { kind: 'in_app', requestId: request.requestId, tool };
  }
  return { kind: 'permission', requestId: request.requestId, tool, detail: detailOf(request.description, request.input) };
}

// Los hechos de una sesión para el widget; no salen la cola, la referencia nativa ni el id de conversación.
export function toWidgetSessionView(snapshot: ConversationSnapshot, outcome: WidgetOutcome): WidgetSessionView {
  const { sessionId, provider, state, background } = snapshot;
  return { sessionId, provider, state, outcome, background, requests: snapshot.pending.map(toWidgetRequest) };
}
