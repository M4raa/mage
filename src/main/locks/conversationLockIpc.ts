import { CONVERSATION_LOCK_PARAMS_SCHEMA, type ConversationLockParams, type ConversationLockRef, type ConversationLockStatus } from '@shared/conversationLock';
import { IpcChannel } from '@shared/ipc';
import { parseSessionInput } from '@shared/sessionInput';
import type { ConversationLocks } from './conversationLocks';

// IPC del bloqueo de conversación (#55, F2.8). Quien la sujeta es (ventana, pestaña): al cerrarse la ventana se
// sueltan todas las suyas. La entrada se valida en la frontera, como el resto del IPC de sesiones.

export interface LockIpcSender {
  readonly id: number;
  once(event: 'destroyed', listener: () => void): unknown;
}

export interface LockIpcEvent {
  readonly sender: LockIpcSender;
}

export interface LockIpcRegistrar {
  handle(channel: string, listener: (event: LockIpcEvent, raw: unknown) => unknown): void;
}

export function tabHolder(windowId: number, tabId: string): string {
  return `tab:${windowId}:${tabId}`;
}

export function registerConversationLockIpc(ipc: LockIpcRegistrar, locks: () => ConversationLocks): void {
  const watched = new Set<number>();
  // La primera vez que una ventana sujeta algo: al destruirse, se suelta todo lo suyo.
  const watch = (sender: LockIpcSender): void => {
    if (watched.has(sender.id)) return;
    watched.add(sender.id);
    sender.once('destroyed', () => {
      watched.delete(sender.id);
      locks().releaseWhere((holder) => holder.startsWith(tabHolder(sender.id, '')));
    });
  };
  const handle = (channel: string, act: (ref: ConversationLockRef, holder: string) => ConversationLockStatus | void): void =>
    ipc.handle(channel, (event, raw) => {
      const { tabId, ...ref }: ConversationLockParams = parseSessionInput(CONVERSATION_LOCK_PARAMS_SCHEMA, raw, channel);
      watch(event.sender);
      return act(ref, tabHolder(event.sender.id, tabId));
    });
  handle(IpcChannel.ConversationLockAcquire, (ref, holder) => locks().acquire(ref, holder));
  handle(IpcChannel.ConversationLockTakeOver, (ref, holder) => locks().takeOver(ref, holder));
  handle(IpcChannel.ConversationLockRelease, (ref, holder) => locks().release(ref, holder));
}
