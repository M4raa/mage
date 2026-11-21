import { EFFORT_LEVELS } from '@shared/ipc';
import { z } from 'zod';

// 2: `awaiting_launch` (la sesión espera a que el usuario la lance desde su tarjeta).
// 3: `mage_get_usage` (uso de 5 h y semanal por cuenta), `resumeOnReset` y `onDone` en `mage_create_session` y `mage_close_session`.
export const MAGE_MCP_CONTRACT_VERSION = 3;
export const DEFAULT_MAX_RESULT_BYTES = 65_536;
// Largo máximo del nombre de una sesión delegada (el `title` de mage_create_session y el que se deriva del prompt).
export const MAX_SESSION_TITLE_CHARS = 80;

// Solo estos campos tienen diagnóstico con valor; nunca objetos, prompts ni textos.
// En zod 4 el `error` del tipo no cubre sus checks (`.min`, `.int`…): cada check lo recibe también.
function diagnostic(field: string): { error: z.core.$ZodErrorMap } {
  return {
    error: (issue) => {
      const value = issue.input;
      const safe = value === undefined ? 'undefined' : String(value);
      const received = value === null || ['string', 'number', 'boolean'].includes(typeof value) ? safe : `<${typeof value}>`;
      return { message: `${field}: valor recibido ${received}` };
    },
  };
}
const id = (field: string) => z.string(diagnostic(field)).min(1, diagnostic(field));
const integer = (field: string) => z.number(diagnostic(field)).int(diagnostic(field)).nonnegative(diagnostic(field));
// Clave de idempotencia del llamante (V6: los modelos no siempre mandan un UUID): cualquier texto no vacío y acotado.
export const MAX_REQUEST_ID_CHARS = 128;
const requestId = z.string(diagnostic('requestId')).min(1, diagnostic('requestId')).max(MAX_REQUEST_ID_CHARS, diagnostic('requestId'));
const provider = z.enum(['claude', 'codex'], diagnostic('provider'));
const TEXT_REQUIRED = { error: () => ({ message: 'Se requiere texto' }) };
const text = z.string(TEXT_REQUIRED);
export const utcSchema = z.string().datetime({ offset: false });
export const stateSchema = z.enum(['awaiting_launch', 'working', 'waiting_answer', 'permission_pending', 'done', 'interrupted']);
export const createdBySchema = z.object({ conversationId: id('conversationId'), requestId: requestId, at: utcSchema }).strict();
export const publicMessageSchema = z.object({ seq: integer('seq'), role: id('role'), text }).strict();

export const listInputSchema = z.object({ projectId: id('projectId').optional(), includeFinished: z.boolean().optional() }).strict();
export const createInputSchema = z.object({
  requestId: requestId, provider, accountId: id('accountId').optional(), cwd: id('cwd'), prompt: text, model: id('model').optional(),
  effort: z.enum(EFFORT_LEVELS, diagnostic('effort')).optional(), permissionMode: id('permissionMode').optional(),
  title: z.string(diagnostic('title')).trim().min(1, diagnostic('title')).max(MAX_SESSION_TITLE_CHARS, diagnostic('title')).optional(),
  resumeOnReset: z.boolean(diagnostic('resumeOnReset')).optional(),
  onDone: z.enum(['close', 'keepAlive'], diagnostic('onDone')).optional(),
}).strict();
export const closeInputSchema = z.object({ requestId: requestId, conversationId: id('conversationId') }).strict();
export const closeOutputSchema = z.object({ closed: z.boolean() }).strict();
export const statusInputSchema = z.object({ conversationId: id('conversationId') }).strict();
export const readInputSchema = z.object({
  conversationId: id('conversationId'), afterSeq: integer('afterSeq').optional(),
  maxBytes: z.number(diagnostic('maxBytes')).int(diagnostic('maxBytes')).min(1, diagnostic('maxBytes')).max(DEFAULT_MAX_RESULT_BYTES, diagnostic('maxBytes')).optional(),
}).strict();
export const sendInputSchema = z.object({
  requestId: requestId, conversationId: id('conversationId'), text,
  mode: z.enum(['direct', 'queue'], diagnostic('mode')),
}).strict();
export const cancelInputSchema = z.object({
  conversationId: id('conversationId'), scope: z.literal('turn', diagnostic('scope')),
}).strict();
export const askCreatorInputSchema = z.object({ requestId: requestId, text: text.min(1, TEXT_REQUIRED) }).strict();
export const listOutputSchema =z.object({ sessions: z.array(z.object({
  conversationId: id('conversationId'), title: text, provider: id('provider'), state: stateSchema, createdBy: id('createdBy').optional(),
}).strict()) }).strict();
export const createOutputSchema = z.object({ conversationId: id('conversationId'), state: z.enum(['queued', 'running', 'awaiting_launch']) }).strict();
export const statusOutputSchema = z.object({ state: stateSchema, turnCount: integer('turnCount'), lastEventAt: utcSchema }).strict();
export const readOutputSchema = z.object({
  messages: z.array(publicMessageSchema), nextSeq: integer('nextSeq'), truncated: z.boolean(),
}).strict();
export const sendOutputSchema = z.object({ receipt: z.enum(['accepted', 'queued', 'rejected']), reason: text.optional() }).strict();
export const cancelOutputSchema = z.object({ cancelled: z.boolean() }).strict();
export const askCreatorOutputSchema = z.object({ receipt: z.literal('accepted') }).strict();
export const usageInputSchema = z.object({ accountId: id('accountId').optional() }).strict();
export const usageWindowSchema = z.object({ percent: z.number().int().min(0).max(100), resetsAt: utcSchema.nullable() }).strict();
export const usageAccountSchema = z.object({
  accountId: id('accountId'), provider: id('provider'), name: text, billing: z.enum(['subscription', 'api-key']),
  fiveHour: usageWindowSchema.nullable(), weekly: usageWindowSchema.nullable(), error: text.optional(),
}).strict();
export const usageOutputSchema = z.object({ accounts: z.array(usageAccountSchema) }).strict();

export const creationTargetSchema = z.object({ projectId: id('projectId'), accountId: id('accountId'), provider, cwd: id('cwd') }).strict();
