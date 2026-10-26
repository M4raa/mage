import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@shared/ipc';
import type { ConversationLocks } from './conversationLocks';
import { registerConversationLockIpc, type LockIpcEvent } from './conversationLockIpc';

const PARAMS = { provider: 'claude', accountDir: '/home/u/.claude', nativeId: 'c1', tabId: 't1' };

function setup() {
  const handlers = new Map<string, (event: LockIpcEvent, raw: unknown) => unknown>();
  const locks = {
    acquire: vi.fn((_ref: unknown, _holder: string) => ({ owner: true })),
    takeOver: vi.fn((_ref: unknown, _holder: string) => ({ owner: true })),
    release: vi.fn((_ref: unknown, _holder: string) => undefined),
    releaseWhere: vi.fn((_matches: (holder: string) => boolean) => undefined),
  };
  registerConversationLockIpc({ handle: (channel, listener) => { handlers.set(channel, listener); } }, () => locks as unknown as ConversationLocks);
  const destroyed: (() => void)[] = [];
  const sender = (id: number) => ({ id, once: (_event: 'destroyed', listener: () => void) => { destroyed.push(listener); } });
  const call = (channel: string, raw: unknown, id = 7) => handlers.get(channel)!({ sender: sender(id) }, raw);
  return { locks, call, destroyed };
}

describe('registerConversationLockIpc', () => {
  it('acquire_sujetaPorVentanaYPestana', () => {
    const { locks, call } = setup();

    expect(call(IpcChannel.ConversationLockAcquire, PARAMS)).toEqual({ owner: true });

    expect(locks.acquire).toHaveBeenCalledWith({ provider: 'claude', accountDir: '/home/u/.claude', nativeId: 'c1' }, 'tab:7:t1');
  });

  it.each([
    [{ ...PARAMS, nativeId: '' }],
    [{ ...PARAMS, extra: 1 }],
    [{ provider: 'claude', nativeId: 'c1', tabId: 't1' }],
    ['texto'],
  ])('acquire_entradaInvalida_lanzaSinTocarLosLocks_%#', (raw) => {
    const { locks, call } = setup();

    expect(() => call(IpcChannel.ConversationLockAcquire, raw)).toThrow(/Entrada inválida en conversation-lock:acquire/);
    expect(locks.acquire).not.toHaveBeenCalled();
  });

  it('takeOverYRelease_conElMismoDueno', () => {
    const { locks, call } = setup();

    call(IpcChannel.ConversationLockTakeOver, PARAMS);
    call(IpcChannel.ConversationLockRelease, PARAMS);

    expect(locks.takeOver.mock.calls[0]?.[1]).toBe('tab:7:t1');
    expect(locks.release.mock.calls[0]?.[1]).toBe('tab:7:t1');
  });

  it('ventanaDestruida_sueltaSoloLoSuyoYSeVigilaUnaVez', () => {
    const { locks, call, destroyed } = setup();
    call(IpcChannel.ConversationLockAcquire, PARAMS);
    call(IpcChannel.ConversationLockAcquire, { ...PARAMS, tabId: 't2' });

    expect(destroyed).toHaveLength(1);
    destroyed[0]!();

    const matches = locks.releaseWhere.mock.calls[0]?.[0] as (holder: string) => boolean;
    expect(matches('tab:7:t1')).toBe(true);
    expect(matches('tab:70:t1')).toBe(false);
    expect(matches('session:s1')).toBe(false);
  });
});
