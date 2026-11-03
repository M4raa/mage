import { describe, expect, it, vi } from 'vitest';
import { RewindStateStore, type RewindStateStoreDeps } from './rewindStateStore';

const PATH = '/data/rewind-state.json';
const SESSION = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

// FS en memoria: `files` es el disco; el rename publica el temporal.
function memoryDeps(files: Map<string, string> = new Map()) {
  const log = vi.fn();
  const writeFile = vi.fn((path: string, data: string) => void files.set(path, data));
  const deps: RewindStateStoreDeps = {
    filePath: PATH,
    exists: (path) => files.has(path),
    readFile: (path) => files.get(path) ?? '',
    writeFile,
    rename: (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    },
    removeFile: (path) => void files.delete(path),
    tempSuffix: () => 'suf',
    log,
  };
  return { deps, files, log, writeFile };
}

describe('RewindStateStore', () => {
  it('pendingCut_missingFile_null', () => {
    const { deps } = memoryDeps();

    expect(new RewindStateStore(deps).pendingCut(SESSION)).toBeNull();
  });

  it('setPendingCut_thenRead_returnsTarget', () => {
    const { deps } = memoryDeps();
    const store = new RewindStateStore(deps);

    store.setPendingCut(SESSION, TARGET);

    expect(store.pendingCut(SESSION)).toBe(TARGET);
  });

  it('clearPendingCut_withoutEntry_noWrite', () => {
    const { deps, writeFile } = memoryDeps();

    new RewindStateStore(deps).clearPendingCut(SESSION);

    expect(writeFile).not.toHaveBeenCalled();
  });

  it('load_corruptJson_emptyAndWarns', () => {
    const { deps, files, log } = memoryDeps(new Map([[PATH, '{ no es json']]));
    const store = new RewindStateStore(deps);

    expect(store.pendingCut(SESSION)).toBeNull();

    expect(log).toHaveBeenCalledWith('warn', 'rewind-state.json ilegible: se empieza vacio', expect.objectContaining({ filePath: PATH }));
    expect(files.get(PATH)).toBe('{ no es json'); // no se sobrescribe hasta la primera escritura
  });

  it('load_unknownVersion_emptyAndWarns', () => {
    const { deps, log } = memoryDeps(new Map([[PATH, JSON.stringify({ version: 9, pendingCuts: { [SESSION]: TARGET } })]]));

    expect(new RewindStateStore(deps).pendingCut(SESSION)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('setPendingCut_nonUuid_throwsWithValue', () => {
    const { deps } = memoryDeps();

    expect(() => new RewindStateStore(deps).setPendingCut(SESSION, 'nope')).toThrow('nope');
    expect(() => new RewindStateStore(deps).setPendingCut('', TARGET)).toThrow('""');
  });

  it('recordCopy_copyOrigin_roundTrip', () => {
    const { deps } = memoryDeps();
    const store = new RewindStateStore(deps);

    store.recordCopy('copy-1', 'origin-1', 1000);

    expect(store.copyOrigin('copy-1')).toBe('origin-1');
    expect(store.copyOrigin('other')).toBeNull();
  });

  it('recordFork_forkOf_roundTrip', () => {
    const { deps } = memoryDeps();
    const store = new RewindStateStore(deps);

    store.recordFork('child', 'parent', 'claude', 5);

    expect(store.forkOf('child')).toEqual({ parent: 'parent', provider: 'claude', atMs: 5 });
  });

  it('forgetThread_removesCopyForkAndCut', () => {
    const { deps } = memoryDeps();
    const store = new RewindStateStore(deps);
    store.recordCopy(SESSION, 'origin', 1);
    store.recordFork(SESSION, 'parent', 'claude', 2);
    store.setPendingCut(SESSION, TARGET);

    store.forgetThread(SESSION);

    expect(store.copyOrigin(SESSION)).toBeNull();
    expect(store.forkOf(SESSION)).toBeNull();
    expect(store.pendingCut(SESSION)).toBeNull();
  });

  it('write_persistsAcrossInstances', () => {
    const { deps, files } = memoryDeps();
    new RewindStateStore(deps).setPendingCut(SESSION, TARGET);
    new RewindStateStore(deps).recordCopy('copy-1', 'origin-1', 7);

    const reopened = new RewindStateStore(memoryDeps(files).deps);

    expect(reopened.pendingCut(SESSION)).toBe(TARGET);
    expect(reopened.copyOrigin('copy-1')).toBe('origin-1');
  });

  it('recordKeepAlive_accumulates', () => {
    const { deps } = memoryDeps();
    const store = new RewindStateStore(deps);

    store.recordKeepAlive(SESSION, { cacheReadTokens: 100, cacheCreationTokens: 5, costMicroUsd: 40 });
    store.recordKeepAlive(SESSION, { cacheReadTokens: 200, cacheCreationTokens: 0, costMicroUsd: 60 });

    expect(store.keepAliveTotals()).toEqual({ count: 2, cacheReadTokens: 300, cacheCreationTokens: 5, costMicroUsd: 100 });
  });

  it('recordKeepAlive_nullFieldsOnlyCount', () => {
    const { deps } = memoryDeps();
    const store = new RewindStateStore(deps);

    store.recordKeepAlive(SESSION, { cacheReadTokens: null, cacheCreationTokens: null, costMicroUsd: null });

    expect(store.keepAliveTotals()).toEqual({ count: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costMicroUsd: 0 });
  });

  it('recordKeepAlive_negative_throws', () => {
    const { deps } = memoryDeps();
    const store = new RewindStateStore(deps);

    expect(() => store.recordKeepAlive(SESSION, { cacheReadTokens: -1, cacheCreationTokens: null, costMicroUsd: null })).toThrow('-1');
    expect(() => store.recordKeepAlive(SESSION, { cacheReadTokens: null, cacheCreationTokens: null, costMicroUsd: 1.5 })).toThrow('1.5');
    expect(store.keepAliveTotals().count).toBe(0);
  });

  it('keepAliveTotals_sumsAll', () => {
    const { deps } = memoryDeps();
    const store = new RewindStateStore(deps);

    store.recordKeepAlive(SESSION, { cacheReadTokens: 10, cacheCreationTokens: 1, costMicroUsd: 7 });
    store.recordKeepAlive(TARGET, { cacheReadTokens: 20, cacheCreationTokens: 2, costMicroUsd: 8 });

    expect(store.keepAliveTotals()).toEqual({ count: 2, cacheReadTokens: 30, cacheCreationTokens: 3, costMicroUsd: 15 });
  });

  it('forgetThread_withKeepAlive_removesIt', () => {
    const { deps } = memoryDeps();
    const store = new RewindStateStore(deps);
    store.recordKeepAlive(SESSION, { cacheReadTokens: 10, cacheCreationTokens: 1, costMicroUsd: 7 });

    store.forgetThread(SESSION);

    expect(store.keepAliveTotals().count).toBe(0);
  });
});
