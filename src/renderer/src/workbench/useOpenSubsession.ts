import { useCallback } from 'react';
import { useT } from '../i18n/uiLanguage';
import { findSubsession } from './delegationView';
import { notify } from './notificationStore';
import { accountToOpenWith } from './sidebarModel';
import { useWorkbenchStore } from './workbenchStore';

// Abre una subsesión por su id de conversación: la pestaña si está abierta; si no, la fila del historial cargado
// (con la misma regla de cuenta que el lateral); y si tampoco está, lo dice con un aviso informativo.
export function useOpenSubsession(): (conversationId: string) => void {
  const t = useT();
  return useCallback((conversationId: string): void => {
    const state = useWorkbenchStore.getState();
    const target = findSubsession(conversationId, { tabs: state.tabs, sessionIdByChat: state.sessionIdByChat, history: state.allConversationHistory });
    if (target.kind === 'tab') {
      state.setActiveTab(target.tabId);
      return;
    }
    if (target.kind === 'history') {
      const { item, accountId } = target.entry;
      const active = state.accounts.find((account) => account.id === state.activeAccountId);
      const row = { kind: 'history', item, accountId } as const;
      void state.openConversation(item, accountToOpenWith(row, active === undefined ? undefined : { id: active.id, providerId: active.providerId }));
      return;
    }
    notify({ level: 'info', title: t('chat.delegation.cardMissing'), source: 'delegation', dedupeKey: 'delegation-missing' });
  }, [t]);
}
