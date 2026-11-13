// Tareas programadas: cálculo puro de la próxima ejecución. Sin Node ni DOM; solo zod e Intl.
// La regla se guarda en hora de reloj + zona IANA y todo instante calculado es epoch ms UTC.
import { z } from 'zod';

export interface LocalTime {
  readonly hour: number;
  readonly minute: number;
}

export interface CivilDate {
  readonly year: number;
  readonly month: number; // 1–12
  readonly day: number;
}

export interface WallTime extends CivilDate, LocalTime {}

export type TaskSchedule =
  | { readonly kind: 'once'; readonly date: string /* YYYY-MM-DD */; readonly time: LocalTime; readonly timeZone: string }
  | { readonly kind: 'hourly'; readonly minute: number; readonly timeZone: string }
  | { readonly kind: 'daily'; readonly time: LocalTime; readonly timeZone: string }
  | { readonly kind: 'weekdays'; readonly time: LocalTime; readonly timeZone: string }
  | { readonly kind: 'weekly'; readonly weekday: number /* 0=domingo … 6=sábado, como getUTCDay */; readonly time: LocalTime; readonly timeZone: string };

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const HALF_DAY_MS = 12 * HOUR_MS;
export const DAY_MS = 24 * HOUR_MS;
const DAYS_TO_SCAN = 7;
const MINUTES_PER_HOUR = 60;
const MAX_TIME_ZONE_CHARS = 64;
const MAX_HOUR = 23;
const MAX_MINUTE = 59;
const MAX_WEEKDAY = 6;
const FIRST_WEEKDAY = 1;
const LAST_WEEKDAY = 5;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
  formatters.set(timeZone, created);
  return created;
}

// Hora de reloj que marca `timeZone` en el instante `utcMs`.
export function zonedParts(utcMs: number, timeZone: string): WallTime {
  const parts = formatterFor(timeZone).formatToParts(utcMs);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = Number(parts.find((part) => part.type === type)?.value);
    if (!Number.isInteger(value)) throw new Error(`Campo de fecha no entero (${type}) para ${utcMs} en ${timeZone}: ${String(value)}`);
    return value;
  };
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute') };
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    // Contrato: «zona no válida» ES el resultado (false), no un error tragado (como canReadOneByte en taskNodeFs.ts).
    return false;
  }
}

function wallAsUtc(w: WallTime): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
}

function offsetAt(utcMs: number, timeZone: string): number {
  return wallAsUtc(zonedParts(utcMs, timeZone)) - Math.floor(utcMs / MINUTE_MS) * MINUTE_MS;
}

// Regla «compatible» de Temporal: hueco de primavera → se corre hacia delante; hora repetida → la primera.
export function zonedToUtc(wall: WallTime, timeZone: string): number {
  const target = wallAsUtc(wall);
  const before = target - offsetAt(target - HALF_DAY_MS, timeZone);
  const after = target - offsetAt(target + HALF_DAY_MS, timeZone);
  const valid = [before, after].filter((c) => wallAsUtc(zonedParts(c, timeZone)) === target);
  return valid.length === 0 ? before : Math.min(...valid);
}

export function parseIsoDate(text: string): CivilDate | null {
  if (!ISO_DATE.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number) as [number, number, number];
  const back = new Date(Date.UTC(year, month - 1, day));
  const ok = back.getUTCFullYear() === year && back.getUTCMonth() === month - 1 && back.getUTCDate() === day;
  return ok ? { year, month, day } : null;
}

export function formatIsoDate(d: CivilDate): string {
  const pad = (n: number, width: number): string => String(n).padStart(width, '0');
  return `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}`;
}

export function addDays(d: CivilDate, days: number): CivilDate {
  const moved = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

export function weekdayOf(d: CivilDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

function nextOnce(schedule: Extract<TaskSchedule, { kind: 'once' }>, fromUtcMs: number): number | null {
  const date = parseIsoDate(schedule.date);
  if (date === null) throw new Error(`Fecha de programación inválida: ${schedule.date}`);
  const at = zonedToUtc({ ...date, ...schedule.time }, schedule.timeZone);
  return at > fromUtcMs ? at : null;
}

function nextHourly(schedule: Extract<TaskSchedule, { kind: 'hourly' }>, fromUtcMs: number): number {
  const base = Math.floor(fromUtcMs / MINUTE_MS) * MINUTE_MS;
  const wait = (schedule.minute - zonedParts(base, schedule.timeZone).minute + MINUTES_PER_HOUR) % MINUTES_PER_HOUR;
  const candidate = base + wait * MINUTE_MS;
  // ponytail: supone que el cambio de hora mueve horas enteras (vale en Europa y América); en zonas con cambios de 30 min puede desviarse un ciclo.
  return candidate <= fromUtcMs ? candidate + HOUR_MS : candidate;
}

function dayMatches(schedule: TaskSchedule, date: CivilDate): boolean {
  if (schedule.kind === 'daily') return true;
  const weekday = weekdayOf(date);
  if (schedule.kind === 'weekdays') return weekday >= FIRST_WEEKDAY && weekday <= LAST_WEEKDAY;
  return schedule.kind === 'weekly' && weekday === schedule.weekday;
}

function nextByDay(schedule: Extract<TaskSchedule, { kind: 'daily' | 'weekdays' | 'weekly' }>, fromUtcMs: number): number {
  const { year, month, day } = zonedParts(fromUtcMs, schedule.timeZone);
  const today: CivilDate = { year, month, day };
  for (let offset = 0; offset <= DAYS_TO_SCAN; offset += 1) {
    const date = addDays(today, offset);
    if (!dayMatches(schedule, date)) continue;
    const candidate = zonedToUtc({ ...date, ...schedule.time }, schedule.timeZone);
    if (candidate > fromUtcMs) return candidate;
  }
  throw new Error(`Sin próxima ejecución en ${DAYS_TO_SCAN} días para ${JSON.stringify(schedule)} desde ${fromUtcMs}`);
}

// Primer instante ESTRICTAMENTE posterior a `fromUtcMs`; null solo para «una vez» ya pasada.
export function nextRunAt(schedule: TaskSchedule, fromUtcMs: number): number | null {
  if (schedule.kind === 'once') return nextOnce(schedule, fromUtcMs);
  if (schedule.kind === 'hourly') return nextHourly(schedule, fromUtcMs);
  return nextByDay(schedule, fromUtcMs);
}

const timeZoneSchema = z.string().min(1).max(MAX_TIME_ZONE_CHARS).refine(isValidTimeZone);
const timeSchema = z.object({ hour: z.number().int().min(0).max(MAX_HOUR), minute: z.number().int().min(0).max(MAX_MINUTE) }).strict();

export const taskScheduleSchema: z.ZodType<TaskSchedule> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), date: z.string().refine((d) => parseIsoDate(d) !== null), time: timeSchema, timeZone: timeZoneSchema }).strict(),
  z.object({ kind: z.literal('hourly'), minute: z.number().int().min(0).max(MAX_MINUTE), timeZone: timeZoneSchema }).strict(),
  z.object({ kind: z.literal('daily'), time: timeSchema, timeZone: timeZoneSchema }).strict(),
  z.object({ kind: z.literal('weekdays'), time: timeSchema, timeZone: timeZoneSchema }).strict(),
  z.object({ kind: z.literal('weekly'), weekday: z.number().int().min(0).max(MAX_WEEKDAY), time: timeSchema, timeZone: timeZoneSchema }).strict(),
]);
