// Modelo PURO de la pantalla «Tareas programadas»: búsqueda, horario en palabras, duplicar y lectura de Claude Desktop.
import type { ConversationSummary } from '@shared/conversations';
import { formatDateTime } from '@shared/i18n/format';
import type { Translate } from '@shared/i18n/translator';
import { zonedToUtc, parseIsoDate, type LocalTime, type TaskSchedule } from '@shared/taskSchedule';
import { TASK_LIMITS, type DesktopScheduledTaskFile, type TaskDraft, type TaskRecord } from '@shared/tasks';
import { parseFrontmatter } from '../memoryView';
import { taskDisplayName } from './taskView';

const PROMPT_PREVIEW_CHARS = 280;
const ELLIPSIS = '…';
const DEFAULT_DESKTOP_RUNS = 3;
const SUNDAY_2024_01_07_DAY = 7; // el 7-1-2024 fue domingo: base de `weekdayName`

const includesText = (haystack: string, needle: string): boolean => haystack.toLowerCase().includes(needle);

export function filterTasks(tasks: readonly TaskRecord[], query: string): readonly TaskRecord[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return tasks;
  return tasks.filter((task) => includesText(taskDisplayName(task), needle) || includesText(task.goal, needle));
}

export interface DesktopTaskView {
  readonly key: string;
  readonly accountDir: string;
  readonly name: string;
  readonly description: string;
  readonly promptPreview: string;
}

export function filterDesktopTasks(items: readonly DesktopTaskView[], query: string): readonly DesktopTaskView[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return items;
  return items.filter((item) => [item.name, item.description, item.promptPreview].some((field) => includesText(field, needle)));
}

export type LastRunKind = 'never' | 'started' | 'late' | 'failed';

export function lastRunKind(task: Pick<TaskRecord, 'lastRun'>): LastRunKind {
  if (task.lastRun === null) return 'never';
  if (task.lastRun.outcome === 'failed') return 'failed';
  return task.lastRun.late ? 'late' : 'started';
}

// Nombre largo del día (0 = domingo) en el idioma de la interfaz.
export function weekdayName(day: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(Date.UTC(2024, 0, SUNDAY_2024_01_07_DAY + day));
}

const pad2 = (n: number): string => String(n).padStart(2, '0');
const clock = (time: LocalTime): string => `${pad2(time.hour)}:${pad2(time.minute)}`;

function onceWhen(schedule: Extract<TaskSchedule, { kind: 'once' }>, locale: string): string {
  const date = parseIsoDate(schedule.date);
  if (date === null) throw new Error(`Fecha de programación inválida: ${schedule.date}`);
  return formatDateTime(zonedToUtc({ ...date, ...schedule.time }, schedule.timeZone), locale);
}

export function describeSchedule(schedule: TaskSchedule, translate: Translate, locale: string): string {
  if (schedule.kind === 'once') return translate('scheduledTasks.schedule.once', { when: onceWhen(schedule, locale) });
  if (schedule.kind === 'hourly') return translate('scheduledTasks.schedule.hourly', { minute: String(schedule.minute) });
  if (schedule.kind === 'daily') return translate('scheduledTasks.schedule.daily', { time: clock(schedule.time) });
  if (schedule.kind === 'weekdays') return translate('scheduledTasks.schedule.weekdays', { time: clock(schedule.time) });
  return translate('scheduledTasks.schedule.weekly', { weekday: weekdayName(schedule.weekday, locale), time: clock(schedule.time) });
}

export function duplicateDraftOf(task: TaskRecord, copyName: string): TaskDraft {
  return {
    name: copyName.slice(0, TASK_LIMITS.nameMaxChars),
    schedule: task.schedule,
    goal: task.goal,
    language: task.language,
    provider: task.provider,
    accountDir: task.accountDir,
    folders: task.folders,
    documents: task.documents,
    capabilities: task.capabilities,
  };
}

// SKILL.md de Claude Desktop -> lo que enseña la tarjeta (nombre y descripción del frontmatter; el resto, el prompt).
export function desktopTaskOf(file: DesktopScheduledTaskFile): DesktopTaskView {
  const { attributes, body } = parseFrontmatter(file.content);
  const text = body.trim();
  const promptPreview = text.length > PROMPT_PREVIEW_CHARS ? `${text.slice(0, PROMPT_PREVIEW_CHARS - 1).trimEnd()}${ELLIPSIS}` : text;
  return {
    key: `${file.accountDir}\n${file.folder}`,
    accountDir: file.accountDir,
    name: attributes.name ?? file.folder,
    description: attributes.description ?? '',
    promptPreview,
  };
}

// Las últimas conversaciones que creó una tarea de Claude Desktop: programadas y tituladas con su nombre.
export function desktopRunsOf(
  history: readonly { readonly accountId: string; readonly item: ConversationSummary }[],
  name: string,
  limit: number = DEFAULT_DESKTOP_RUNS,
): readonly { readonly accountId: string; readonly item: ConversationSummary }[] {
  return history
    .filter((entry) => entry.item.isScheduled && entry.item.title === name)
    .sort((a, b) => b.item.updatedAtMs - a.item.updatedAtMs)
    .slice(0, limit);
}
