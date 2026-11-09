import type { BackgroundTaskInfo } from '@shared/events';
import type { Translate } from '@shared/i18n/translator';
import { t } from '../i18n/uiLanguage';

// Tareas en segundo plano del CLI que NO son subagentes (Bash con `run_in_background`, monitores…), P-038 V2. Su
// dock va encima del input para que un chat sin turno pero con trabajo vivo no parezca colgado. PURO.

export interface BackgroundTaskRow extends BackgroundTaskInfo {
  // Desde cuándo la ve Mage: el CLI no manda la hora de inicio en la lista (aproximación de UI, como los agentes).
  readonly sinceMs: number;
}

const NO_ROWS: readonly BackgroundTaskRow[] = [];

// La lista nueva SUSTITUYE a la anterior (el CLI manda siempre la entera); las que ya estaban conservan su hora.
// Misma referencia si no cambia nada, para no repintar.
export function mergeBackgroundTasks(previous: readonly BackgroundTaskRow[] | undefined, tasks: readonly BackgroundTaskInfo[], nowMs: number): readonly BackgroundTaskRow[] {
  if (!Number.isFinite(nowMs)) throw new Error(`nowMs no valido: ${nowMs}`);
  if (tasks.length === 0) return NO_ROWS;
  const known = new Map((previous ?? NO_ROWS).map((row) => [row.taskId, row]));
  const rows = tasks.map((task) => ({ ...task, sinceMs: known.get(task.taskId)?.sinceMs ?? nowMs }));
  const same = previous !== undefined && previous.length === rows.length && rows.every((row, i) => sameRow(row, previous[i]));
  return same ? previous : rows;
}

function sameRow(a: BackgroundTaskRow, b: BackgroundTaskRow | undefined): boolean {
  return b !== undefined && a.taskId === b.taskId && a.description === b.description && a.type === b.type && a.sinceMs === b.sinceMs;
}

// «1 tarea en segundo plano» / «3 tareas en segundo plano».
export function backgroundTasksSummary(count: number, translate: Translate = t): string {
  if (!Number.isInteger(count) || count < 0) throw new Error(`Numero de tareas no valido: ${count}`);
  return translate('chat.tasks.summary', { count });
}
