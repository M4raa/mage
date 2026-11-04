import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@shared/ipc';
import { registerPrIpc, type PrIpcDeps } from './prIpc';

const HEAD = 'a'.repeat(40);
const FOLDER = { cwd: '/r', accountDir: '/acc' };
const KEY = { host: 'github.com', owner: 'Acme', repo: 'demo', number: 7 };

function setup(): { call: (channel: string, arg?: unknown) => unknown; gh: Record<string, ReturnType<typeof vi.fn>>; assertFolder: ReturnType<typeof vi.fn> } {
  const handlers = new Map<string, (e: never, arg: unknown) => unknown>();
  const gh = { listPrs: vi.fn(), prDetail: vi.fn(), prDiff: vi.fn(), writePr: vi.fn() };
  const assertFolder = vi.fn();
  const deps = {
    handle: ((channel, listener) => void handlers.set(channel, listener)) satisfies PrIpcDeps['handle'],
    gh: () => gh,
    catalog: () => ({ list: vi.fn(() => []), link: vi.fn(), unlink: vi.fn() }),
    migrate: vi.fn(async () => null),
    assertFolder,
  } as unknown as PrIpcDeps;
  registerPrIpc(deps);
  return { call: (channel, arg) => handlers.get(channel)!(null as never, arg), gh, assertFolder };
}

describe('registerPrIpc', () => {
  it('prWrite_validParams_normalizesKeyAndCallsService', () => {
    const { call, gh, assertFolder } = setup();

    call(IpcChannel.PrWrite, { ...FOLDER, key: KEY, expectedHeadSha: HEAD, action: { kind: 'merge', strategy: 'squash', deleteBranch: false } });

    expect(assertFolder).toHaveBeenCalledWith(FOLDER);
    expect(gh.writePr).toHaveBeenCalledWith({ ...FOLDER, key: { ...KEY, owner: 'acme' }, expectedHeadSha: HEAD, action: { kind: 'merge', strategy: 'squash', deleteBranch: false } });
  });

  it('prWrite_badAction_throwsWithValue', () => {
    const { call, gh } = setup();
    const write = (action: unknown): unknown => call(IpcChannel.PrWrite, { ...FOLDER, key: KEY, expectedHeadSha: HEAD, action });

    expect(() => write({ kind: 'admin-merge' })).toThrow('admin-merge');
    expect(() => write({ kind: 'merge', strategy: 'octopus', deleteBranch: false })).toThrow('octopus');
    expect(() => write({ kind: 'comment', body: 5 })).toThrow('5');
    expect(gh.writePr).not.toHaveBeenCalled();
  });

  it('prDetail_keyWithSlashInOwner_throws', () => {
    const { call, gh } = setup();

    expect(() => call(IpcChannel.PrDetail, { ...FOLDER, key: { ...KEY, owner: 'acme/demo', repo: 'x' } })).toThrow('acme/demo');
    expect(() => call(IpcChannel.PrDetail, { ...FOLDER, key: { ...KEY, number: 1.5 } })).toThrow('1.5');
    expect(gh.prDetail).not.toHaveBeenCalled();
  });

  it('prList_validParams_passesNormalizedRepo', () => {
    const { call, gh } = setup();

    call(IpcChannel.PrList, { ...FOLDER, repo: { host: 'GitHub.com', owner: 'Acme', repo: 'Demo' }, state: 'draft', limit: 30 });

    expect(gh.listPrs).toHaveBeenCalledWith({ ...FOLDER, repo: { host: 'github.com', owner: 'acme', repo: 'demo' }, state: 'draft', limit: 30 });
    expect(() => call(IpcChannel.PrList, { ...FOLDER, repo: KEY, state: 'weird', limit: 30 })).toThrow('weird');
  });

  it('prCatalogLink_badKey_throwsWithValue', () => {
    const { call } = setup();

    expect(() => call(IpcChannel.PrCatalogLink, { key: 'github.com/../x#1', conversationId: 'c', primary: true })).toThrow('github.com/../x#1');
    expect(() => call(IpcChannel.PrCatalogList, 5)).toThrow('5');
  });
});
