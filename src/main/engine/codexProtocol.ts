import { z } from 'zod';
import type { MageEvent, PermissionRequest, TurnUsage } from '@shared/events';
import type { ProviderModel } from '@shared/providers';
import type { UsageWindowInfo } from '@shared/usage';

// Traduccion PURA del protocolo de `codex app-server` (JSON-RPC 2.0, una linea por mensaje) al modelo de
// eventos de Mage. Esquemas PROPIOS y tolerantes (`.passthrough()`). Medidos con cuenta ChatGPT contra
// codex-cli 0.160.0: deltas, herramientas, permisos y uso (spike/codex-spike.mjs --verify --real;
// proyecciones anonimas de items reales en __fixtures__/codex/real-*-0160.json).

const ThreadItemSchema = z.object({ id: z.string(), type: z.string() }).passthrough();
type ThreadItem = z.infer<typeof ThreadItemSchema>;

const TokenBreakdownSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().catch(0),
    cachedInputTokens: z.number().int().nonnegative().catch(0),
    outputTokens: z.number().int().nonnegative().catch(0),
    reasoningOutputTokens: z.number().int().nonnegative().catch(0),
    totalTokens: z.number().int().nonnegative().catch(0),
  })
  .passthrough();

const RateWindowSchema = z
  .object({
    usedPercent: z.number(),
    windowDurationMins: z.number().int().nullable().optional(),
    resetsAt: z.number().int().nullable().optional(),
  })
  .passthrough();
const RateLimitsSchema = z
  .object({ primary: RateWindowSchema.nullable().optional(), secondary: RateWindowSchema.nullable().optional() })
  .passthrough();

const ModelSchema = z.object({ id: z.string().min(1), displayName: z.string().catch(''), hidden: z.boolean().catch(false) }).passthrough();
const ModelListSchema = z.object({ data: z.array(z.unknown()) }).passthrough();

const TurnSchema = z
  .object({ id: z.string(), status: z.string(), error: z.object({ message: z.string() }).passthrough().nullable().optional() })
  .passthrough();

// Duracion (en minutos) de las ventanas del plan que pinta el panel de Uso.
const FIVE_HOURS_MIN = 300;
const SEVEN_DAYS_MIN = 10_080;
const MS_PER_SECOND = 1_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// --- Notificaciones (servidor -> cliente, sin id) --------------------------------------------------

// Notificacion -> eventos. `usage` es el ultimo `thread/tokenUsage/updated` del turno (lo guarda el
// adapter); el `result` lo lleva cuando llega `turn/completed`.
export function normalizeNotification(method: string, params: unknown, usage: TurnUsage | null): MageEvent[] {
  if (!isRecord(params)) return [];
  switch (method) {
    case 'item/agentMessage/delta':
      return textEvent('stream_delta', params.delta);
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      return textEvent('thinking_delta', params.delta);
    case 'item/started':
      return itemStarted(ThreadItemSchema.parse(params.item));
    case 'item/completed':
      return itemCompleted(ThreadItemSchema.parse(params.item));
    case 'turn/completed':
      return turnCompleted(TurnSchema.parse(params.turn), usage);
    case 'error':
      return errorNotification(params);
    case 'account/rateLimits/updated':
      return rateLimitEvents(params.rateLimits);
    default:
      return [];
  }
}

function textEvent(kind: 'stream_delta' | 'thinking_delta', delta: unknown): MageEvent[] {
  return typeof delta === 'string' && delta.length > 0 ? [{ kind, text: delta }] : [];
}

// Nombres de herramienta con los que Mage pinta cada item. `commandExecution` es una orden de shell: se
// pinta como el Bash de Claude.
function itemStarted(item: ThreadItem): MageEvent[] {
  const tool = toolOf(item);
  return tool === null ? [] : [{ kind: 'tool_use', tool: { toolUseId: item.id, toolName: tool.name, input: tool.input } }];
}

function toolOf(item: ThreadItem): { readonly name: string; readonly input: Readonly<Record<string, unknown>> } | null {
  switch (item.type) {
    case 'commandExecution':
      return { name: 'Bash', input: { command: item.command, cwd: item.cwd } };
    case 'fileChange':
      return { name: 'apply_patch', input: { changes: item.changes } };
    case 'mcpToolCall':
      return { name: `mcp__${String(item.server)}__${String(item.tool)}`, input: isRecord(item.arguments) ? item.arguments : {} };
    case 'webSearch':
      return { name: 'WebSearch', input: { query: item.query } };
    default:
      return null;
  }
}

const FAILED_ITEM_STATUSES: readonly string[] = ['failed', 'declined'];

function itemCompleted(item: ThreadItem): MageEvent[] {
  if (item.type === 'agentMessage') return typeof item.text === 'string' ? [{ kind: 'assistant_text', text: item.text }] : [];
  if (toolOf(item) === null) return [];
  const status = typeof item.status === 'string' ? item.status : '';
  const exitFailed = typeof item.exitCode === 'number' && item.exitCode !== 0;
  const isError = FAILED_ITEM_STATUSES.includes(status) || exitFailed;
  return [{ kind: 'tool_result', result: { toolUseId: item.id, isError, output: itemOutput(item), durationMs: null } }];
}

function itemOutput(item: ThreadItem): string {
  if (typeof item.aggregatedOutput === 'string') return item.aggregatedOutput;
  // 0.160.0 entrega el resultado MCP en result.content, no en aggregatedOutput.
  if (item.type === 'mcpToolCall') return mcpOutput(item);
  if (item.type === 'fileChange' && Array.isArray(item.changes)) {
    return item.changes.map((change) => (isRecord(change) && typeof change.diff === 'string' ? change.diff : '')).join('\n');
  }
  return '';
}

