import { z } from 'zod';
import type { ContextUsage, MageEvent, PermissionDecision, PermissionRequest, PermissionScope, TurnUsage } from '@shared/events';
import { codexItemOutput, codexItemTool, isFailedCodexItem } from '@shared/codexTranscript';
import { localized } from '@shared/i18n/localizedText';
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
  const tool = codexItemTool(item);
  return tool === null ? [] : [{ kind: 'tool_use', tool: { toolUseId: item.id, toolName: tool.name, input: tool.input } }];
}

function itemCompleted(item: ThreadItem): MageEvent[] {
  if (item.type === 'agentMessage') return typeof item.text === 'string' ? [{ kind: 'assistant_text', text: item.text }] : [];
  if (codexItemTool(item) === null) return [];
  const isError = isFailedCodexItem(item);
  return [{ kind: 'tool_result', result: { toolUseId: item.id, isError, output: liveItemOutput(item), durationMs: null } }];
}

// El texto en castellano se queda (decisión F-0293 de 0.1.3): lo lee el modelo, como el de agy.
const MCP_FAILED_TEXT = 'La llamada MCP de Codex falló.';

function liveItemOutput(item: ThreadItem): string {
  if (item.type === 'mcpToolCall' && item.error !== undefined && item.error !== null) return MCP_FAILED_TEXT;
  return codexItemOutput(item);
}

function turnCompleted(turn: z.infer<typeof TurnSchema>, usage: TurnUsage | null): MageEvent[] {
  const isError = turn.status === 'failed';
  const events: MageEvent[] = [];
  if (isError) events.push({ kind: 'error', localized: localized('events.codex.turnFailed', { detail: turn.error?.message ?? turn.status }) });
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
  return [{ kind: 'error', localized: localized('events.codex.error', { detail: `${String(message)}${detail}` }) }];
}

// Uso de tokens de Codex (F2.1). `thread/tokenUsage/updated` trae `last` (la ULTIMA llamada al modelo) y
// `total` (acumulado del HILO). El uso del TURNO —el que lleva su `result` y suma el panel de Uso— es lo
// que crece `total` durante el turno, actualizacion a actualizacion: una notificacion repetida suma 0, y
// en el primer dato del proceso (un hilo reanudado arrastra en `total` todo lo anterior) cuenta `last`.
// Antes se tomaba `last` como uso del turno: un turno con herramientas solo contaba su ultima llamada.
type TokenBreakdown = Pick<z.infer<typeof TokenBreakdownSchema>, 'inputTokens' | 'cachedInputTokens' | 'outputTokens' | 'reasoningOutputTokens' | 'totalTokens'>;

export interface CodexUsageTracker {
  readonly threadTotal: TokenBreakdown | null; // ultimo `total` visto en este proceso
  readonly turn: TurnUsage | null; // acumulado del turno en curso
}

export const EMPTY_USAGE_TRACKER: CodexUsageTracker = { threadTotal: null, turn: null };

export function trackTokenUsage(tracker: CodexUsageTracker, params: unknown): CodexUsageTracker {
  if (!isRecord(params) || !isRecord(params.tokenUsage)) return tracker;
  const last = TokenBreakdownSchema.safeParse(params.tokenUsage.last);
  if (!last.success) return tracker;
  const total = TokenBreakdownSchema.safeParse(params.tokenUsage.total);
  // Sin `total` utilizable (ausente o a cero) no hay con que restar: cuenta la llamada.
  if (!total.success || total.data.totalTokens === 0) return { ...tracker, turn: addUsage(tracker.turn, last.data) };
  return { threadTotal: total.data, turn: addUsage(tracker.turn, growth(tracker.threadTotal, total.data, last.data)) };
}

// Lo que crecio el hilo desde el dato anterior. Sin anterior, o si algun contador retrocede (es un
// acumulado: no deberia), la ultima llamada.
function growth(previous: TokenBreakdown | null, total: TokenBreakdown, last: TokenBreakdown): TokenBreakdown {
  if (previous === null) return last;
  const delta: TokenBreakdown = {
    inputTokens: total.inputTokens - previous.inputTokens,
    cachedInputTokens: total.cachedInputTokens - previous.cachedInputTokens,
    outputTokens: total.outputTokens - previous.outputTokens,
    reasoningOutputTokens: total.reasoningOutputTokens - previous.reasoningOutputTokens,
    totalTokens: total.totalTokens - previous.totalTokens,
  };
  return Object.values(delta).some((value) => value < 0) ? last : delta;
}

