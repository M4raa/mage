import { addDays, EMPTY_DAY, type AccountUsageHistory, type DailyTokens, type DailyWindows, type DayKey, type DayTokens, type UsageHistory } from '@shared/usageHistory';

// Consumo por días a partir de las transcripciones de Claude (P-038 V11). PURO: el servicio lee el disco y guarda la
// caché; aquí solo se parsean líneas y se agregan números.
//
// MEDIDO sobre las transcripciones del usuario (2.1.319): cada respuesta del modelo es una línea `assistant` POR
// BLOQUE de contenido (pensamiento, texto, cada tool_use), todas con el MISMO `message.id` y el MISMO `usage`. Contar
// cada línea multiplicaría el consumo: se cuenta UNA vez por `message.id`.

const MS_PER_MINUTE = 60_000;
// Ids recientes que se recuerdan para deduplicar: las líneas de un mensaje van seguidas; con unos pocos basta.
const RECENT_IDS = 16;

// Día LOCAL (`YYYY-MM-DD`) de un instante, con el desfase del usuario en minutos (positivo al este de UTC).
export function localDayKey(ms: number, offsetMinutes: number): DayKey {
  if (!Number.isFinite(ms) || !Number.isFinite(offsetMinutes)) throw new Error(`Instante o desfase no validos: ${ms}, ${offsetMinutes}`);
  return new Date(ms + offsetMinutes * MS_PER_MINUTE).toISOString().slice(0, 10);
}

export interface ParseState {
  readonly recentIds: readonly string[];
}

export const INITIAL_PARSE_STATE: ParseState = { recentIds: [] };

export interface ParsedChunk {
  readonly days: Readonly<Record<DayKey, DayTokens>>;
  readonly state: ParseState;
  // Líneas candidatas (con `"usage"` y `"assistant"`) que no eran JSON: las cuenta y el servicio lo anota.
  readonly invalidLines: number;
}

const INVALID = Symbol('linea-invalida');

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

interface AssistantUsage {
  readonly id: string;
  readonly atMs: number;
  readonly tokens: DayTokens;
}

// Una línea `assistant` con `usage`; null si es cualquier otra cosa; INVALID si parecía serlo pero no es JSON (una
// línea a medio escribir o corrupta: no tumba el resto del fichero, se cuenta para el log).
function assistantUsageOf(line: string): AssistantUsage | null | typeof INVALID {
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return INVALID;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as { type?: unknown; timestamp?: unknown; message?: { id?: unknown; usage?: Record<string, unknown> } };
  const usage = entry.message?.usage;
  const atMs = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN;
  if (entry.type !== 'assistant' || typeof entry.message?.id !== 'string' || usage === undefined || Number.isNaN(atMs)) return null;
  return {
    id: entry.message.id,
    atMs,
    tokens: {
      inputTokens: count(usage.input_tokens),
      outputTokens: count(usage.output_tokens),
      cacheReadTokens: count(usage.cache_read_input_tokens),
      cacheCreationTokens: count(usage.cache_creation_input_tokens),
      turns: 1,
    },
  };
}

// Suma por día las líneas de un trozo de transcripción. `state` arrastra los últimos ids entre trozos (el fichero se
// lee por partes al crecer).
export function parseUsageLines(lines: readonly string[], state: ParseState, dayOf: (ms: number) => DayKey): ParsedChunk {
  const days: Record<DayKey, DayTokens> = {};
  const recent = [...state.recentIds];
  let invalidLines = 0;
  for (const line of lines) {
    const usage = assistantUsageOf(line);
    if (usage === INVALID) invalidLines += 1;
    if (usage === null || usage === INVALID || recent.includes(usage.id)) continue;
    recent.push(usage.id);
    if (recent.length > RECENT_IDS) recent.shift();
    const day = dayOf(usage.atMs);
    days[day] = addDays(days[day] ?? EMPTY_DAY, usage.tokens);
  }
  return { days, state: { recentIds: recent }, invalidLines };
}

export function mergeDayMaps(a: Readonly<Record<DayKey, DayTokens>>, b: Readonly<Record<DayKey, DayTokens>>): Record<DayKey, DayTokens> {
  const merged: Record<DayKey, DayTokens> = { ...a };
  for (const [day, tokens] of Object.entries(b)) merged[day] = addDays(merged[day] ?? EMPTY_DAY, tokens);
  return merged;
}

export interface FileUsage {
  readonly sessionId: string;
  // Dueña fija (un perfil privado es de su cuenta); undefined = la dice el índice por la conversación.
  readonly ownerAccountId?: string;
  readonly days: Readonly<Record<DayKey, DayTokens>>;
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

// Agrupa por cuenta (la dueña fija o la que dice el índice) y recorta a `fromDay`. Una cuenta que el índice nombra
// pero ya no existe cuenta como sin atribuir.
export function aggregateHistory(input: HistoryInput): UsageHistory {
  const known = new Set(input.accountIds);
  const byAccount = new Map<string, Record<DayKey, DayTokens>>();
  for (const file of input.files) {
    const owner = file.ownerAccountId ?? input.accountOf(file.sessionId);
    const key = owner !== undefined && known.has(owner) ? owner : UNATTRIBUTED;
    byAccount.set(key, mergeDayMaps(byAccount.get(key) ?? {}, file.days));
  }
  const toList = (days: Readonly<Record<DayKey, DayTokens>> | undefined): DailyTokens[] =>
    Object.entries(days ?? {}).filter(([day]) => day >= input.fromDay).sort(([a], [b]) => a.localeCompare(b)).map(([day, tokens]) => ({ day, ...tokens }));
  const accounts: AccountUsageHistory[] = input.accountIds.map((accountId) => ({
    accountId,
    days: toList(byAccount.get(accountId)),
    windows: windowList(input.windows[accountId], input.fromDay),
  }));
  return { generatedAt: input.generatedAt, fromDay: input.fromDay, accounts, unattributed: toList(byAccount.get(UNATTRIBUTED)) };
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
