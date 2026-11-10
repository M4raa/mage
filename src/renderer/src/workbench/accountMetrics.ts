import { costMicroUsd, modelOfKey } from '@shared/modelPricing';
import {
  addDetails,
  addModelUsage,
  EMPTY_DETAIL,
  EMPTY_MODEL_USAGE,
  HOURS_PER_DAY,
  modelUsageTokens,
  NO_LIMITS,
  type AccountUsageHistory,
  type DailyDetail,
  type DailyWindows,
  type DayKey,
  type LimitHits,
  type ModelUsage,
} from '@shared/usageHistory';

// Métricas de «Cuentas y consumo» (P-039 F4). PURO: entra el detalle diario de una cuenta (o de varias juntas), sus
// ventanas y el periodo; sale lo que pinta la pantalla. El dinero va en micro-USD enteros; los cocientes (valor,
// aprovechamiento) son números para enseñar, no dinero.

const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;
const TOP_ROWS = 8;

export interface ModelRow {
  readonly model: string;
  readonly tokens: number;
  readonly turns: number;
  readonly costMicroUsd: number | null; // null: algún tramo de ese modelo no tiene precio
}

export interface Utilization {
  readonly avgPct: number | null; // media de los picos semanales; null si ninguna semana tiene dato
  readonly weeksWithData: number;
  readonly weeks: number;
}

export interface PlanValue {
  readonly planCostMicroUsd: number; // lo que se paga por el plan en el periodo (prorrateado)
  readonly ratio: number | null; // coste equivalente ÷ lo pagado; null con plan a 0
}

export interface AccountMetrics {
  readonly days: number;
  readonly activeDays: number;
  readonly tokens: number;
  readonly turns: number;
  readonly conversations: number;
  readonly costMicroUsd: number;
  readonly unpriced: boolean; // hubo consumo de algún modelo sin precio: el coste se queda corto
  readonly limits: LimitHits;
  readonly models: readonly ModelRow[];
  readonly utilization: Utilization;
  readonly value: PlanValue | null;
  readonly dailyCost: readonly { readonly day: DayKey; readonly costMicroUsd: number; readonly tokens: number }[];
  // Solo modo admin.
  readonly heatmap: readonly (readonly number[])[]; // [día de la semana 0=domingo][hora] -> turnos
  readonly streak: { readonly longest: number; readonly current: number };
  readonly tools: readonly (readonly [string, number])[];
  readonly projects: readonly (readonly [string, number])[];
  readonly windows: readonly DailyWindows[];
}

export interface MetricsInput {
  readonly detail: readonly DailyDetail[];
  readonly windows: readonly DailyWindows[];
  readonly period: readonly DayKey[]; // días del periodo, del más antiguo a hoy
  readonly planPriceMicroUsd: number | null; // precio MENSUAL del plan; null = no se calcula el valor
}

