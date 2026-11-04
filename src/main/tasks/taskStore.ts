// Persistencia de las tareas (F8) en `<userData>/tasks/tasks.json`. El FS llega inyectado.
import { dirname } from 'node:path';
import { z } from 'zod';
import type { TaskRecord } from '@shared/tasks';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';

export const TASKS_FILE_VERSION = 1;

export interface TaskStoreFs extends AtomicWriteDeps {
  readonly mkdir: (path: string) => void;
  readonly warn: (message: string, data?: Readonly<Record<string, unknown>>) => void;
}

const deliverableSchema = z.object({
  declared: z.string(),
  path: z.string(),
  status: z.enum(['ok', 'missing', 'notFile', 'unreadable', 'outsideScope']),
  bytes: z.number().int().nullable(),
  modifiedAtMs: z.number().int().nullable(),
  kind: z.string(),
});

const recordSchema = z.object({
  goal: z.string(),
  language: z.enum(['es', 'en']),
  provider: z.enum(['claude', 'codex']),
  accountDir: z.string(),
  folders: z.array(z.string()),
  documents: z.array(z.string()),
  capabilities: z.array(z.string()),
  id: z.string().min(1),
  createdAtMs: z.number().int(),
  sessionId: z.string().nullable(),
  conversationId: z.string().nullable(),
  deliverables: z.array(deliverableSchema),
  verifiedAtMs: z.number().int().nullable(),
  verdict: z.enum(['pending', 'verified', 'incomplete']),
});

// Las tareas se validan una a una: un registro roto no tira los demás.
const fileSchema = z.object({ version: z.literal(TASKS_FILE_VERSION), tasks: z.array(z.unknown()) });

function quarantine(fs: TaskStoreFs, path: string, reason: string): TaskRecord[] {
  const target = `${path}.corrupt-${Date.now()}`;
  fs.rename(path, target);
  fs.warn(`tasks.json no se pudo leer (${reason}); se aparta en ${target} y se empieza vacío`, { path, target });
  return [];
}

function parseJson(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export function loadTasks(fs: TaskStoreFs, path: string): TaskRecord[] {
  if (!fs.exists(path)) return [];
  const json = parseJson(fs.readFile(path));
  if (!json.ok) return quarantine(fs, path, json.reason);
  const file = fileSchema.safeParse(json.value);
  if (!file.success) return quarantine(fs, path, 'versión o forma no reconocidas');
  return file.data.tasks.flatMap((raw, index): TaskRecord[] => {
    const parsed = recordSchema.safeParse(raw);
    if (parsed.success) return [parsed.data];
    fs.warn(`tasks.json: se descarta el registro ${index} por inválido`, { path, index });
    return [];
  });
}

export function saveTasks(fs: TaskStoreFs, path: string, tasks: readonly TaskRecord[]): void {
  fs.mkdir(dirname(path));
  writeAtomic(fs, path, `${JSON.stringify({ version: TASKS_FILE_VERSION, tasks }, null, 2)}\n`);
}
