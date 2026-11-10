// Consumo por días y cuentas para «Cuentas y consumo» (P-038 V11). Cruza IPC: solo agregados, ningún texto.

// Día LOCAL del usuario, `YYYY-MM-DD`.
export type DayKey = string;

export interface DayTokens {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  readonly turns: number; // respuestas del modelo (mensajes `assistant` distintos)
}

export interface DailyTokens extends DayTokens {
  readonly day: DayKey;
}

// Lo más alto que se vio ese día de cada ventana de la suscripción (0..100), o null si no se miró.
export interface DailyWindows {
  readonly day: DayKey;
  readonly fiveHourMax: number | null;
  readonly sevenDayMax: number | null;
}

// --- Detalle por día (P-039) -----------------------------------------------------------------------------------------

// Tokens de UN modelo (clave de precio de `modelPricing`: modelo, tramo y modo rápido) en un día.
export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWrite5mTokens: number;
  readonly cacheWrite1hTokens: number;
  readonly turns: number;
}

// Veces que la cuenta chocó con su límite: la ventana de 5 h, la semanal u otro (p. ej. el de un modelo).
export interface LimitHits {
  readonly fiveHour: number;
  readonly weekly: number;
  readonly other: number;
}

export const HOURS_PER_DAY = 24;

// Lo más alto que se vio ese día de cada ventana (0..100), o null sin dato.
export interface DayPeaks {
  readonly fiveHourMax: number | null;
  readonly sevenDayMax: number | null;
}

export interface DayDetail {
  readonly byModel: Readonly<Record<string, ModelUsage>>;
  readonly limits: LimitHits;
  readonly hours: readonly number[]; // turnos por hora LOCAL (24 posiciones)
  readonly tools: Readonly<Record<string, number>>; // llamadas por herramienta
  // Picos de las ventanas que el propio registro trae (Codex los apunta en cada `token_count`; Claude no).
  readonly peaks?: DayPeaks;
}

const maxOrNull = (a: number | null, b: number | null): number | null => (a === null ? b : b === null ? a : Math.max(a, b));

export function maxPeaks(a: DayPeaks | undefined, b: DayPeaks | undefined): DayPeaks | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return { fiveHourMax: maxOrNull(a.fiveHourMax, b.fiveHourMax), sevenDayMax: maxOrNull(a.sevenDayMax, b.sevenDayMax) };
}

export interface DailyDetail extends DayDetail {
  readonly day: DayKey;
  readonly sessions: readonly string[]; // conversaciones con actividad ese día (ids): el periodo cuenta las distintas
  readonly projects: Readonly<Record<string, number>>; // carpeta -> tokens ese día
}

export const EMPTY_MODEL_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, turns: 0 };
export const NO_LIMITS: LimitHits = { fiveHour: 0, weekly: 0, other: 0 };
export const EMPTY_DETAIL: DayDetail = { byModel: {}, limits: NO_LIMITS, hours: new Array<number>(HOURS_PER_DAY).fill(0), tools: {} };

export function addModelUsage(a: ModelUsage, b: ModelUsage): ModelUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWrite5mTokens: a.cacheWrite5mTokens + b.cacheWrite5mTokens,
    cacheWrite1hTokens: a.cacheWrite1hTokens + b.cacheWrite1hTokens,
    turns: a.turns + b.turns,
  };
}

export function modelUsageTokens(usage: ModelUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
}

function addCounts(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = (out[key] ?? 0) + value;
  return out;
}

export function addDetails(a: DayDetail, b: DayDetail): DayDetail {
  const byModel: Record<string, ModelUsage> = { ...a.byModel };
  for (const [key, usage] of Object.entries(b.byModel)) byModel[key] = addModelUsage(byModel[key] ?? EMPTY_MODEL_USAGE, usage);
  return {
    byModel,
    limits: { fiveHour: a.limits.fiveHour + b.limits.fiveHour, weekly: a.limits.weekly + b.limits.weekly, other: a.limits.other + b.limits.other },
    hours: a.hours.map((count, hour) => count + (b.hours[hour] ?? 0)),
    tools: addCounts(a.tools, b.tools),
    ...withPeaks(maxPeaks(a.peaks, b.peaks)),
  };
}

const withPeaks = (peaks: DayPeaks | undefined): { readonly peaks?: DayPeaks } => (peaks === undefined ? {} : { peaks });

// Los totales de siempre (`DayTokens`) a partir del detalle: la escritura de caché junta 5 min y 1 h.
export function detailTokens(detail: DayDetail): DayTokens {
  const sum = Object.values(detail.byModel).reduce(addModelUsage, EMPTY_MODEL_USAGE);
  return { inputTokens: sum.inputTokens, outputTokens: sum.outputTokens, cacheReadTokens: sum.cacheReadTokens, cacheCreationTokens: sum.cacheWrite5mTokens + sum.cacheWrite1hTokens, turns: sum.turns };
}

export interface AccountUsageHistory {
  readonly accountId: string;
  readonly days: readonly DailyTokens[]; // ordenados por día, solo los que tienen consumo
  readonly detail: readonly DailyDetail[]; // mismo orden y mismos días que `days`
  readonly windows: readonly DailyWindows[];
}

export interface UsageHistory {
  readonly generatedAt: number; // epoch ms
  readonly fromDay: DayKey; // primer día que cubre (incluido)
  readonly accounts: readonly AccountUsageHistory[];
  // Conversaciones que el índice de Mage no sabe con qué cuenta se usaron (p. ej. las del CLI en la terminal).
  readonly unattributed: readonly DailyTokens[];
}

export const EMPTY_DAY: DayTokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 0 };

export function totalTokens(day: DayTokens): number {
  return day.inputTokens + day.outputTokens + day.cacheReadTokens + day.cacheCreationTokens;
}

export function addDays(a: DayTokens, b: DayTokens): DayTokens {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    turns: a.turns + b.turns,
  };
}
