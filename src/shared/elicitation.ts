import { z } from 'zod';

const primitive = z.union([z.string(), z.number().finite(), z.boolean()]);
export const ELICITATION_ANSWER_SCHEMA = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().min(1),
  action: z.enum(['accept', 'decline', 'cancel']),
  content: z.record(z.string(), primitive).optional(),
}).strict();
export type ElicitationAnswer = z.infer<typeof ELICITATION_ANSWER_SCHEMA>;

const STRING_FIELD = z.object({ type: z.literal('string'), title: z.string().optional(), description: z.string().optional(),
  minLength: z.number().int().nonnegative().optional(), maxLength: z.number().int().nonnegative().optional(),
  format: z.enum(['password', 'email', 'uri', 'date', 'date-time']).optional(),
  enum: z.array(z.string()).min(1).optional(), default: z.string().optional() }).strict();
const NUMBER_FIELD = z.object({ type: z.enum(['number', 'integer']), title: z.string().optional(), description: z.string().optional(),
  minimum: z.number().finite().optional(), maximum: z.number().finite().optional(), default: z.number().finite().optional() }).strict();
const BOOLEAN_FIELD = z.object({ type: z.literal('boolean'), title: z.string().optional(), description: z.string().optional(), default: z.boolean().optional() }).strict();
export const ELICITATION_FIELD_SCHEMA = z.union([STRING_FIELD, NUMBER_FIELD, BOOLEAN_FIELD]);
export const ELICITATION_FORM_SCHEMA = z.object({ type: z.literal('object'),
  properties: z.record(z.string().min(1), ELICITATION_FIELD_SCHEMA), required: z.array(z.string()).optional() }).strict();
export type ElicitationFormSchema = z.infer<typeof ELICITATION_FORM_SCHEMA>;

export type ElicitationRequest = {
  readonly requestId: string;
  readonly server: string;
  readonly message: string;
} & ({ readonly mode: 'form'; readonly schema: ElicitationFormSchema } |
  { readonly mode: 'url'; readonly url: string; readonly elicitationId: string });

// El subconjunto que Mage sabe mostrar: objeto plano de primitivos, sin estructuras anidadas ni
// `additionalProperties`. Una extensión que no encaja se cancela, nunca se interpreta a medias.
export function parseElicitationRequest(requestId: string, server: string, raw: unknown): ElicitationRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.message !== 'string' || value.message.trim().length === 0 || value.message.length > 4000) return null;
  if (value.mode === 'url') {
    if (typeof value.url !== 'string' || typeof value.elicitationId !== 'string' || value.elicitationId.length === 0) return null;
    try { if (new URL(value.url).protocol !== 'https:') return null; } catch { return null; }
    return { requestId, server, message: value.message, mode: 'url', url: value.url, elicitationId: value.elicitationId };
  }
  if (value.mode !== undefined && value.mode !== 'form') return null;
  const parsed = ELICITATION_FORM_SCHEMA.safeParse(value.requestedSchema);
  if (!parsed.success || Object.keys(parsed.data.properties).length > 20) return null;
  const required = parsed.data.required ?? [];
  if (required.some((name) => !(name in parsed.data.properties))) return null;
  return { requestId, server, message: value.message, mode: 'form', schema: parsed.data };
}

export function validateElicitationAnswer(request: ElicitationRequest, answer: ElicitationAnswer): boolean {
  if (answer.action !== 'accept') return answer.content === undefined;
  if (request.mode === 'url') return answer.content === undefined;
  const content = answer.content ?? {};
  if (Object.keys(content).some((name) => !(name in request.schema.properties))) return false;
  for (const name of request.schema.required ?? []) if (!(name in content)) return false;
  for (const [name, value] of Object.entries(content)) {
    const field = request.schema.properties[name];
    if (field === undefined) return false;
    if (field.type === 'boolean') { if (typeof value !== 'boolean') return false; continue; }
    if (field.type !== 'string') {
      if (typeof value !== 'number' || !Number.isFinite(value) || (field.type === 'integer' && !Number.isInteger(value)) ||
        (field.minimum !== undefined && value < field.minimum) || (field.maximum !== undefined && value > field.maximum)) return false;
      continue;
    }
    if (typeof value !== 'string' || (field.minLength !== undefined && value.length < field.minLength) ||
      (field.maxLength !== undefined && value.length > field.maxLength) || (field.enum !== undefined && !field.enum.includes(value))) return false;
  }
  return true;
}
