import { describe, expect, it, vi } from 'vitest';
import { WidgetPrefsStore } from './widgetPrefsStore';

const PATH = '/data/widget-prefs.json';

// FS en memoria que cuenta lecturas y escrituras.
function setup(initial?: string) {
  const files = new Map<string, string>();
  if (initial !== undefined) files.set(PATH, initial);
  const counters = { reads: 0, writes: 0 };
  const log = vi.fn();
  const store = new WidgetPrefsStore({
    filePath: PATH,
    log,
    exists: (path) => {
      counters.reads += 1; // cada lectura del fichero empieza por aquí (readSnapshot)
      return files.has(path);
    },
    readFile: (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    writeFile: (path, data) => {
      counters.writes += 1;
      files.set(path, data);
    },
    rename: (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
    removeFile: (path) => void files.delete(path),
    tempSuffix: () => 'suf',
    sleep: () => undefined,
  });
  return { store, files, counters, log };
}

describe('WidgetPrefsStore', () => {
  it('load_missingFile_defaults', () => {
    const t = setup();
    expect(t.store.load()).toEqual({ expanded: false, doNotDisturb: false });
    expect(t.log).toHaveBeenCalledTimes(0);
  });

  it('load_validFile_returnsIt', () => {
    const t = setup('{"expanded":true,"doNotDisturb":true}');
    expect(t.store.load()).toEqual({ expanded: true, doNotDisturb: true });
  });

  it('load_invalidJson_defaultsAndWarns', () => {
    const t = setup('{no');
    expect(t.store.load()).toEqual({ expanded: false, doNotDisturb: false });
    expect(t.log).toHaveBeenCalledTimes(1);
    expect(t.log.mock.calls[0]?.[0]).toBe('warn');
  });

  it('load_wrongShape_defaultsAndWarns', () => {
    const t = setup('{"expanded":"si","doNotDisturb":false}');
    expect(t.store.load()).toEqual({ expanded: false, doNotDisturb: false });
    expect(t.log).toHaveBeenCalledTimes(1);
  });

  it('update_patch_mergesAndPersists', () => {
    const t = setup();
    expect(t.store.update({ doNotDisturb: true })).toEqual({ expanded: false, doNotDisturb: true });
    expect(JSON.parse(t.files.get(PATH) ?? 'null')).toEqual({ expanded: false, doNotDisturb: true });
  });

  it('update_noChange_doesNotWrite', () => {
    const t = setup();
    t.store.update({ expanded: false });
    expect(t.counters.writes).toBe(0);
  });

  it('load_afterUpdate_usesCache', () => {
    const t = setup();
    t.store.update({ expanded: true });
    t.store.load();
    t.store.load();
    expect(t.counters.reads).toBe(1);
  });
});
