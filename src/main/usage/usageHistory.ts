import {
  addDetails,
  detailTokens,
  EMPTY_DETAIL,

  HOURS_PER_DAY,
  modelUsageTokens,
  type AccountUsageHistory,
  type DailyDetail,
  type DailyTokens,
  type DailyWindows,
  type DayDetail,
  type DayKey,
  type LimitHits,
  type ModelUsage,
  type UsageHistory,
} from '@shared/usageHistory';
import { pricingKey } from '@shared/modelPricing';

// Consumo por días a partir de las transcripciones de Claude (P-038 V11; detalle de P-039). PURO: el servicio lee el
// disco y guarda la caché; aquí solo se parsean líneas y se agregan números.
//
// MEDIDO sobre las transcripciones del usuario (2.1.319): cada respuesta del modelo es una línea `assistant` POR
// BLOQUE de contenido (pensamiento, texto, cada tool_use), todas con el MISMO `message.id` y el MISMO `usage`. Contar
// cada línea multiplicaría el consumo: el uso se cuenta UNA vez por `message.id`; las herramientas, una por bloque.
// Los topes (P-039 M2) son líneas `assistant` con `isApiErrorMessage` y `error: "rate_limit"`, de modelo `<synthetic>`
// y uso a cero: cuentan como tope, no como turno.

const MS_PER_MINUTE = 60_000;
// Ids recientes que se recuerdan para deduplicar: las líneas de un mensaje van seguidas; con unos pocos basta.
const RECENT_IDS = 16;
const SYNTHETIC_MODEL = '<synthetic>';
const RATE_LIMIT_ERROR = 'rate_limit';
// Textos de tope MEDIDOS (P-039 M2): «You've hit your session limit» / «your 5-hour limit» y «your weekly limit».
const FIVE_HOUR_LIMIT = /session limit|\d+-hour limit/i;
const WEEKLY_LIMIT = /weekly limit/i;

// Instante LOCAL del usuario: día (`YYYY-MM-DD`) y hora (0..23), con su desfase en minutos (positivo al este de UTC).
export interface LocalTime {
  readonly day: DayKey;
  readonly hour: number;
}

export function localTimeOf(ms: number, offsetMinutes: number): LocalTime {
  if (!Number.isFinite(ms) || !Number.isFinite(offsetMinutes)) throw new Error(`Instante o desfase no validos: ${ms}, ${offsetMinutes}`);
  const iso = new Date(ms + offsetMinutes * MS_PER_MINUTE).toISOString();
  return { day: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) };
}

export function localDayKey(ms: number, offsetMinutes: number): DayKey {
  return localTimeOf(ms, offsetMinutes).day;
}

export interface ParseState {
  readonly recentIds: readonly string[];
  readonly cwd?: string; // carpeta de la conversación (la primera que se ve)
}

export const INITIAL_PARSE_STATE: ParseState = { recentIds: [] };

export interface ParsedChunk {
  readonly days: Readonly<Record<DayKey, DayDetail>>;
  readonly state: ParseState;
  // Líneas candidatas (`assistant`) que no eran JSON: las cuenta y el servicio lo anota.
  readonly invalidLines: number;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined);

// Lo que aporta una línea `assistant`: su uso (si lo trae), sus herramientas y si es un tope.
interface AssistantLine {
  readonly atMs: number;
  readonly cwd?: string;
  readonly usage?: { readonly id: string; readonly key: string; readonly tokens: ModelUsage };
  readonly tools: readonly string[];
  readonly limit?: keyof LimitHits;
}

function usageOf(message: Json): { readonly id: string; readonly key: string; readonly tokens: ModelUsage } | undefined {
  const usage = asRecord(message['usage']);
  const id = message['id'];
  const model = message['model'];
  if (usage === undefined || typeof id !== 'string' || typeof model !== 'string' || model === SYNTHETIC_MODEL) return undefined;
  const breakdown = asRecord(usage['cache_creation']);
  const written = count(usage['cache_creation_input_tokens']);
  // Sin desglose (transcripciones antiguas), toda la escritura cuenta a 5 min, el precio más bajo de los dos.
  const write1h = breakdown === undefined ? 0 : count(breakdown['ephemeral_1h_input_tokens']);
  const write5m = breakdown === undefined ? written : count(breakdown['ephemeral_5m_input_tokens']);
  const tokens: ModelUsage = {
    inputTokens: count(usage['input_tokens']),
    outputTokens: count(usage['output_tokens']),
    cacheReadTokens: count(usage['cache_read_input_tokens']),
    cacheWrite5mTokens: write5m,
    cacheWrite1hTokens: write1h,
    turns: 1,
  };
  const prompt = tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWrite5mTokens + tokens.cacheWrite1hTokens;
  return { id, key: pricingKey(model, prompt, usage['speed'] === 'fast'), tokens };
}

