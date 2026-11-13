// Tareas programadas de Claude Desktop (solo lectura): cada una es `<config dir>/scheduled-tasks/<nombre>/SKILL.md`.
// El horario no está en ningún fichero legible; main solo devuelve el texto en bruto y el renderer lee su frontmatter.
import { join } from 'node:path';
import type { DesktopScheduledTaskFile } from '@shared/tasks';

export const DESKTOP_TASKS_DIR = 'scheduled-tasks';
export const DESKTOP_TASK_FILE = 'SKILL.md';
export const DESKTOP_TASK_MAX_CHARS = 64 * 1024;

export interface DesktopTaskFs {
  readonly listDirs: (path: string) => readonly string[];
  readonly readText: (path: string) => string | null;
}

function readFolder(accountDir: string, folder: string, fs: DesktopTaskFs): DesktopScheduledTaskFile[] {
  const text = fs.readText(join(accountDir, DESKTOP_TASKS_DIR, folder, DESKTOP_TASK_FILE));
  if (text === null) return [];
  return [{ accountDir, folder, content: text.slice(0, DESKTOP_TASK_MAX_CHARS) }];
}

export function listDesktopScheduledTasks(accountDirs: readonly string[], fs: DesktopTaskFs): readonly DesktopScheduledTaskFile[] {
  return accountDirs.flatMap((accountDir) => fs.listDirs(join(accountDir, DESKTOP_TASKS_DIR)).flatMap((folder) => readFolder(accountDir, folder, fs)));
}
