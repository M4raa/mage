import { IpcChannel } from '@shared/ipc';
import type { SaveConversationPrefsParams } from '@shared/ipc';
import type { ConversationPrefs } from '@shared/conversationIndex';
import type { ConversationIndexStore } from '../state/conversationIndexStore';
import type { IpcRegister } from './sessionIpc';
import type { SessionCoordinator } from './sessionCoordinator';

// Preferencias por conversacion (modelo, esfuerzo, modo, reglas) por IPC. El renderer las pide con el id
// que tenga a mano: el de la sesion viva (en Codex y agy, el de Mage, que no es el nativo) o el nativo de
// la conversacion que reabre. Las dos llevan a la MISMA entrada: la sesion viva se traduce a su
// ConversationId, y el indice encuentra la conversacion por su id nativo (F2.1).
export interface ConversationPrefsIpcDeps {
  readonly handle: IpcRegister;
  readonly index: () => Pick<ConversationIndexStore, 'loadPrefs' | 'savePrefs'>;
  readonly coordinator: Pick<SessionCoordinator, 'conversationIdOf'>;
}

export function registerConversationPrefsIpc(deps: ConversationPrefsIpcDeps): void {
  const keyOf = (id: string): string => deps.coordinator.conversationIdOf(id) ?? id;
  deps.handle(IpcChannel.ConversationPrefsLoad, (_e, id): ConversationPrefs | null => deps.index().loadPrefs(keyOf(id as string)));
  deps.handle(IpcChannel.ConversationPrefsSave, (_e, arg) => {
    const params = arg as SaveConversationPrefsParams;
    deps.index().savePrefs(keyOf(params.sessionId), params.prefs);
  });
}
