import { z } from 'zod';

// Esquemas de entrada de las sesiones (F2.6, H3 de la devolución 14). Los comparten el IPC del renderer y el
// host local: toda entrada se valida AQUÍ, antes de llegar al coordinador. Antes `SessionAnswerPermission` y
// el resto hacían un cast sin validar y `decision.updatedInput` llegaba tal cual al CLI.

// Un id de sesión, petición, envío o mensaje: no vacío y acotado (un id de 10 MB no es un id).
export const MAX_ID_CHARS = 256;
// Texto de un mensaje: muy por encima de cualquier prompt real, pero acotado.
export const MAX_MESSAGE_CHARS = 8_000_000;
export const MAX_DENY_MESSAGE_CHARS = 20_000;
export const MAX_MODE_CHARS = 128;

const id = z.string().min(1).max(MAX_ID_CHARS);
const label = z.string().min(1).max(MAX_MODE_CHARS);

export const SESSION_ID_SCHEMA = id;

export const PERMISSION_DECISION_SCHEMA = z.discriminatedUnion('behavior', [
  z.object({ behavior: z.literal('allow'), updatedInput: z.record(z.string(), z.unknown()).optional() }).strict(),
  z.object({ behavior: z.literal('deny'), message: z.string().max(MAX_DENY_MESSAGE_CHARS) }).strict(),
]);

const ATTACHMENT_SCHEMA = z.object({
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z.string(),
}).strict();

export const SEND_MESSAGE_SCHEMA = z.object({
  sessionId: id,
  text: z.string().max(MAX_MESSAGE_CHARS),
  attachments: z.array(ATTACHMENT_SCHEMA).optional(),
  commandId: id.optional(),
}).strict();

export const ANSWER_PERMISSION_SCHEMA = z.object({ sessionId: id, requestId: id, decision: PERMISSION_DECISION_SCHEMA }).strict();
export const QUEUED_MESSAGE_SCHEMA = z.object({ sessionId: id, messageId: id }).strict();
export const SET_PERMISSION_MODE_SCHEMA = z.object({ sessionId: id, mode: label }).strict();
export const SET_MODEL_SCHEMA = z.object({ sessionId: id, model: label }).strict();
// El esfuerzo vacío es «el del modelo por defecto»: único campo de modo que admite cadena vacía.
export const SET_EFFORT_SCHEMA = z.object({ sessionId: id, effort: z.string().max(MAX_MODE_CHARS) }).strict();
export const STOP_TASK_SCHEMA = z.object({ sessionId: id, taskId: id }).strict();

// Valida `value` con `schema` o lanza un Error que nombra el canal y qué campo falla (con el tipo recibido que
// aporta zod). Nunca incluye el valor recibido entero: puede ser un mensaje del usuario o un `updatedInput`.
export function parseSessionInput<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`).join('; ');
  throw new Error(`Entrada inválida en ${what}: ${issues}`);
}
