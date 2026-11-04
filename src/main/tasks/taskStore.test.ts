import { describe, expect, it, vi } from 'vitest';
import type { TaskRecord } from '@shared/tasks';
import { loadTasks, saveTasks, TASKS_FILE_VERSION, type TaskStoreFs } from './taskStore';

const PATH = '/data/tasks/tasks.json';

function task(id: string): TaskRecord {
  return {
    id, goal: 'g', language: 'es', provider: 'claude', accountDir: '/a', folders: ['/w'], documents: [], capabilities: [],
    createdAtMs: 1, sessionId: null, conversationId: null, verifiedAtMs: null, verdict: 'pending',
    deliverables: [{ declared: 'a.md', path: '/w/a.md', status: 'ok', bytes: 3, modifiedAtMs: 2, kind: 'md' }],
  };
}

// FS en memoria: `files` hace de disco.
function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const warn = vi.fn();
  const fs: TaskStoreFs = {
    exists: (path) => files.has(path),
    readFile: (path) => files.get(path) as string,
    writeFile: (path, data) => void files.set(path, data),
    rename: (from, to) => {
      files.set(to, files.get(from) as string);
      files.delete(from);
    },
    removeFile: (path) => void files.delete(path),
    tempSuffix: () => 'tmp1',
    mkdir: vi.fn(),
    warn,
    sleep: () => undefined,
  };
  return { fs, files, warn };
}

describe('taskStore', () => {
  it('loadTasks_sinFichero_vacio', () => {
    const { fs } = memoryFs();

    expect(loadTasks(fs, PATH)).toEqual([]);
  });

  it('loadTasks_jsonRoto_renombraAvisaYVacio', () => {
    const { fs, files, warn } = memoryFs({ [PATH]: '{no es json' });

    expect(loadTasks(fs, PATH)).toEqual([]);

    expect(files.has(PATH)).toBe(false);
    expect([...files.keys()].some((key) => /tasks\.json\.corrupt-\d+$/.test(key))).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('.corrupt-');
  });

  it('loadTasks_versionDistinta_renombraAvisaYVacio', () => {
    const { fs, files, warn } = memoryFs({ [PATH]: JSON.stringify({ version: 2, tasks: [] }) });

    expect(loadTasks(fs, PATH)).toEqual([]);

    expect(files.has(PATH)).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('loadTasks_registroInvalido_descartaSoloEse', () => {
    const text = JSON.stringify({ version: TASKS_FILE_VERSION, tasks: [task('a'), { id: 'roto' }, task('b')] });
    const { fs, warn } = memoryFs({ [PATH]: text });

    const loaded = loadTasks(fs, PATH);

    expect(loaded.map((t) => t.id)).toEqual(['a', 'b']);
    expect(warn).toHaveBeenCalledOnce();
  });

  it('saveTasks_luegoLoad_mismosDatos', () => {
    const { fs } = memoryFs();
    const tasks = [task('a'), task('b')];

    saveTasks(fs, PATH, tasks);

    expect(fs.mkdir).toHaveBeenCalledWith('/data/tasks');
    expect(loadTasks(fs, PATH)).toEqual(tasks);
  });
});
