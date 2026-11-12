import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migratePrivateConversations, type PrivateMigrationDeps } from './privateConversationsMigration';

const ROOT = 'home';

// FS en memoria: un conjunto de rutas (ficheros y carpetas) sin contenido.
function memoryFs(paths: readonly string[], failOn: readonly string[] = []) {
  const entries = new Set<string>();
  for (const path of paths) {
    entries.add(path);
    // Los ancestros hasta la raíz del test ('home'): las rutas son relativas y `join(x, '..')` no se estabiliza.
    let parent = join(path, '..');
    while (parent !== ROOT) {
      entries.add(parent);
      parent = join(parent, '..');
    }
  }
  const logs: { level: string; message: string }[] = [];
  const children = (dir: string): string[] =>
    [...entries].filter((entry) => join(entry, '..') === dir).map((entry) => entry.slice(dir.length + 1));
  const deps: PrivateMigrationDeps = {
    exists: (path) => entries.has(path),
    listDir: children,
    ensureDir: (path) => { entries.add(path); },
    move: (from, to) => {
      if (failOn.includes(from)) throw new Error('EPERM');
      for (const entry of [...entries]) {
        if (entry === from || entry.startsWith(from + '\\') || entry.startsWith(from + '/')) {
          entries.delete(entry);
          entries.add(to + entry.slice(from.length));
        }
      }
    },
    log: (level, message) => { logs.push({ level, message }); },
  };
  return { entries, logs, deps };
}

const account = join('home', '.claude');
const priv = (...parts: string[]): string => join(account, 'mage-private', 'projects', ...parts);
const normal = (...parts: string[]): string => join(account, 'projects', ...parts);

describe('migratePrivateConversations', () => {
  it('migratePrivateConversations_sinPerfilPrivado_noHaceNada', () => {
    const { deps, logs } = memoryFs([normal('p', 'a.jsonl')]);

    expect(migratePrivateConversations([account], deps)).toEqual({ moved: 0, skipped: 0 });
    expect(logs).toEqual([]);
  });

  it('migratePrivateConversations_mueveJsonlYSubagentes', () => {
    const { deps, entries } = memoryFs([priv('p', 'a.jsonl'), priv('p', 'a', 'subagents', 'x.jsonl')]);

    const result = migratePrivateConversations([account], deps);

    expect(result).toEqual({ moved: 2, skipped: 0 });
    expect(entries.has(normal('p', 'a.jsonl'))).toBe(true);
    expect(entries.has(normal('p', 'a', 'subagents', 'x.jsonl'))).toBe(true);
    expect(entries.has(priv('p', 'a.jsonl'))).toBe(false);
  });

  it('migratePrivateConversations_destinoExiste_noLoPisa', () => {
    const { deps, entries, logs } = memoryFs([priv('p', 'a.jsonl'), normal('p', 'a.jsonl')]);

    const result = migratePrivateConversations([account], deps);

    expect(result).toEqual({ moved: 0, skipped: 1 });
    expect(entries.has(priv('p', 'a.jsonl'))).toBe(true);
    expect(logs.some((entry) => entry.level === 'warn' && entry.message.includes(priv('p', 'a.jsonl')))).toBe(true);
  });

  it('migratePrivateConversations_errorAlMover_sigueConElResto', () => {
    const { deps, entries, logs } = memoryFs([priv('p', 'a.jsonl'), priv('p', 'b.jsonl')], [priv('p', 'a.jsonl')]);

    const result = migratePrivateConversations([account], deps);

    expect(result).toEqual({ moved: 1, skipped: 1 });
    expect(entries.has(normal('p', 'b.jsonl'))).toBe(true);
    expect(logs.some((entry) => entry.message.includes('EPERM'))).toBe(true);
  });

  it('migratePrivateConversations_segundaVez_cero', () => {
    const { deps } = memoryFs([priv('p', 'a.jsonl')]);
    migratePrivateConversations([account], deps);

    expect(migratePrivateConversations([account], deps)).toEqual({ moved: 0, skipped: 0 });
  });

  it('migratePrivateConversations_variasCuentas', () => {
    const other = join('home', '.claude-2');
    const { deps, entries } = memoryFs([priv('p', 'a.jsonl'), join(other, 'mage-private', 'projects', 'q', 'b.jsonl')]);

    const result = migratePrivateConversations([account, other], deps);

    expect(result).toEqual({ moved: 2, skipped: 0 });
    expect(entries.has(join(other, 'projects', 'q', 'b.jsonl'))).toBe(true);
  });
});
