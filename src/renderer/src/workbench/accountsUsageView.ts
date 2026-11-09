import { addDays, EMPTY_DAY, totalTokens, type DailyTokens, type DayKey, type DayTokens, type UsageHistory } from '@shared/usageHistory';

// Modelo PURO de «Cuentas y consumo» (P-038 V11): sumas por periodo y la serie por días del gráfico. La pantalla solo pinta.

const MS_PER_DAY = 86_400_000;
export const PERIODS = [7, 30] as const;
export type PeriodDays = (typeof PERIODS)[number];

// Día LOCAL `YYYY-MM-DD` (el mismo criterio que main al agrupar las transcripciones).
export function localDay(date: Date): DayKey {
  const offset = -date.getTimezoneOffset();
  return new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 10);
}

// Los `count` días que acaban en `today`, del más antiguo al más reciente.
export function lastDays(today: DayKey, count: number): readonly DayKey[] {
  if (!Number.isInteger(count) || count <= 0) throw new Error(`Numero de dias no valido: ${count}`);
  const end = Date.parse(`${today}T00:00:00.000Z`);
  if (Number.isNaN(end)) throw new Error(`Dia no valido: ${JSON.stringify(today)}`);
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * MS_PER_DAY).toISOString().slice(0, 10));
}

// Días de una cuenta, de todas (null) o de las sin atribuir.
export function daysOf(history: UsageHistory, accountId: string | null): readonly DailyTokens[] {
  if (accountId !== null) return history.accounts.find((account) => account.accountId === accountId)?.days ?? [];
  return [...history.accounts.flatMap((account) => account.days), ...history.unattributed];
}

// Una entrada por día de la ventana, con 0 donde no hubo consumo (la barra vacía también dice algo).
export function dailySeries(days: readonly DailyTokens[], window: readonly DayKey[]): readonly DailyTokens[] {
  const byDay = new Map<DayKey, DayTokens>();
  for (const day of days) byDay.set(day.day, addDays(byDay.get(day.day) ?? EMPTY_DAY, day));
  return window.map((day) => ({ day, ...(byDay.get(day) ?? EMPTY_DAY) }));
}

export function sumSince(days: readonly DailyTokens[], fromDay: DayKey): DayTokens {
  return days.filter((day) => day.day >= fromDay).reduce<DayTokens>((sum, day) => addDays(sum, day), EMPTY_DAY);
}

export interface PeriodTotals {
  readonly today: number;
  readonly week: number;
  readonly month: number;
}

export function periodTotals(days: readonly DailyTokens[], today: DayKey): PeriodTotals {
  const week = lastDays(today, 7)[0] ?? today;
  const month = lastDays(today, 30)[0] ?? today;
  return { today: totalTokens(sumSince(days, today)), week: totalTokens(sumSince(days, week)), month: totalTokens(sumSince(days, month)) };
}

// El máximo de la serie para la escala (al menos 1: con todo a cero no se divide por cero).
export function seriesMax(series: readonly DailyTokens[]): number {
  return Math.max(1, ...series.map(totalTokens));
}
