import { costMicroUsd, modelOfKey } from '@shared/modelPricing';
import type { UsageWindowInfo } from '@shared/usage';
import { addModelUsage, EMPTY_MODEL_USAGE, modelUsageTokens, type AccountUsageHistory, type DailyDetail, type DayKey, type ModelUsage } from '@shared/usageHistory';
import { planValueOf } from './accountMetrics';
import { severityForPct, type UsageSeverity } from './usageView';

// Gráficos de «Cuentas y consumo» (DEVOLUCION-095). PURO: da forma al historial que manda main (días LOCALES
// `YYYY-MM-DD`) y a las ventanas de uso. Un DayKey es una fecha de calendario: la aritmética y el formato van en UTC
// sobre esa fecha, así que un cambio de hora nunca repite ni salta una columna. Tokens y micro-USD, enteros.

export type ChartMeasure = 'cost' | 'tokens';
export type SeriesBy = 'model' | 'account';
export const MAX_SERIES = 3; // con color; el resto va a «Otros» (las tres fichas validadas con todos los pares)
export const OTHER_SERIES = '__other__';
export const TOP_RANKED = 8;
const PERCENT = 100;
const MIN_BAR_PX = 2;
const DECADE = 10;
const NICE_STEPS = [1, 2, 5, DECADE] as const;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface SeriesPoint {
  readonly day: DayKey;
  readonly id: string; // modelo o cuenta
  readonly value: number; // en la medida elegida
  readonly tokens: number; // siempre tokens: ordena las series
}

export interface SeriesDay {
  readonly day: DayKey;
  readonly values: readonly number[]; // una posición por serie
  readonly total: number;
}

export interface StackedDaily {
  readonly series: readonly string[];
  readonly days: readonly SeriesDay[];
  readonly max: number;
}

// Valor de un modelo en un día. Sin precio, el coste cuenta 0 (la pantalla ya avisa con `unpriced`).
function measureOf(key: string, usage: ModelUsage, measure: ChartMeasure): number {
  if (measure === 'tokens') return modelUsageTokens(usage);
  return costMicroUsd(key, usage) ?? 0;
}

// Un punto por día y modelo; el tramo largo y el modo rápido van con su modelo.
export function modelPoints(detail: readonly DailyDetail[], measure: ChartMeasure): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  for (const day of detail) {
    for (const [key, usage] of Object.entries(day.byModel)) points.push({ day: day.day, id: modelOfKey(key), value: measureOf(key, usage, measure), tokens: modelUsageTokens(usage) });
  }
  return points;
}

export function accountPoints(accounts: readonly AccountUsageHistory[], measure: ChartMeasure): SeriesPoint[] {
  return accounts.flatMap((account) => modelPoints(account.detail, measure).map((point) => ({ ...point, id: account.accountId })));
}