function toolsOf(message: Json): string[] {
  const content = message['content'];
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const item = asRecord(block);
    return item?.['type'] === 'tool_use' && typeof item['name'] === 'string' ? [item['name']] : [];
  });
}

function limitOf(entry: Json, message: Json): keyof LimitHits | undefined {
  if (entry['isApiErrorMessage'] !== true || entry['error'] !== RATE_LIMIT_ERROR) return undefined;
  const text = JSON.stringify(message['content'] ?? '');
  if (FIVE_HOUR_LIMIT.test(text)) return 'fiveHour';
  return WEEKLY_LIMIT.test(text) ? 'weekly' : 'other';
}

// Una línea `assistant`; null si es cualquier otra cosa; 'invalid' si parecía serlo pero no es JSON (una línea a medio
// escribir o corrupta: no tumba el resto del fichero, se cuenta para el log).
function assistantLineOf(line: string): AssistantLine | null | 'invalid' {
  if (!line.includes('"assistant"')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return 'invalid';
  }
  const entry = asRecord(raw);
  const message = asRecord(entry?.['message']);
  const atMs = typeof entry?.['timestamp'] === 'string' ? Date.parse(entry['timestamp']) : Number.NaN;
  if (entry === undefined || message === undefined || entry['type'] !== 'assistant' || Number.isNaN(atMs)) return null;
  const usage = usageOf(message);
  const limit = limitOf(entry, message);
  return {
    atMs,
    ...(typeof entry['cwd'] === 'string' ? { cwd: entry['cwd'] } : {}),
    ...(usage === undefined ? {} : { usage }),
    tools: toolsOf(message),
    ...(limit === undefined ? {} : { limit }),
  };
}

// Lo que una línea suma a su día (ya deduplicada).
function lineDetail(line: AssistantLine, hour: number, countUsage: boolean): DayDetail {
  const tools: Record<string, number> = {};
  for (const name of line.tools) tools[name] = (tools[name] ?? 0) + 1;
  const hours = new Array<number>(HOURS_PER_DAY).fill(0);
  if (countUsage) hours[hour] = 1;
  const limits = { fiveHour: 0, weekly: 0, other: 0, ...(line.limit === undefined ? {} : { [line.limit]: 1 }) };
  const byModel = countUsage && line.usage !== undefined ? { [line.usage.key]: line.usage.tokens } : {};
  return { byModel, limits, hours, tools };
}

// Suma por día las líneas de un trozo de transcripción. `state` arrastra los últimos ids y la carpeta entre trozos (el
// fichero se lee por partes al crecer).
export function parseUsageLines(lines: readonly string[], state: ParseState, timeOf: (ms: number) => LocalTime): ParsedChunk {
  const days: Record<DayKey, DayDetail> = {};
  const recent = [...state.recentIds];
  let cwd = state.cwd;
  let invalidLines = 0;
  for (const line of lines) {
    const parsed = assistantLineOf(line);
    if (parsed === 'invalid') invalidLines += 1;
    if (parsed === null || parsed === 'invalid') continue;
    cwd ??= parsed.cwd;
    const fresh = parsed.usage !== undefined && !recent.includes(parsed.usage.id);
    if (fresh && parsed.usage !== undefined) {
      recent.push(parsed.usage.id);
      if (recent.length > RECENT_IDS) recent.shift();
    }
    if (!fresh && parsed.tools.length === 0 && parsed.limit === undefined) continue;
    const { day, hour } = timeOf(parsed.atMs);
    days[day] = addDetails(days[day] ?? EMPTY_DETAIL, lineDetail(parsed, hour, fresh));
  }
  return { days, state: { recentIds: recent, ...(cwd === undefined ? {} : { cwd }) }, invalidLines };
}

export function mergeDayMaps(a: Readonly<Record<DayKey, DayDetail>>, b: Readonly<Record<DayKey, DayDetail>>): Record<DayKey, DayDetail> {
  const merged: Record<DayKey, DayDetail> = { ...a };
  for (const [day, detail] of Object.entries(b)) merged[day] = addDetails(merged[day] ?? EMPTY_DETAIL, detail);
  return merged;
}

export interface FileUsage {
  readonly sessionId: string;
  // Dueña fija (un perfil privado es de su cuenta); undefined = la dice el índice por la conversación.
  readonly ownerAccountId?: string;
  readonly cwd?: string;
  readonly days: Readonly<Record<DayKey, DayDetail>>;
}

