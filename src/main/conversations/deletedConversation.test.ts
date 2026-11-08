import { describe, expect, it, vi } from 'vitest';
import { forgetDeletedConversation } from './deletedConversation';
import { RewindStateStore, type RewindStateStoreDeps } from './rewindStateStore';

const PATH = '/data/rewind-state.json';
const SESSION = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

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

describe('forgetDeletedConversation', () => {
  it('forgetDeletedConversation_llamaALosCuatroAlmacenes_conElMismoId', () => {
    const index = { forgetConversation: vi.fn() };
    const prCatalog = { forgetConversation: vi.fn() };
    const thinking = { forget: vi.fn() };
    const rewindState = { forgetThread: vi.fn() };

    forgetDeletedConversation({ index, prCatalog, thinking, rewindState }, SESSION);

    expect(index.forgetConversation).toHaveBeenCalledExactlyOnceWith(SESSION);
    expect(prCatalog.forgetConversation).toHaveBeenCalledExactlyOnceWith(SESSION);
    expect(thinking.forget).toHaveBeenCalledExactlyOnceWith(SESSION);
    expect(rewindState.forgetThread).toHaveBeenCalledExactlyOnceWith(SESSION);
  });

  it('forgetDeletedConversation_conversacionDeClaudeConEntradas_desaparecenDelRewindState', () => {
    const { deps, files } = memoryDeps();
    const store = new RewindStateStore(deps);
    store.setPendingCut(SESSION, TARGET);
    store.recordFork(SESSION, 'parent-1', 'claude', 1);
    store.recordKeepAlive(SESSION, { cacheReadTokens: 1, cacheCreationTokens: 0, costMicroUsd: 2 });
    store.setPendingCut(OTHER, TARGET);

    forgetDeletedConversation({ index: { forgetConversation: vi.fn() }, prCatalog: { forgetConversation: vi.fn() }, thinking: { forget: vi.fn() }, rewindState: store }, SESSION);

    const reloaded = new RewindStateStore(memoryDeps(files).deps);
    for (const s of [store, reloaded]) {
      expect(s.pendingCut(SESSION)).toBeNull();
      expect(s.forkOf(SESSION)).toBeNull();
      expect(s.keepAliveTotals().count).toBe(0);
      expect(s.pendingCut(OTHER)).toBe(TARGET);
    }
  });

  it('forgetDeletedConversation_sinRastroEnRewindState_noEscribe', () => {
    const { deps, writeFile } = memoryDeps();

    forgetDeletedConversation({ index: { forgetConversation: vi.fn() }, prCatalog: { forgetConversation: vi.fn() }, thinking: { forget: vi.fn() }, rewindState: new RewindStateStore(deps) }, SESSION);

    expect(writeFile).not.toHaveBeenCalled();
  });
});
