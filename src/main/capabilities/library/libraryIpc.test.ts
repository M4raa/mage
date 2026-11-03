import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@shared/ipc';
import { registerLibraryIpc } from './libraryIpc';
import type { LibraryService } from './libraryService';

type Listener = (event: unknown, arg: unknown) => unknown;

function setup() {
  const handlers = new Map<string, Listener>();
  const service = { view: vi.fn(), preview: vi.fn(), apply: vi.fn(async () => ({ status: 'done' })) };
  registerLibraryIpc({
    handle: (channel, listener) => void handlers.set(channel, listener),
    service: () => service as unknown as LibraryService,
  });
  const call = (channel: string, arg?: unknown): unknown => (handlers.get(channel) as Listener)(null, arg);
  return { handlers, service, call };
}

const VALID = { packageId: 'context7', engine: 'claude', accountDir: '/a/.claude' };

describe('registerLibraryIpc', () => {
  it('registerLibraryIpc_registersThreeChannels', () => {
    const { handlers } = setup();

    expect([...handlers.keys()].sort()).toEqual([IpcChannel.LibraryApply, IpcChannel.LibraryPreview, IpcChannel.LibraryView].sort());
  });

  it('libraryApply_invalidAction_throwsWithValue', () => {
    const { call } = setup();

    expect(() => call(IpcChannel.LibraryApply, { ...VALID, action: 'format' })).toThrow(/inválida.*format/);
  });

  it('libraryPreview_missingAccountDir_throws', () => {
    const { call } = setup();

    expect(() => call(IpcChannel.LibraryPreview, { packageId: 'context7', engine: 'claude' })).toThrow(/accountDir/);
  });

  it('libraryApply_validParams_callsServiceWithAction', async () => {
    const { call, service } = setup();

    await call(IpcChannel.LibraryApply, { ...VALID, action: 'install' });

    expect(service.apply).toHaveBeenCalledWith('install', VALID);
  });
});
