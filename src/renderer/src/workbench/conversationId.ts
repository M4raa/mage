import { ownsConversation } from '@shared/providers';
import type { Tab } from './types';

// Id de la CONVERSACIÓN de una pestaña: el que se persiste, con el que se lee su transcripción y el que lleva el
// historial (proyectos, mover, borrar, el lock entre instancias). En Codex y agy es el id del hilo que dio el CLI
// (`resumeSessionId`) y NUNCA el de la sesión viva de Mage, que es un UUID propio: guardar ese UUID dejaba la
// pestaña vacía al reabrir Mage (devolución 19). Sin hilo todavía (el turno no llegó al `session_init`) no hay
// conversación. En Claude y el runtime propio los dos ids coinciden: la viva si la hay, si no la que se reanuda.
// Lo que habla con main sobre la sesión (enviar, interrumpir, eventos) usa `sessionIdByChat`, no esto.
export function conversationIdOfTab(tab: Pick<Tab, 'provider' | 'resumeSessionId'>, liveSessionId: string | undefined): string | undefined {
  if (ownsConversation(tab.provider)) return tab.resumeSessionId;
  return liveSessionId ?? tab.resumeSessionId;
}