// Une el detalle de varias cuentas por día («Todas»): suma el uso y las conversaciones y los proyectos.
export function combineDetail(accounts: readonly AccountUsageHistory[]): readonly DailyDetail[] {
  const byDay = new Map<DayKey, DailyDetail>();
  for (const account of accounts) {
    for (const day of account.detail) {
      const current = byDay.get(day.day);
      if (current === undefined) {
        byDay.set(day.day, day);
        continue;
      }
      const projects: Record<string, number> = { ...current.projects };
      for (const [cwd, tokens] of Object.entries(day.projects)) projects[cwd] = (projects[cwd] ?? 0) + tokens;
      byDay.set(day.day, { ...addDetails(current, day), day: day.day, sessions: [...new Set([...current.sessions, ...day.sessions])], projects });
    }
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function dayCost(detail: DailyDetail): { readonly costMicroUsd: number; readonly unpriced: boolean; readonly tokens: number } {
  let cost = 0;
  let unpriced = false;
  let tokens = 0;
  for (const [key, usage] of Object.entries(detail.byModel)) {
    const used = modelUsageTokens(usage);
    tokens += used;
    const price = costMicroUsd(key, usage);
    if (price === null && used > 0) unpriced = true;
    cost += price ?? 0;
  }
  return { costMicroUsd: cost, unpriced, tokens };
}

function modelRows(detail: readonly DailyDetail[]): ModelRow[] {
  const byKey = new Map<string, ModelUsage>();
  for (const day of detail) for (const [key, usage] of Object.entries(day.byModel)) byKey.set(key, addModelUsage(byKey.get(key) ?? EMPTY_MODEL_USAGE, usage));
  const byModel = new Map<string, { tokens: number; turns: number; cost: number | null }>();
  for (const [key, usage] of byKey) {
    const model = modelOfKey(key);
    const row = byModel.get(model) ?? { tokens: 0, turns: 0, cost: 0 };
    const cost = costMicroUsd(key, usage);
    byModel.set(model, { tokens: row.tokens + modelUsageTokens(usage), turns: row.turns + usage.turns, cost: row.cost === null || cost === null ? null : row.cost + cost });
  }
  return [...byModel.entries()].map(([model, row]) => ({ model, tokens: row.tokens, turns: row.turns, costMicroUsd: row.cost })).sort((a, b) => b.tokens - a.tokens);
}

// Aprovechamiento (P-039 D1): el periodo en bloques de 7 días contados desde hoy hacia atrás; por bloque, el pico de la
// ventana semanal; la media de los bloques con dato.
export function utilizationOf(windows: readonly DailyWindows[], period: readonly DayKey[]): Utilization {
  const peakByDay = new Map(windows.map((window) => [window.day, window.sevenDayMax]));
  const peaks: number[] = [];
  let weeks = 0;
  for (let end = period.length; end > 0; end -= DAYS_PER_WEEK) {
    weeks += 1;
    const block = period.slice(Math.max(0, end - DAYS_PER_WEEK), end).map((day) => peakByDay.get(day) ?? null).filter((pct): pct is number => pct !== null);
    if (block.length > 0) peaks.push(Math.max(...block));
  }
  const avgPct = peaks.length === 0 ? null : Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length);
  return { avgPct, weeksWithData: peaks.length, weeks };
}

// Valor (P-039 D1): lo que costaría el consumo a precio de API frente a lo pagado por el plan en el periodo.
export function planValueOf(costMicroUsd: number, planPriceMicroUsd: number | null, days: number): PlanValue | null {
  if (planPriceMicroUsd === null) return null;
  if (!Number.isInteger(planPriceMicroUsd) || planPriceMicroUsd < 0) throw new Error(`Precio del plan no valido: ${planPriceMicroUsd}`);
  const planCostMicroUsd = Math.round((planPriceMicroUsd * days) / DAYS_PER_MONTH);
  return { planCostMicroUsd, ratio: planCostMicroUsd === 0 ? null : costMicroUsd / planCostMicroUsd };
}

function weekdayOf(day: DayKey): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

function heatmapOf(detail: readonly DailyDetail[]): number[][] {
  const map = Array.from({ length: DAYS_PER_WEEK }, () => new Array<number>(HOURS_PER_DAY).fill(0));
  for (const day of detail) {
    const row = map[weekdayOf(day.day)];
    if (row === undefined) continue;
    day.hours.forEach((turns, hour) => {
      row[hour] = (row[hour] ?? 0) + turns;
    });
  }
  return map;
}

function streakOf(period: readonly DayKey[], active: ReadonlySet<DayKey>): { readonly longest: number; readonly current: number } {
  let longest = 0;
  let run = 0;
  for (const day of period) {
    run = active.has(day) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  return { longest, current: run };
}

function topOf(counts: ReadonlyMap<string, number>): (readonly [string, number])[] {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_ROWS);
}

function countsOf(detail: readonly DailyDetail[], pick: (day: DailyDetail) => Readonly<Record<string, number>>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const day of detail) for (const [key, value] of Object.entries(pick(day))) counts.set(key, (counts.get(key) ?? 0) + value);
  return counts;
}

export function computeAccountMetrics(input: MetricsInput): AccountMetrics {
  const inPeriod = new Set(input.period);
  const detail = input.detail.filter((day) => inPeriod.has(day.day));
  const costs = detail.map((day) => ({ day: day.day, ...dayCost(day) }));
  const total = detail.reduce((sum, day) => addDetails(sum, day), EMPTY_DETAIL);
  const turns = Object.values(total.byModel).reduce((sum, usage) => sum + usage.turns, 0);
  const costMicroUsd = costs.reduce((sum, day) => sum + day.costMicroUsd, 0);
  const active = new Set(detail.filter((day) => Object.values(day.byModel).some((usage) => usage.turns > 0)).map((day) => day.day));
  return {
    days: input.period.length,
    activeDays: active.size,
    tokens: costs.reduce((sum, day) => sum + day.tokens, 0),
    turns,
    conversations: new Set(detail.flatMap((day) => day.sessions)).size,
    costMicroUsd,
    unpriced: costs.some((day) => day.unpriced),
    limits: detail.length === 0 ? NO_LIMITS : total.limits,
    models: modelRows(detail),
    utilization: utilizationOf(input.windows, input.period),
    value: planValueOf(costMicroUsd, input.planPriceMicroUsd, input.period.length),
    dailyCost: costs.map((day) => ({ day: day.day, costMicroUsd: day.costMicroUsd, tokens: day.tokens })),
    heatmap: heatmapOf(detail),
    streak: streakOf(input.period, active),
    tools: topOf(countsOf(detail, (day) => day.tools)),
    projects: topOf(countsOf(detail, (day) => day.projects)),
    windows: input.windows.filter((window) => inPeriod.has(window.day)),
  };
}