function mcpOutput(item: ThreadItem): string {
  if (isRecord(item.error) && typeof item.error.message === 'string') return item.error.message;
  if (!isRecord(item.result) || !Array.isArray(item.result.content)) return '';
  return item.result.content.flatMap((block: unknown) =>
    isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
  ).join('\n');
}

function turnCompleted(turn: z.infer<typeof TurnSchema>, usage: TurnUsage | null): MageEvent[] {
  const isError = turn.status === 'failed';
  const events: MageEvent[] = [];
  if (isError) events.push({ kind: 'error', message: `codex termino el turno con error: ${turn.error?.message ?? turn.status}` });
  events.push({
    kind: 'result',
    result: { isError, subtype: turn.status, numTurns: null, ...(usage === null ? {} : { usage }) },
  });
  return events;
}

// `error` con `willRetry` es codex reintentando por su cuenta (medido sin cuenta: «Reconnecting... 2/5»):
// no se pinta. El definitivo, si.
function errorNotification(params: Record<string, unknown>): MageEvent[] {
  if (params.willRetry === true || !isRecord(params.error)) return [];
  const { message, additionalDetails } = params.error;
  const detail = typeof additionalDetails === 'string' && additionalDetails.length > 0 ? ` (${additionalDetails})` : '';
  return [{ kind: 'error', message: `codex: ${String(message)}${detail}` }];
}

// Uso del turno desde `thread/tokenUsage/updated` (`last` es el del turno, `total` el del hilo).
export function turnUsageOf(params: unknown): TurnUsage | null {
  if (!isRecord(params) || !isRecord(params.tokenUsage)) return null;
  const parsed = TokenBreakdownSchema.safeParse(params.tokenUsage.last);
  if (!parsed.success) return null;
  const last = parsed.data;
  return {
    inputTokens: last.inputTokens,
    outputTokens: last.outputTokens,
    totalTokens: last.totalTokens,
    thinkingTokens: last.reasoningOutputTokens,
    cacheReadTokens: last.cachedInputTokens,
  };
}

// --- Respuestas a peticiones de Mage -----------------------------------------------------------------

export function modelsEvent(result: unknown): MageEvent[] {
  const parsed = ModelListSchema.safeParse(result);
  if (!parsed.success) return [];
  const models: ProviderModel[] = parsed.data.data.flatMap((raw) => {
    const model = ModelSchema.safeParse(raw);
    if (!model.success || model.data.hidden) return [];
    return [{ id: model.data.id, label: model.data.displayName.length > 0 ? model.data.displayName : model.data.id }];
  });
  return models.length === 0 ? [] : [{ kind: 'models_available', models }];
}

// Ventanas del plan (`primary`/`secondary`) por su duracion: 5 h y 7 dias son las que pinta el panel.
// Una ventana que no llega es null («no se sabe»), que nunca pisa lo que ya se sabia.
export function rateLimitEvents(raw: unknown): MageEvent[] {
  const parsed = RateLimitsSchema.safeParse(isRecord(raw) && isRecord(raw.rateLimits) ? raw.rateLimits : raw);
  if (!parsed.success) return [];
  const windows = [parsed.data.primary, parsed.data.secondary].filter((w): w is z.infer<typeof RateWindowSchema> => w != null);
  const pick = (minutes: number): UsageWindowInfo | null => {
    const window = windows.find((candidate) => candidate.windowDurationMins === minutes);
    if (window === undefined) return null;
    const utilization = Math.min(100, Math.max(0, Math.round(window.usedPercent)));
    return { utilization, resetsAt: window.resetsAt == null ? null : window.resetsAt * MS_PER_SECOND };
  };
  const fiveHour = pick(FIVE_HOURS_MIN);
  const sevenDay = pick(SEVEN_DAYS_MIN);
  return fiveHour === null && sevenDay === null ? [] : [{ kind: 'usage_limits', fiveHour, sevenDay }];
}

// --- Peticiones del servidor (con id): aprobaciones ------------------------------------------------

export const APPROVAL_METHODS = {
  command: 'item/commandExecution/requestApproval',
  fileChange: 'item/fileChange/requestApproval',
  permissions: 'item/permissions/requestApproval',
} as const;

// Peticion de aprobacion -> tarjeta de permiso de Mage. null = un metodo que Mage no sabe contestar.
export function approvalRequest(requestId: string, method: string, params: unknown): PermissionRequest | null {
  if (!isRecord(params) || typeof params.itemId !== 'string') return null;
  const reason = typeof params.reason === 'string' ? params.reason : null;
  const base = { requestId, toolUseId: params.itemId, description: reason, requiresUserInteraction: false };
  switch (method) {
    case APPROVAL_METHODS.command:
      return { ...base, toolName: 'Bash', displayName: 'Ejecutar un comando', input: { command: params.command, cwd: params.cwd } };
    case APPROVAL_METHODS.fileChange:
      return { ...base, toolName: 'apply_patch', displayName: 'Modificar ficheros', input: {
        grantRoot: params.grantRoot, ...(Array.isArray(params.changes) ? { changes: params.changes } : {}),
      } };
    case APPROVAL_METHODS.permissions:
      return { ...base, toolName: 'permissions', displayName: 'Ampliar permisos', input: { permissions: params.permissions, cwd: params.cwd } };
    default:
      return null;
  }
}

// Respuesta a la aprobacion con la decision de Mage. `permissions` concede lo pedido (o nada), solo para
// este turno.
export function approvalResult(method: string, params: unknown, allow: boolean): unknown {
  if (method === APPROVAL_METHODS.permissions) {
    const requested = isRecord(params) && isRecord(params.permissions) ? params.permissions : {};
    return { permissions: allow ? requested : {}, scope: 'turn' };
  }
  return { decision: allow ? 'accept' : 'decline' };
}