export interface HistoryInput {
  readonly files: readonly FileUsage[];
  readonly accountIds: readonly string[];
  readonly accountOf: (sessionId: string) => string | undefined;
  readonly windows: Readonly<Record<string, Readonly<Record<DayKey, WindowPeaks>>>>;
  readonly fromDay: DayKey;
  readonly generatedAt: number;
}

const UNATTRIBUTED = '\u0000sin-cuenta';

// Lo acumulado de una cuenta en un día: el detalle sumado, las conversaciones activas y los tokens por carpeta.
interface DayAccumulator {
  detail: DayDetail;
  readonly sessions: Set<string>;
  readonly projects: Record<string, number>;
}

function accumulate(byAccount: Map<string, Map<DayKey, DayAccumulator>>, key: string, file: FileUsage, fromDay: DayKey): void {
  const days = byAccount.get(key) ?? new Map<DayKey, DayAccumulator>();
  byAccount.set(key, days);
  for (const [day, detail] of Object.entries(file.days)) {
    if (day < fromDay) continue;
    const slot = days.get(day) ?? { detail: EMPTY_DETAIL, sessions: new Set<string>(), projects: {} };
    days.set(day, slot);
    slot.detail = addDetails(slot.detail, detail);
    const tokens = Object.values(detail.byModel).reduce((sum, usage) => sum + modelUsageTokens(usage), 0);
    if (tokens > 0) slot.sessions.add(file.sessionId);
    if (tokens > 0 && file.cwd !== undefined) slot.projects[file.cwd] = (slot.projects[file.cwd] ?? 0) + tokens;
  }
}

function dailyDetails(days: Map<DayKey, DayAccumulator> | undefined): DailyDetail[] {
  return [...(days ?? new Map<DayKey, DayAccumulator>()).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, slot]) => ({ day, ...slot.detail, conversations: slot.sessions.size, projects: slot.projects }));
}

const toTokens = (detail: readonly DailyDetail[]): DailyTokens[] => detail.map((day) => ({ day: day.day, ...detailTokens(day) }));

// Agrupa por cuenta (la dueña fija o la que dice el índice) y recorta a `fromDay`. Una cuenta que el índice nombra
// pero ya no existe cuenta como sin atribuir.
export function aggregateHistory(input: HistoryInput): UsageHistory {
  const known = new Set(input.accountIds);
  const byAccount = new Map<string, Map<DayKey, DayAccumulator>>();
  for (const file of input.files) {
    const owner = file.ownerAccountId ?? input.accountOf(file.sessionId);
    accumulate(byAccount, owner !== undefined && known.has(owner) ? owner : UNATTRIBUTED, file, input.fromDay);
  }
  const accounts: AccountUsageHistory[] = input.accountIds.map((accountId) => {
    const detail = dailyDetails(byAccount.get(accountId));
    return { accountId, days: toTokens(detail), detail, windows: windowList(input.windows[accountId], input.fromDay) };
  });
  return { generatedAt: input.generatedAt, fromDay: input.fromDay, accounts, unattributed: toTokens(dailyDetails(byAccount.get(UNATTRIBUTED))) };
}


// --- Foto diaria de las ventanas de la suscripción (desde la 0.1.5) ------------------------------------------------

export interface WindowPeaks {
  readonly fiveHourMax: number | null;
  readonly sevenDayMax: number | null;
}

const maxOrNull = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

function validPct(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

// Guarda lo más alto visto HOY de cada ventana. Una lectura sin dato (null) no borra lo que ya había.
export function recordWindowPeak(
  previous: Readonly<Record<DayKey, WindowPeaks>> | undefined,
  day: DayKey,
  reading: WindowPeaks,
): Record<DayKey, WindowPeaks> {
  const current = previous?.[day] ?? { fiveHourMax: null, sevenDayMax: null };
  const next = { fiveHourMax: maxOrNull(current.fiveHourMax, validPct(reading.fiveHourMax)), sevenDayMax: maxOrNull(current.sevenDayMax, validPct(reading.sevenDayMax)) };
  return { ...(previous ?? {}), [day]: next };
}

// Fuera lo anterior a `fromDay` (la foto no crece sin límite).
export function pruneWindowPeaks(peaks: Readonly<Record<DayKey, WindowPeaks>>, fromDay: DayKey): Record<DayKey, WindowPeaks> {
  return Object.fromEntries(Object.entries(peaks).filter(([day]) => day >= fromDay));
}

function windowList(peaks: Readonly<Record<DayKey, WindowPeaks>> | undefined, fromDay: DayKey): readonly DailyWindows[] {
  return Object.entries(peaks ?? {}).filter(([day]) => day >= fromDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, peak]) => ({ day, ...peak }));
}
