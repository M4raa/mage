import type { DayKey } from '@shared/usageHistory';

// Días y periodos de «Cuentas y consumo» (P-038 V11). Las métricas viven en accountMetrics.ts (P-039).

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
