import type { IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '@shared/ipc';
import { registerLaunchCardIpc } from './launchCardIpc';
import { PendingLaunches } from './pendingLaunches';
import type { PendingLaunch } from './pendingLaunches';

const CREATOR_WINDOW = 7;

function setup() {
  const listeners = new Map<string, (event: IpcMainInvokeEvent, arg: unknown) => unknown>();
  const pending = new PendingLaunches();
  const start = vi.fn(async () => undefined);
  const discard = vi.fn();
  const launch: PendingLaunch = {
    id: 'pend-1', creatorSessionId: 'caller-s', requestId: 'r1', since: '2026-11-20T10:00:00.000Z', start, discard,
    metadata: { conversationId: 'pend-1', title: 't', provider: 'claude', state: 'awaiting_launch', projectId: 'none', accountId: 'acc1', isPrivate: false, creatorChain: ['caller-c'] },
  };
  pending.add(launch);
  registerLaunchCardIpc({
    handle: (channel, listener) => { listeners.set(channel, listener); },
    pending,
    canControl: (senderId, sessionId) => senderId === CREATOR_WINDOW && sessionId === 'caller-s',
  });
  const invoke = (channel: string, senderId: number, arg: unknown) => listeners.get(channel)?.({ sender: { id: senderId } } as IpcMainInvokeEvent, arg);
  return { invoke, start, discard, pending };
}

describe('registerLaunchCardIpc', () => {
  it('launch_ventanaDeLaCreadora_arrancaConLoElegido', async () => {
    // Arrange
    const { invoke, start, pending } = setup();
    // Act
    await invoke(IpcChannel.DelegationLaunch, CREATOR_WINDOW, { conversationId: 'pend-1', model: 'haiku', effort: 'low' });
    // Assert
    expect(start).toHaveBeenCalledWith({ model: 'haiku', effort: 'low' });
    expect(pending.find('pend-1')).toBeNull();
  });
  it('launch_sinEleccion_arrancaConLoDeLaCuenta', async () => {
    const { invoke, start } = setup();
    await invoke(IpcChannel.DelegationLaunch, CREATOR_WINDOW, { conversationId: 'pend-1' });
    expect(start).toHaveBeenCalledWith({});
  });
  it('launch_otraVentana_rechazaSinArrancar', async () => {
    const { invoke, start } = setup();
    await expect(invoke(IpcChannel.DelegationLaunch, 99, { conversationId: 'pend-1' })).rejects.toThrow('no controla la sesión creadora caller-s');
    expect(start).not.toHaveBeenCalled();
  });
  it('launch_campoDeMas_rechaza', async () => {
    const { invoke, start } = setup();
    await expect(invoke(IpcChannel.DelegationLaunch, CREATOR_WINDOW, { conversationId: 'pend-1', permissionMode: 'bypassPermissions' })).rejects.toThrow(IpcChannel.DelegationLaunch);
    expect(start).not.toHaveBeenCalled();
  });
  it('launch_idDesconocido_rechaza', async () => {
    const { invoke } = setup();
    await expect(invoke(IpcChannel.DelegationLaunch, CREATOR_WINDOW, { conversationId: 'otro' })).rejects.toThrow('con el id otro');
  });
  it('cancel_ventanaDeLaCreadora_descarta', () => {
    const { invoke, discard, pending } = setup();
    invoke(IpcChannel.DelegationCancelLaunch, CREATOR_WINDOW, 'pend-1');
    expect(discard).toHaveBeenCalledTimes(1);
    expect(pending.find('pend-1')?.status).toBe('cancelled');
  });
  it('cancel_otraVentana_rechaza', () => {
    const { invoke, discard } = setup();
    expect(() => invoke(IpcChannel.DelegationCancelLaunch, 99, 'pend-1')).toThrow('no controla');
    expect(discard).not.toHaveBeenCalled();
  });
  it('cancel_idVacio_rechaza', () => {
    const { invoke } = setup();
    expect(() => invoke(IpcChannel.DelegationCancelLaunch, CREATOR_WINDOW, '')).toThrow(IpcChannel.DelegationCancelLaunch);
  });
});
