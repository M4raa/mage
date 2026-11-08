import { z } from 'zod';
import type { RewindApplyParams, DivergeParams, RewindPlanParams } from '@shared/ipc';
import { ATTACHMENT_SCHEMA, MAX_ID_CHARS, parseSessionInput } from '@shared/sessionInput';

// Esquemas de entrada de los tres canales del rewind (F4.4/F4.5). Frontera de verdad: todo `.strict()` y acotado.

const MAX_POINT_INDEX = 100_000;
const MAX_POINT_TEXT_CHARS = 200_000;

const id = z.string().min(1).max(MAX_ID_CHARS);

export const REWIND_POINT_SCHEMA = z.object({
  userIndex: z.number().int().min(0).max(MAX_POINT_INDEX),
  text: z.string().max(MAX_POINT_TEXT_CHARS),
  nativeId: id.nullable(),
}).strict();

const REWIND_PLAN_SCHEMA = z.object({ sessionId: id, point: REWIND_POINT_SCHEMA, action: z.enum(['rewind', 'retry', 'diverge']) }).strict();

const REWIND_APPLY_SCHEMA = z.object({
  sessionId: id,
  point: REWIND_POINT_SCHEMA,
  action: z.enum(['rewind', 'retry']),
  restoreFiles: z.boolean(),
  saveCopy: z.boolean(),
  attachments: z.array(ATTACHMENT_SCHEMA).optional(),
}).strict();

const DIVERGE_SCHEMA = z.object({ sessionId: id, point: REWIND_POINT_SCHEMA }).strict();

export function parseRewindPlan(value: unknown, channel: string): RewindPlanParams {
  return parseSessionInput(REWIND_PLAN_SCHEMA, value, channel);
}

export function parseRewindApply(value: unknown, channel: string): RewindApplyParams {
  return parseSessionInput(REWIND_APPLY_SCHEMA, value, channel);
}

export function parseDiverge(value: unknown, channel: string): DivergeParams {
  return parseSessionInput(DIVERGE_SCHEMA, value, channel);
}
