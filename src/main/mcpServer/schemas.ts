import { z } from 'zod';

export const MAGE_MCP_CONTRACT_VERSION = 1;
export const DEFAULT_MAX_RESULT_BYTES = 65_536;

// Solo estos campos tienen diagnóstico con valor; nunca objetos, prompts ni textos.
function diagnostic(field: string): z.ZodErrorMap {
  return (_issue, context) => {
    const value = context.data;
    const safe = value === undefined ? 'undefined' : String(value);
    const received = value === null || ['string', 'number', 'boolean'].includes(typeof value) ? safe : `<${typeof value}>`;
    return { message: `${field}: valor recibido ${received}` };
  };
}
const id = (field: string) => z.string({ errorMap: diagnostic(field) }).min(1);
const integer = (field: string) => z.number({ errorMap: diagnostic(field) }).int().nonnegative();
const uuid = z.string({ errorMap: diagnostic('requestId') }).uuid();
const provider = z.enum(['claude', 'codex'], { errorMap: diagnostic('provider') });
const text = z.string({ errorMap: () => ({ message: 'Se requiere texto' }) });
export const utcSchema = z.string().datetime({ offset: false });
export const stateSchema = z.enum(['working', 'waiting_answer', 'permission_pending', 'done', 'interrupted']);
export const createdBySchema = z.object({ conversationId: id('conversationId'), requestId: uuid, at: utcSchema }).strict();
export const publicMessageSchema = z.object({ seq: integer('seq'), role: id('role'), text }).strict();

export const listInputSchema = z.object({ projectId: id('projectId').optional(), includeFinished: z.boolean().optional() }).strict();
export const createInputSchema = z.object({
  requestId: uuid, provider, accountId: id('accountId').optional(), cwd: id('cwd'), prompt: text, model: id('model').optional(),
}).strict();
export const statusInputSchema = z.object({ conversationId: id('conversationId') }).strict();
export const readInputSchema = z.object({
  conversationId: id('conversationId'), afterSeq: integer('afterSeq').optional(),
  maxBytes: z.number({ errorMap: diagnostic('maxBytes') }).int().min(1).max(DEFAULT_MAX_RESULT_BYTES).optional(),
}).strict();
export const sendInputSchema = z.object({
  requestId: uuid, conversationId: id('conversationId'), text,
  mode: z.enum(['direct', 'queue'], { errorMap: diagnostic('mode') }),
}).strict();
export const cancelInputSchema = z.object({
  conversationId: id('conversationId'), scope: z.literal('turn', { errorMap: diagnostic('scope') }),
}).strict();
export const askCreatorInputSchema = z.object({ requestId: uuid, text: text.min(1) }).strict();
export const listOutputSchema =z.object({ sessions: z.array(z.object({
  conversationId: id('conversationId'), title: text, provider: id('provider'), state: stateSchema, createdBy: id('createdBy').optional(),
}).strict()) }).strict();
export const createOutputSchema = z.object({ conversationId: id('conversationId'), state: z.enum(['queued', 'running']) }).strict();
export const statusOutputSchema = z.object({ state: stateSchema, turnCount: integer('turnCount'), lastEventAt: utcSchema }).strict();
export const readOutputSchema = z.object({
  messages: z.array(publicMessageSchema), nextSeq: integer('nextSeq'), truncated: z.boolean(),
}).strict();
export const sendOutputSchema = z.object({ receipt: z.enum(['accepted', 'queued', 'rejected']), reason: text.optional() }).strict();
export const cancelOutputSchema = z.object({ cancelled: z.boolean() }).strict();
export const askCreatorOutputSchema = z.object({ receipt: z.literal('accepted') }).strict();

export const creationTargetSchema = z.object({ projectId: id('projectId'), accountId: id('accountId'), provider, cwd: id('cwd') }).strict();
