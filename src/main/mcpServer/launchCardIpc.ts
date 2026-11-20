import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { IpcChannel } from '@shared/ipc';
import { parseSessionInput, SESSION_ID_SCHEMA } from '@shared/sessionInput';
import type { PendingLaunches } from './pendingLaunches';

// Canales de la tarjeta «Lanzar». FRONTERA: la entrada se valida con Zod y solo contesta la ventana que controla la
// sesión creadora (su dueña o la principal, la misma regla que el resto de órdenes sobre una sesión).

const MAX_CHOICE_CHARS = 200;
const choice = z.string().min(1).max(MAX_CHOICE_CHARS).optional();
export const LAUNCH_DELEGATED_SCHEMA = z.object({ conversationId: SESSION_ID_SCHEMA, model: choice, effort: choice }).strict();

export interface LaunchCardIpcDeps {
  readonly handle: (channel: string, listener: (event: IpcMainInvokeEvent, arg: unknown) => unknown) => void;
  readonly pending: Pick<PendingLaunches, 'find' | 'launch' | 'cancel'>;
  readonly canControl: (senderId: number, sessionId: string) => boolean;
}

export function registerLaunchCardIpc(deps: LaunchCardIpcDeps): void {
  const { handle, pending } = deps;
  handle(IpcChannel.DelegationLaunch, async (event, arg) => {
    const { conversationId, model, effort } = parseSessionInput(LAUNCH_DELEGATED_SCHEMA, arg, IpcChannel.DelegationLaunch);
    authorizeCreator(deps, event.sender.id, conversationId, IpcChannel.DelegationLaunch);
    await pending.launch(conversationId, { ...(model === undefined ? {} : { model }), ...(effort === undefined ? {} : { effort }) });
  });
  handle(IpcChannel.DelegationCancelLaunch, (event, arg) => {
    const conversationId = parseSessionInput(SESSION_ID_SCHEMA, arg, IpcChannel.DelegationCancelLaunch);
    authorizeCreator(deps, event.sender.id, conversationId, IpcChannel.DelegationCancelLaunch);
    pending.cancel(conversationId);
  });
}

function authorizeCreator(deps: LaunchCardIpcDeps, senderId: number, conversationId: string, channel: string): void {
  const found = deps.pending.find(conversationId);
  if (found === null) throw new Error(`${channel}: no hay ninguna sesión esperando a lanzarse con el id ${conversationId}`);
  if (!deps.canControl(senderId, found.launch.creatorSessionId)) {
    throw new Error(`${channel}: esta ventana no controla la sesión creadora ${found.launch.creatorSessionId}`);
  }
}
