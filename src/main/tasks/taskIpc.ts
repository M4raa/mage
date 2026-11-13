// Frontera IPC del modo de tareas (F8): valida lo que manda el renderer con Zod y delega en el servicio.
// Los diálogos nativos y la copia llegan inyectados: la ruta la elige siempre main, nunca el renderer.
import { basename } from 'node:path';
import { z } from 'zod';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import { IpcChannel } from '@shared/ipc';
import { taskScheduleSchema } from '@shared/taskSchedule';
import { TASK_LIMITS, type DesktopScheduledTaskFile, type TaskDraft } from '@shared/tasks';
import type { TaskService } from './taskService';

export interface TaskIpcDeps {
  readonly handle: (channel: string, listener: (event: unknown, arg: unknown) => unknown) => void;
  // Perezoso: depende de `app.getPath('userData')`.
  readonly service: () => TaskService;
  readonly pickPaths: (kind: 'folders' | 'documents') => Promise<readonly string[]>; // cancelado -> []
  readonly showSaveDialog: (defaultPath: string) => Promise<string | null>; // cancelado -> null
  readonly copyFile: (from: string, to: string) => void;
  // Solo la ventana principal recoge las ejecuciones programadas (takeDue): otra ventana no las lanza.
  readonly isMainWindowSender: (event: unknown) => boolean;
  readonly listDesktopTasks: () => readonly DesktopScheduledTaskFile[];
}

const MAX_ID_CHARS = 200;
const pathSchema = z.string().min(1).max(TASK_LIMITS.maxPathChars);
const taskIdSchema = z.string().min(1).max(MAX_ID_CHARS);
const draftSchema = z.object({
  name: z.string().max(TASK_LIMITS.nameMaxChars),
  schedule: taskScheduleSchema.nullable(),
  goal: z.string().max(TASK_LIMITS.goalMaxChars),
  language: z.enum(['es', 'en']),
  provider: z.enum(['claude', 'codex']),
  accountDir: pathSchema,
  folders: z.array(pathSchema).max(TASK_LIMITS.maxFolders),
  documents: z.array(pathSchema).max(TASK_LIMITS.maxDocuments),
  capabilities: z.array(z.string().min(1).max(TASK_LIMITS.maxPathChars)).max(TASK_LIMITS.maxCapabilities),
});
const verifySchema = z.object({ taskId: taskIdSchema, declared: z.array(pathSchema).max(TASK_LIMITS.maxDeliverables) });
const saveCopySchema = z.object({ taskId: taskIdSchema, path: pathSchema });
const MAX_RUN_ERROR_CHARS = 2000;
const editSchema = z.object({ taskId: taskIdSchema, draft: draftSchema });
const enabledSchema = z.object({ taskId: taskIdSchema, enabled: z.boolean() });
const runFailedSchema = z.object({ taskId: taskIdSchema, error: z.string().max(MAX_RUN_ERROR_CHARS) });

function parseWith<T>(channel: string, schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  throw new Error(`Petición inválida en ${channel}: ${JSON.stringify(raw)}`);
}

// Solo se copia un entregable que Mage ya verificó (status 'ok') de esa tarea.
async function saveCopy(deps: TaskIpcDeps, params: z.infer<typeof saveCopySchema>): Promise<boolean> {
  const task = deps.service().list().find((candidate) => candidate.id === params.taskId);
  const deliverable = task?.deliverables.find((item) => item.path === params.path && item.status === 'ok');
  if (deliverable === undefined) throw new UserFacingError(localized('errors.tasks.notADeliverable', { path: params.path }));
  const target = await deps.showSaveDialog(basename(deliverable.path));
  if (target === null) return false;
  deps.copyFile(deliverable.path, target);
  return true;
}

export function registerTaskIpc(deps: TaskIpcDeps): void {
  deps.handle(IpcChannel.TasksList, () => deps.service().list());
  deps.handle(IpcChannel.TasksCreate, (_event, arg) => deps.service().create(parseWith<TaskDraft>(IpcChannel.TasksCreate, draftSchema, arg)));
  deps.handle(IpcChannel.TasksVerify, (_event, arg) => {
    const { taskId, declared } = parseWith(IpcChannel.TasksVerify, verifySchema, arg);
    return deps.service().verify(taskId, declared);
  });
  deps.handle(IpcChannel.TasksRemove, (_event, arg) => deps.service().remove(parseWith(IpcChannel.TasksRemove, taskIdSchema, arg)));
  deps.handle(IpcChannel.TasksPickFolders, () => deps.pickPaths('folders'));
  deps.handle(IpcChannel.TasksPickDocuments, () => deps.pickPaths('documents'));
  deps.handle(IpcChannel.TasksSaveCopy, (_event, arg) => saveCopy(deps, parseWith(IpcChannel.TasksSaveCopy, saveCopySchema, arg)));
  registerScheduleIpc(deps);
}

// Tareas programadas: edición, interruptor, «ejecutar ahora», recogida de pendientes y Claude Desktop.
function registerScheduleIpc(deps: TaskIpcDeps): void {
  deps.handle(IpcChannel.TasksEdit, (_event, arg) => {
    const { taskId, draft } = parseWith<{ taskId: string; draft: TaskDraft }>(IpcChannel.TasksEdit, editSchema, arg);
    return deps.service().edit(taskId, draft);
  });
  deps.handle(IpcChannel.TasksSetEnabled, (_event, arg) => {
    const { taskId, enabled } = parseWith(IpcChannel.TasksSetEnabled, enabledSchema, arg);
    return deps.service().setEnabled(taskId, enabled);
  });
  deps.handle(IpcChannel.TasksRunNow, (_event, arg) => deps.service().runNow(parseWith(IpcChannel.TasksRunNow, taskIdSchema, arg)));
  deps.handle(IpcChannel.TasksTakeDue, (event) => (deps.isMainWindowSender(event) ? deps.service().takeDue() : []));
  deps.handle(IpcChannel.TasksRunFailed, (_event, arg) => {
    const { taskId, error } = parseWith(IpcChannel.TasksRunFailed, runFailedSchema, arg);
    deps.service().reportRunFailed(taskId, error);
    return undefined;
  });
  deps.handle(IpcChannel.TasksDesktopList, () => deps.listDesktopTasks());
}
