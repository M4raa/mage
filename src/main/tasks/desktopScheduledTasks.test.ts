import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DESKTOP_TASK_MAX_CHARS, listDesktopScheduledTasks, type DesktopTaskFs } from './desktopScheduledTasks';

// FS en memoria: `dirs` lista carpetas por ruta y `files` guarda los SKILL.md.
function memoryFs(dirs: Record<string, string[]>, files: Record<string, string>): DesktopTaskFs {
  return { listDirs: (path) => dirs[path] ?? [], readText: (path) => files[path] ?? null };
}

const A = join('/acc', 'a');
const B = join('/acc', 'b');
const tasksOf = (account: string): string => join(account, 'scheduled-tasks');
const skillOf = (account: string, folder: string): string => join(tasksOf(account), folder, 'SKILL.md');

describe('listDesktopScheduledTasks', () => {
  it('listDesktopScheduledTasks_dosCuentas_juntaLasDeAmbas', () => {
    const fs = memoryFs({ [tasksOf(A)]: ['uno'], [tasksOf(B)]: ['dos'] }, { [skillOf(A, 'uno')]: 'u', [skillOf(B, 'dos')]: 'd' });

    expect(listDesktopScheduledTasks([A, B], fs)).toEqual([
      { accountDir: A, folder: 'uno', content: 'u' },
      { accountDir: B, folder: 'dos', content: 'd' },
    ]);
  });

  it('listDesktopScheduledTasks_cuentaSinCarpeta_vacio', () => {
    expect(listDesktopScheduledTasks([A], memoryFs({}, {}))).toEqual([]);
  });

  it('listDesktopScheduledTasks_carpetaSinSkill_seSalta', () => {
    const fs = memoryFs({ [tasksOf(A)]: ['vacia', 'ok'] }, { [skillOf(A, 'ok')]: 'x' });

    expect(listDesktopScheduledTasks([A], fs).map((f) => f.folder)).toEqual(['ok']);
  });

  it('listDesktopScheduledTasks_ficheroEnorme_seRecorta', () => {
    const fs = memoryFs({ [tasksOf(A)]: ['grande'] }, { [skillOf(A, 'grande')]: 'x'.repeat(DESKTOP_TASK_MAX_CHARS + 10) });

    expect(listDesktopScheduledTasks([A], fs)[0]?.content).toHaveLength(DESKTOP_TASK_MAX_CHARS);
  });
});
