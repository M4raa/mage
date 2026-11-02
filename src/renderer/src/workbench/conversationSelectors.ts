import type { ChatStatus } from './types';
import { useWorkbenchStore, type WorkbenchState } from './workbenchStore';

// Selectores por conversacion (F2.5, division del store). Un componente que pinta UNA conversacion se
// suscribe solo a lo suyo: con el mapa entero (`statusByChat`, `activeTabId`) en un padre, cada cambio de
// pestaña o de estado de cualquier conversacion re-renderizaba la lista completa (punto 4 de INFORME-015: el
// sidebar aparecia en el perfil del cambio de pestaña). Devuelven primitivos, asi que la comparacion por
// identidad de Zustand corta el re-render cuando lo de ESA conversacion no cambia.

export type ConversationSelector<T> = (state: WorkbenchState, tabId: string) => T;

export const selectChatStatus: ConversationSelector<ChatStatus> = (state, tabId) => state.statusByChat[tabId] ?? 'idle';

export const selectIsActiveTab: ConversationSelector<boolean> = (state, tabId) => state.activeTabId === tabId;

export function useConversation<T>(tabId: string, select: ConversationSelector<T>): T {
  return useWorkbenchStore((state) => select(state, tabId));
}
