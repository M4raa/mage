import { create } from 'zustand';
import type { TaskDraft, TaskRecord } from '@shared/tasks';

// Lista de tareas del renderer (R3). Main es la fuente de verdad: cada acción devuelve la tarea ya actualizada
// (se reemplaza por id) o se recarga la lista entera.
export interface TaskApi {
  readonly listTasks: () => Promise<readonly TaskRecord[]>;
  readonly createTask: (draft: TaskDraft) => Promise<TaskRecord>;
  readonly verifyTask: (params: { taskId: string; declared: readonly string[] }) => Promise<TaskRecord>;
  readonly removeTask: (taskId: string) => Promise<void>;
}

interface TaskState {
  readonly tasks: readonly TaskRecord[];
  readonly loaded: boolean;
  load: () => Promise<void>;
  create: (draft: TaskDraft) => Promise<TaskRecord>;
  verify: (taskId: string, declared: readonly string[]) => Promise<void>;
  remove: (taskId: string) => Promise<void>;
}

// Sustituye por id (o añade al principio si es nueva).
export function upsertTask(tasks: readonly TaskRecord[], task: TaskRecord): readonly TaskRecord[] {
  return tasks.some((existing) => existing.id === task.id)
    ? tasks.map((existing) => (existing.id === task.id ? task : existing))
    : [task, ...tasks];
}

export function createTaskStore(api: TaskApi) {
  return create<TaskState>((set, get) => ({
    tasks: [],
    loaded: false,
    load: async () => {
      set({ tasks: await api.listTasks(), loaded: true });
    },
    create: async (draft) => {
      const task = await api.createTask(draft);
      set({ tasks: upsertTask(get().tasks, task) });
      return task;
    },
    verify: async (taskId, declared) => {
      const task = await api.verifyTask({ taskId, declared });
      set({ tasks: upsertTask(get().tasks, task) });
    },
    remove: async (taskId) => {
      await api.removeTask(taskId);
      set({ tasks: get().tasks.filter((task) => task.id !== taskId) });
    },
  }));
}

export const useTaskStore = createTaskStore({
  listTasks: () => window.mage.listTasks(),
  createTask: (draft) => window.mage.createTask(draft),
  verifyTask: (params) => window.mage.verifyTask(params),
  removeTask: (taskId) => window.mage.removeTask(taskId),
});