// Series con color: las MAX_SERIES con más tokens y, si hay más, «Otros». Se ordena con TODOS los puntos que llegan
// (el historial entero, no el periodo ni la medida): cambiar 7/30 días o coste/tokens no repinta ninguna serie.
export function rankSeries(points: readonly SeriesPoint[]): readonly string[] {
  const totals = new Map<string, number>();
  for (const point of points) totals.set(point.id, (totals.get(point.id) ?? 0) + point.tokens);
  const ranked = [...totals.entries()].filter(([, tokens]) => tokens > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  return ranked.length <= MAX_SERIES ? ranked : [...ranked.slice(0, MAX_SERIES), OTHER_SERIES];
}

// Columnas apiladas del periodo: una por día (también los días sin consumo), en el orden de `rankSeries`.
export function stackDaily(points: readonly SeriesPoint[], period: readonly DayKey[]): StackedDaily {
  const series = rankSeries(points);
  const slot = new Map(series.map((id, index) => [id, index]));
  const otherSlot = slot.get(OTHER_SERIES);
  const byDay = new Map(period.map((day) => [day, new Array<number>(series.length).fill(0)]));
  for (const point of points) {
    const values = byDay.get(point.day);
    const index = slot.get(point.id) ?? otherSlot;
    if (values === undefined || index === undefined) continue;
    values[index] = (values[index] ?? 0) + point.value;
  }
  const days = period.map((day) => {
    const values = byDay.get(day) ?? [];
    return { day, values, total: values.reduce((sum, value) => sum + value, 0) };
  });
  return { series, days, max: Math.max(0, ...days.map((day) => day.total)) };
}

// Tope del eje: el primer 1, 2 o 5 × 10^n que alcanza `value` (0 → 0). Las rayas guía caen en cifras redondas.
export function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Valor no valido para el eje: ${value}`);
  if (value === 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = NICE_STEPS.find((factor) => factor * magnitude >= value) ?? DECADE; // el 10 siempre alcanza: el respaldo no se usa
  return step * magnitude;
}

// Alto en px de un tramo: 0 sin valor; si no, al menos MIN_BAR_PX para que un día pequeño se vea.
export function barHeightPx(value: number, max: number, chartPx: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(MIN_BAR_PX, Math.round((value / max) * chartPx));
}

export type TokenPart = 'input' | 'output' | 'cacheRead' | 'cacheWrite';
export const TOKEN_PARTS: readonly TokenPart[] = ['input', 'output', 'cacheRead', 'cacheWrite'];

export interface TokenSplit {
  readonly tokens: Readonly<Record<TokenPart, number>>;
  readonly costMicroUsd: Readonly<Record<TokenPart, number>>; // solo de los modelos con precio
  readonly total: number;
  readonly cacheHitPct: number | null; // lectura de caché ÷ toda la entrada (entrada + lectura + escritura)
}

function usageByKey(detail: readonly DailyDetail[], period: readonly DayKey[]): Map<string, ModelUsage> {
  const inPeriod = new Set(period);
  const byKey = new Map<string, ModelUsage>();
  for (const day of detail) {
    if (!inPeriod.has(day.day)) continue;
    for (const [key, usage] of Object.entries(day.byModel)) byKey.set(key, addModelUsage(byKey.get(key) ?? EMPTY_MODEL_USAGE, usage));
  }
  return byKey;
}

// Solo una parte del uso (las demás a 0): sirve para contar sus tokens y para ponerle precio.
function partOf(usage: ModelUsage, part: TokenPart): ModelUsage {
  if (part === 'input') return { ...EMPTY_MODEL_USAGE, inputTokens: usage.inputTokens };
  if (part === 'output') return { ...EMPTY_MODEL_USAGE, outputTokens: usage.outputTokens };
  if (part === 'cacheRead') return { ...EMPTY_MODEL_USAGE, cacheReadTokens: usage.cacheReadTokens };
  return { ...EMPTY_MODEL_USAGE, cacheWrite5mTokens: usage.cacheWrite5mTokens, cacheWrite1hTokens: usage.cacheWrite1hTokens };
}

// Reparto del periodo por parte, con su coste y el acierto de caché (null sin entrada).
export function tokenSplitOf(detail: readonly DailyDetail[], period: readonly DayKey[]): TokenSplit {
  const tokens: Record<TokenPart, number> = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const cost: Record<TokenPart, number> = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const [key, usage] of usageByKey(detail, period)) {
    for (const part of TOKEN_PARTS) {
      const only = partOf(usage, part);
      tokens[part] += modelUsageTokens(only);
      cost[part] += costMicroUsd(key, only) ?? 0;
    }
  }
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return { tokens, costMicroUsd: cost, total: prompt + tokens.output, cacheHitPct: prompt === 0 ? null : Math.round((tokens.cacheRead * PERCENT) / prompt) };
}

export interface RankedRow {
  readonly id: string;
  readonly value: number;
  readonly sharePct: number; // sobre `total`
  readonly widthPct: number; // sobre la primera fila
}

// Barras horizontales ordenadas: hasta TOP_RANKED filas con valor; la cuota es sobre el total del periodo.
export function rankedRows(entries: readonly (readonly [string, number])[], total: number): readonly RankedRow[] {
  const sorted = entries.filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = sorted[0]?.[1] ?? 0;
  return sorted.slice(0, TOP_RANKED).map(([id, value]) => ({
    id,
    value,
    sharePct: total <= 0 ? 0 : Math.round((value * PERCENT) / total),
    widthPct: Math.round((value * PERCENT) / top),
  }));
}

// Nombre corto de una carpeta: su último tramo (Windows o POSIX). La ruta entera va en el `title`.
export function projectLabel(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? cwd;
}

export interface PeakSlot {
  readonly weekday: number; // 0 = domingo, como `heatmap`
  readonly hour: number;
  readonly turns: number;
}

// Casilla con más respuestas del mapa [día de la semana][hora]; null si no hay ninguna. Empate: la primera.
export function peakSlot(heatmap: readonly (readonly number[])[]): PeakSlot | null {
  let best: PeakSlot | null = null;
  for (let weekday = 0; weekday < heatmap.length; weekday += 1) {
    const hours = heatmap[weekday] ?? [];
    for (let hour = 0; hour < hours.length; hour += 1) {
      const turns = hours[hour] ?? 0;
      if (turns > (best?.turns ?? 0)) best = { weekday, hour, turns };
    }
  }
  return best;
}

export interface Meter {
  readonly usedPct: number;
  readonly remainingPct: number;
  readonly severity: UsageSeverity;
  readonly resetsAt: number | null;
}

// Medidor de una ventana de la suscripción: lo usado (recortado a 0..100) y lo que QUEDA.
export function windowMeter(window: UsageWindowInfo): Meter {
  if (!Number.isFinite(window.utilization)) throw new Error(`Uso de ventana no valido: ${window.utilization}`);
  const usedPct = Math.min(PERCENT, Math.max(0, Math.round(window.utilization)));
  return { usedPct, remainingPct: PERCENT - usedPct, severity: severityForPct(usedPct), resetsAt: window.resetsAt };
}

export interface BudgetMeter {
  readonly spentMicroUsd: number;
  readonly budgetMicroUsd: number; // del periodo (prorrateado)
  readonly usedPct: number; // puede pasar de 100
  readonly severity: UsageSeverity;
}

// Gasto de una cuenta de API frente a su presupuesto MENSUAL, prorrateado a los días del periodo como el precio del
// plan (`planValueOf`). null sin presupuesto o con presupuesto 0.
export function budgetMeter(spentMicroUsd: number, monthlyBudgetMicroUsd: number | null, days: number): BudgetMeter | null {
  if (!Number.isSafeInteger(spentMicroUsd) || spentMicroUsd < 0) throw new Error(`Gasto no valido: ${spentMicroUsd}`);
  const value = planValueOf(spentMicroUsd, monthlyBudgetMicroUsd, days);
  if (value === null || value.planCostMicroUsd === 0) return null;
  const usedPct = Math.floor((spentMicroUsd * PERCENT) / value.planCostMicroUsd);
  return { spentMicroUsd, budgetMicroUsd: value.planCostMicroUsd, usedPct, severity: severityForPct(usedPct) };
}

// Día corto para ejes, tooltips y tablas («lun, 9 nov»). Se formatea la FECHA en UTC: no se corre con la zona.
export function dayLabel(day: DayKey, locale: string): string {
  if (!DAY_KEY.test(day)) throw new Error(`Dia no valido: ${JSON.stringify(day)}`);
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}
