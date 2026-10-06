import { z } from 'zod';

export const RPC_MESSAGE = z.object({ id: z.union([z.string(), z.number().int()]).optional(), method: z.string().optional(),
  result: z.unknown().optional(), error: z.object({ code: z.number().int(), message: z.string().optional() }).nullable().optional(),
  params: z.record(z.unknown()).optional() }).passthrough().refine((value) => value.id !== undefined || value.method !== undefined);
export const THREAD_MARKER = z.object({ threadId: z.string().min(1) }).strict();
export const RESPONSES_BODY = z.object({ reasoning: z.object({ effort: z.string().optional() }).optional(), input: z.unknown().optional(), instructions: z.string().optional() }).passthrough();
export const ACCOUNT_RESULT = z.object({ account: z.object({ type: z.string() }).nullable() });
export const MODELS_RESULT = z.object({ data: z.array(z.object({ id: z.string(), model: z.string(), hidden: z.boolean().optional(),
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })).optional() })) });
export const PROFILES_RESULT = z.object({ data: z.array(z.object({ id: z.string(), allowed: z.boolean() })) });
export const APPS_RESULT = z.object({ data: z.array(z.object({ isAccessible: z.boolean(), isEnabled: z.boolean() })), nextCursor: z.string().nullish() });
const WINDOW = z.object({ usedPercent: z.number().optional(), windowDurationMins: z.number().optional(), resetsAt: z.number().optional() }).nullable().optional();
export const RATE_RESULT = z.object({ rateLimits: z.object({ primary: WINDOW, secondary: WINDOW }) });
export const THREAD_RESULT = z.object({ thread: z.object({ id: z.string().min(1) }).passthrough() }).passthrough();
export const THREAD_READ = z.object({ thread: z.object({ turns: z.array(z.object({ items: z.array(z.object({ type: z.string() }).passthrough()) })) }) });

export function validatedResult(reply, schema, category) {
  const parsed = schema.safeParse(reply.result);
  if (!parsed.success) throw new Error(`${category}: resultado con forma inesperada`);
  return parsed.data;
}

export function parseExternalJson(text, schema, category) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error(`${category}: JSON inválido (longitud ${text.length})`); }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${category}: forma inesperada (longitud ${text.length})`);
  return parsed.data;
}

export function jsonLines({ schema, receive, fail }) {
  let buffer = '';
  let stopped = false;
  return (chunk) => {
    if (stopped) return;
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try { receive(parseExternalJson(line, schema, 'NDJSON')); } catch {
        stopped = true;
        fail(new Error(`NDJSON inválido (longitud ${line.length})`));
        return;
      }
    }
  };
}
