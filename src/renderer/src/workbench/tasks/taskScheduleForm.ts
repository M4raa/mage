// Formulario de programación del diálogo de tarea: del texto de los controles a un `TaskSchedule` y de vuelta. PURO.
import { addDays, formatIsoDate, taskScheduleSchema, weekdayOf, zonedParts, type CivilDate, type LocalTime, type TaskSchedule } from '@shared/taskSchedule';

export interface ScheduleForm {
  readonly kind: TaskSchedule['kind'];
  readonly date: string;
  readonly time: string; // HH:MM
  readonly minute: string;
  readonly weekday: string;
}

const DEFAULT_TIME = '09:00';
const DEFAULT_MINUTE = '0';
const TIME_TEXT = /^(\d{2}):(\d{2})$/;
const INTEGER_TEXT = /^\d{1,2}$/;

const pad2 = (n: number): string => String(n).padStart(2, '0');
const timeText = (time: LocalTime): string => `${pad2(time.hour)}:${pad2(time.minute)}`;

// Entero escrito en decimal o NaN (que el esquema rechaza): '' no puede colarse como 0.
const integerOrNaN = (text: string): number => (INTEGER_TEXT.test(text.trim()) ? Number(text) : Number.NaN);

function parseTime(text: string): LocalTime | undefined {
  const match = TIME_TEXT.exec(text);
  return match === null ? undefined : { hour: Number(match[1]), minute: Number(match[2]) };
}

function today(nowMs: number, timeZone: string): CivilDate {
  const { year, month, day } = zonedParts(nowMs, timeZone);
  return { year, month, day };
}

export function defaultScheduleForm(nowMs: number, timeZone: string): ScheduleForm {
  const now = today(nowMs, timeZone);
  return { kind: 'daily', date: formatIsoDate(addDays(now, 1)), time: DEFAULT_TIME, minute: DEFAULT_MINUTE, weekday: String(weekdayOf(now)) };
}

function candidateOf(form: ScheduleForm, timeZone: string): unknown {
  const time = parseTime(form.time);
  if (form.kind === 'once') return { kind: 'once', date: form.date, time, timeZone };
  if (form.kind === 'hourly') return { kind: 'hourly', minute: integerOrNaN(form.minute), timeZone };
  if (form.kind === 'weekly') return { kind: 'weekly', weekday: integerOrNaN(form.weekday), time, timeZone };
  return { kind: form.kind, time, timeZone };
}

// null = el formulario aún no describe una programación válida (botón de guardar deshabilitado).
export function scheduleFromForm(form: ScheduleForm, timeZone: string): TaskSchedule | null {
  const parsed = taskScheduleSchema.safeParse(candidateOf(form, timeZone));
  return parsed.success ? parsed.data : null;
}

export function formFromSchedule(schedule: TaskSchedule, nowMs: number, timeZone: string): ScheduleForm {
  const base = { ...defaultScheduleForm(nowMs, timeZone), kind: schedule.kind };
  if (schedule.kind === 'once') return { ...base, date: schedule.date, time: timeText(schedule.time) };
  if (schedule.kind === 'hourly') return { ...base, minute: String(schedule.minute) };
  if (schedule.kind === 'weekly') return { ...base, weekday: String(schedule.weekday), time: timeText(schedule.time) };
  return { ...base, time: timeText(schedule.time) };
}
