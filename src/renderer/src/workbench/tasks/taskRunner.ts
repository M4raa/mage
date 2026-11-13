// Ejecuciones de tareas programadas en el renderer: PURO (solo dependencias inyectadas).
// Main avisa con una señal sin datos; aquí se recogen las pendientes y se lanzan EN SERIE
// (`createConversation` y `activeTabId` no aguantan dos a la vez).
import type { TaskDraft, TaskRecord } from '@shared/tasks';

export interface ScheduledRunsDeps {
  readonly takeDue: () => Promise<readonly TaskRecord[]>;
  readonly launch: (task: TaskRecord) => Promise<string>;
  readonly reportFailed: (taskId: string, error: string) => Promise<void>;
  readonly reload: () => Promise<void>;
  readonly onDue: (listener: () => void) => () => void;
  readonly reportError: (err: unknown) => void;
  readonly describe: (err: unknown) => string;
}

async function runDue(deps: ScheduledRunsDeps): Promise<void> {
  const due = await deps.takeDue();
  for (const task of due) {
    try {
      await deps.launch(task);
    } catch (err) {
      // Registrar el fallo no puede cortar el resto: main ya las marcó a todas como lanzadas.
      await deps.reportFailed(task.id, deps.describe(err)).catch(deps.reportError);
      deps.reportError(err);
    }
  }
  if (due.length > 0) await deps.reload();
}

// Al recibir el aviso de main y una vez al empezar: recoge y lanza lo pendiente. Devuelve la baja.
export function startScheduledRuns(deps: ScheduledRunsDeps): () => void {
  let chain: Promise<void> = Promise.resolve();
  const drain = (): void => {
    chain = chain.then(() => runDue(deps)).catch(deps.reportError);
  };
  const off = deps.onDue(drain);
  drain();
  return off;
}

export interface TaskFormSave {
  readonly editingId: string | null;
  readonly draft: TaskDraft;
}

export interface TaskFormSaveDeps {
  readonly edit: (id: string, draft: TaskDraft) => Promise<unknown>;
  readonly create: (draft: TaskDraft) => Promise<unknown>;
  readonly start: (draft: TaskDraft) => Promise<unknown>;
}

// Editar guarda; una tarea programada solo se crea (la lanza el planificador); sin programar se ejecuta ya.
export async function saveTaskForm(input: TaskFormSave, deps: TaskFormSaveDeps): Promise<'saved' | 'started'> {
  if (input.editingId !== null) {
    await deps.edit(input.editingId, input.draft);
    return 'saved';
  }
  if (input.draft.schedule !== null) {
    await deps.create(input.draft);
    return 'saved';
  }
  await deps.start(input.draft);
  return 'started';
}
