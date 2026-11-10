import { addDetails, EMPTY_DETAIL, HOURS_PER_DAY, type DayDetail, type DayKey, type DayPeaks, type ModelUsage } from '@shared/usageHistory';
import { pricingKey } from '@shared/modelPricing';
import type { LocalTime, ParsedChunk, ParseState } from './usageHistory';

// Consumo de Codex a partir de sus registros (`<CODEX_HOME>/sessions/AAAA/MM/DD/rollout-*.jsonl`, P-039 F2). PURO.
//
// MEDIDO en los registros del usuario (codex-cli 0.16x, 14 registros, 453 respuestas):
//   - `token_usage_record` trae el uso de UNA respuesta (`payload.usage`) con su `response_id`, sin repetir. La entrada
//     INCLUYE la parte en caché (`cached_input_tokens`) y la salida incluye el razonamiento. No hay escritura de caché.
//   - `turn_context` trae el modelo (`payload.model`); `session_meta`, la carpeta (`payload.cwd`).
//   - `event_msg` `token_count` trae `rate_limits`: `primary` (ventana de 300 min = 5 h) y `secondary` (10080 min =
//     semanal) con su `used_percent`, y `rate_limit_reached_type` (no nulo mientras está en el tope).
//   - Las herramientas son `response_item` `function_call` / `custom_tool_call` con su `name`.

const RECENT_IDS = 32;
const FIVE_HOURS_MINUTES = 300;
const WEEK_MINUTES = 10_080;

export interface CodexParseState extends ParseState {
  readonly model?: string;
  readonly atLimit?: boolean; // el último `token_count` decía que estaba en el tope (un tope cuenta una vez)
}

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined);

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function pct(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

// Uso de una respuesta: la entrada sin la parte en caché, que va a su precio.
function usageOf(usage: Json): ModelUsage {
  const input = count(usage['input_tokens']);
  const cached = Math.min(count(usage['cached_input_tokens']), input);
  return { inputTokens: input - cached, outputTokens: count(usage['output_tokens']), cacheReadTokens: cached, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, turns: 1 };
}

// Picos de las ventanas de un `rate_limits`, reconociendo cada una por su duración y no por su posición.
function peaksOf(limits: Json): DayPeaks {
  const peaks = { fiveHourMax: null as number | null, sevenDayMax: null as number | null };
  for (const slot of ['primary', 'secondary']) {
    const window = asRecord(limits[slot]);
    if (window === undefined) continue;
    if (window['window_minutes'] === FIVE_HOURS_MINUTES) peaks.fiveHourMax = pct(window['used_percent']);
    if (window['window_minutes'] === WEEK_MINUTES) peaks.sevenDayMax = pct(window['used_percent']);
  }
  return peaks;
}

const emptyDay = (): DayDetail => ({ ...EMPTY_DETAIL, hours: new Array<number>(HOURS_PER_DAY).fill(0) });

interface Step {
  readonly detail: DayDetail | null;
  readonly state: CodexParseState;
}

function onUsageRecord(payload: Json, state: CodexParseState, hour: number): Step {
  const id = payload['response_id'];
  const usage = asRecord(payload['usage']);
  if (typeof id !== 'string' || usage === undefined || state.recentIds.includes(id)) return { detail: null, state };
  const tokens = usageOf(usage);
  const key = pricingKey(state.model ?? 'codex', count(usage['input_tokens']), false);
  const hours = new Array<number>(HOURS_PER_DAY).fill(0);
  hours[hour] = 1;
  const recentIds = [...state.recentIds, id].slice(-RECENT_IDS);
  return { detail: { ...emptyDay(), byModel: { [key]: tokens }, hours }, state: { ...state, recentIds } };
}

function onTokenCount(payload: Json, state: CodexParseState): Step {
  const limits = asRecord(payload['rate_limits']);
  if (limits === undefined) return { detail: null, state };
  const atLimit = limits['rate_limit_reached_type'] !== null && limits['rate_limit_reached_type'] !== undefined;
  const fresh = atLimit && state.atLimit !== true;
  const reached = String(limits['rate_limit_reached_type'] ?? '');
  const kind = /week|second/i.test(reached) ? 'weekly' : 'fiveHour';
  const limitsHit = { fiveHour: 0, weekly: 0, other: 0, ...(fresh ? { [kind]: 1 } : {}) };
  return { detail: { ...emptyDay(), limits: limitsHit, peaks: peaksOf(limits) }, state: { ...state, atLimit } };
}

// Lo que aporta una línea: su detalle para el día (o nada) y el estado siguiente.
function stepOf(entry: Json, state: CodexParseState, hour: number): Step {
  const payload = asRecord(entry['payload']) ?? {};
  const type = entry['type'];
  if (type === 'session_meta') return { detail: null, state: typeof payload['cwd'] === 'string' && state.cwd === undefined ? { ...state, cwd: payload['cwd'] } : state };
  if (type === 'turn_context') return { detail: null, state: typeof payload['model'] === 'string' ? { ...state, model: payload['model'] } : state };
  if (type === 'token_usage_record') return onUsageRecord(payload, state, hour);
  if (type === 'event_msg' && payload['type'] === 'token_count') return onTokenCount(payload, state);
  const isTool = type === 'response_item' && (payload['type'] === 'function_call' || payload['type'] === 'custom_tool_call');
  if (isTool && typeof payload['name'] === 'string') return { detail: { ...emptyDay(), tools: { [payload['name']]: 1 } }, state };
  return { detail: null, state };
}

export function parseCodexLines(lines: readonly string[], initial: CodexParseState, timeOf: (ms: number) => LocalTime): ParsedChunk & { readonly state: CodexParseState } {
  const days: Record<DayKey, DayDetail> = {};
  let state = initial;
  let invalidLines = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    let entry: Json | undefined;
    try {
      entry = asRecord(JSON.parse(line));
    } catch {
      invalidLines += 1;
      continue;
    }
    const atMs = typeof entry?.['timestamp'] === 'string' ? Date.parse(entry['timestamp']) : Number.NaN;
    if (entry === undefined || Number.isNaN(atMs)) continue;
    const { day, hour } = timeOf(atMs);
    const step = stepOf(entry, state, hour);
    state = step.state;
    if (step.detail !== null) days[day] = addDetails(days[day] ?? EMPTY_DETAIL, step.detail);
  }
  return { days, state, invalidLines };
}
