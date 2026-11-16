// Tareas programadas: transiciones PURAS del registro de una tarea al lanzarse o fallar. Sin FS ni reloj propio.
import { nextRunAt, type TaskSchedule } from '@shared/taskSchedule';
import { TASK_LIMITS, type TaskRecord } from '@shared/tasks';

const LATE_RUN_GRACE_MINUTES = 5;
const MS_PER_MINUTE = 60_000;
// Más de esto de retraso sobre lo previsto = «con retraso, Mage estaba cerrado».
export const LATE_RUN_GRACE_MS = LATE_RUN_GRACE_MINUTES * MS_PER_MINUTE;

export function nextRunFor(schedule: TaskSchedule | null, enabled: boolean, nowMs: number): number | null {
  if (!enabled || schedule === null) return null;
  return nextRunAt(schedule, nowMs);
}

// Pendiente: activada, programada y con su instante ya vencido.
export function isDue(task: TaskRecord, nowMs: number): boolean {
  return task.enabled && task.schedule !== null && task.nextRunAtMs !== null && task.nextRunAtMs <= nowMs;
}

// La ejecución arranca: la sesión anterior ya no cuenta y la siguiente se calcula desde AHORA, no desde la que tocaba
// (una diaria que lleva tres días sin ejecutarse corre una sola vez).
export function startedRun(task: TaskRecord, nowMs: number, scheduledForMs: number | null): TaskRecord {
  const late = scheduledForMs !== null && nowMs - scheduledForMs > LATE_RUN_GRACE_MS;
  return {
    ...task,
    sessionId: null,
    conversationId: null,
    deliverables: [],
    verifiedAtMs: null,
    verdict: 'pending',
    lastRun: { atMs: nowMs, scheduledForMs, late, outcome: 'started', error: null },
    nextRunAtMs: scheduledForMs === null ? task.nextRunAtMs : nextRunFor(task.schedule, task.enabled, nowMs),
  };
}

export function failedRun(task: TaskRecord, nowMs: number, error: string): TaskRecord {
  const cut = error.slice(0, TASK_LIMITS.runErrorMaxChars);
  const lastRun = task.lastRun === null
    ? { atMs: nowMs, scheduledForMs: null, late: false, outcome: 'failed' as const, error: cut }
    : { ...task.lastRun, outcome: 'failed' as const, error: cut };
  return { ...task, lastRun };
}

export function hasActiveSchedule(tasks: readonly TaskRecord[]): boolean {
  return tasks.some((task) => task.enabled && task.nextRunAtMs !== null);
}