function addUsage(turn: TurnUsage | null, add: TokenBreakdown): TurnUsage {
  const sum = (current: number | null | undefined, extra: number): number => (current ?? 0) + extra;
  return {
    inputTokens: sum(turn?.inputTokens, add.inputTokens),
    outputTokens: sum(turn?.outputTokens, add.outputTokens),
    totalTokens: sum(turn?.totalTokens, add.totalTokens),
    thinkingTokens: sum(turn?.thinkingTokens, add.reasoningOutputTokens),
    cacheReadTokens: sum(turn?.cacheReadTokens, add.cachedInputTokens),
  };
}

// Ocupacion de la ventana desde el mismo `thread/tokenUsage/updated`: `last` es la ultima llamada al modelo (su
// entrada + salida es lo que ocupa ahora el contexto) y `modelContextWindow` el tamaño de la ventana, que Codex
// da con la cuenta y el modelo. Sin desglose por categorias (Codex no lo ofrece). null si falta alguno de los dos.
export function contextUsageOf(params: unknown): ContextUsage | null {
  if (!isRecord(params) || !isRecord(params.tokenUsage)) return null;
  const window = params.tokenUsage.modelContextWindow;
  const last = TokenBreakdownSchema.safeParse(params.tokenUsage.last);
  if (!last.success || typeof window !== 'number' || !Number.isInteger(window) || window <= 0) return null;
  const used = last.data.totalTokens;
  return { totalTokens: used, maxTokens: window, percentage: Math.min(100, (used / window) * 100), categories: [] };
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
  const windows = [parsed.data.primary, parsed.data.secondary].filter((w): w is z.infer<typeof RateWindowSchema> => w !== null && w !== undefined);
  const pick = (minutes: number): UsageWindowInfo | null => {
    const window = windows.find((candidate) => candidate.windowDurationMins === minutes);
    if (window === undefined) return null;
    const utilization = Math.min(100, Math.max(0, Math.round(window.usedPercent)));
    return { utilization, resetsAt: window.resetsAt === null || window.resetsAt === undefined ? null : window.resetsAt * MS_PER_SECOND };
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

// Los tres métodos admiten «esta sesión»; «siempre» solo existe como enmienda de execpolicy (otro sistema) y no se ofrece.
const SESSION_ONLY: readonly PermissionScope[] = ['session'];

// Peticion de aprobacion -> tarjeta de permiso de Mage. null = un metodo que Mage no sabe contestar.
export function approvalRequest(requestId: string, method: string, params: unknown): PermissionRequest | null {
  if (!isRecord(params) || typeof params.itemId !== 'string') return null;
  const reason = typeof params.reason === 'string' ? params.reason : null;
  const base = { requestId, toolUseId: params.itemId, description: reason, requiresUserInteraction: false, allowScopes: SESSION_ONLY };
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

// Respuesta a la aprobación con la decisión de Mage (MEDIDO con el esquema de codex-cli 0.164.0: comandos y ficheros
// admiten `acceptForSession`; los permisos, `scope: 'session'`). «Siempre» no existe aquí: solo «esta vez» y «esta sesión».
export function approvalResult(method: string, params: unknown, decision: PermissionDecision): unknown {
  const allow = decision.behavior === 'allow';
  const session = allow && decision.scope === 'session';
  if (allow && decision.scope === 'always') throw new Error(`Codex no admite «permitir siempre» (${method})`);
  if (method === APPROVAL_METHODS.permissions) {
    const requested = isRecord(params) && isRecord(params.permissions) ? params.permissions : {};
    return { permissions: allow ? requested : {}, scope: session ? 'session' : 'turn' };
  }
  if (session) return { decision: 'acceptForSession' };
  return { decision: allow ? 'accept' : 'decline' };
}
