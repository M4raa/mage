import type { MageApi } from '@shared/ipc';
import type { WorkbenchState } from './workbenchStore';
import { AGY_PROVIDER_ID, CODEX_PROVIDER_ID } from '@shared/providers';
import { describeError } from './describeError';
import { conversationIdOfTab } from './conversationId';
import { mergeAccountHistories, type AccountHistory } from './sidebarModel';
import type { ConversationSummary } from '@shared/conversations';

// Historial de conversaciones y proyectos de chat (F2.5, division del store por dominio): cargar la lista de la
// cuenta activa y organizar las conversaciones en proyectos. Fuera de `workbenchStore.ts` como las de PR y
// ajustes; el store las mezcla tal cual. Este modulo es el UNICO que escribe `conversationHistory`.

// Proveedores cuyo historial en disco sabe leer Mage (un lector por CLI: el de Claude y el rollout de Codex).
const HISTORY_PROVIDERS: readonly string[] = ['claude', CODEX_PROVIDER_ID, AGY_PROVIDER_ID];

const HISTORY_PROVIDERS_SET: ReadonlySet<string> = new Set(HISTORY_PROVIDERS);

// Añade o quita `id` de una lista de ids sin duplicar; devuelve la misma lista si no cambia nada.
export function withIdPresence(list: readonly string[], id: string, present: boolean): readonly string[] {
  if (list.includes(id) === present) return list;
  return present ? [...list, id] : list.filter((candidate) => candidate !== id);
}

export type HistoryActions = Pick<WorkbenchState, 'saveChatProject' | 'deleteChatProject' | 'assignChatProject' | 'loadConversationHistory' | 'togglePinnedConversation' | 'setConversationArchived'>;

export interface HistoryDeps {
  readonly mage: MageApi;
  readonly get: () => WorkbenchState;
  readonly set: (fn: ((s: WorkbenchState) => Partial<WorkbenchState>) | Partial<WorkbenchState>) => void;
  readonly persistSettings: () => void;
  readonly persistTabs: () => void;
}

export function createHistoryActions(deps: HistoryDeps): HistoryActions {
  const { mage, get, set } = deps;
  return {
    saveChatProject: async (project) => {
      const clean = { ...project, name: project.name.trim(), instructions: project.instructions.trim(), cwd: project.cwd?.trim() || null };
      if (clean.name.length === 0) return;
      set((s) => ({ settings: { ...s.settings, chatProjects: [...s.settings.chatProjects.filter((p) => p.id !== clean.id), clean] } }));
      await mage.saveSettings(get().settings);
    },
    deleteChatProject: (projectId) => {
      set((s) => ({
        settings: { ...s.settings, chatProjects: s.settings.chatProjects.filter((p) => p.id !== projectId) },
        tabs: s.tabs.map((t) => t.projectId === projectId ? { ...t, projectId: undefined } : t),
      }));
      deps.persistSettings();
      deps.persistTabs();
    },
    assignChatProject: (sessionId, tabId, projectId) => {
      set((s) => ({
        settings: { ...s.settings, chatProjects: s.settings.chatProjects.map((p) => ({
          ...p, sessionIds: projectId === p.id && sessionId !== undefined
            ? [...new Set([...p.sessionIds, sessionId])]
            : p.sessionIds.filter((id) => id !== sessionId),
        })) },
        tabs: tabId === undefined ? s.tabs : s.tabs.map((t) => t.id === tabId ? { ...t, projectId: projectId ?? undefined } : t),
      }));
      deps.persistSettings();
      deps.persistTabs();
    },

    // Fija o desfija una conversación en el lateral. Si hay pestaña abierta de esa conversación, su `pinned` queda
    // igual al nuevo valor.
    togglePinnedConversation: (sessionId) => {
      const pin = !get().settings.pinnedConversations.includes(sessionId);
      set((s) => ({
        settings: { ...s.settings, pinnedConversations: withIdPresence(s.settings.pinnedConversations, sessionId, pin) },
        tabs: s.tabs.map((t) => (conversationIdOfTab(t, s.sessionIdByChat[t.id]) === sessionId ? { ...t, pinned: pin } : t)),
      }));
      deps.persistSettings();
      deps.persistTabs();
    },

    // Archiva o desarchiva una conversación (sale del lateral salvo con el chip «Archivadas»).
    setConversationArchived: (sessionId, archived) => {
      set((s) => ({ settings: { ...s.settings, archivedConversations: withIdPresence(s.settings.archivedConversations, sessionId, archived) } }));
      deps.persistSettings();
    },

    // Carga el historial en disco de TODAS las cuentas con historial (la activa primero). `conversationHistory` sigue
    // siendo el de la cuenta activa; `allConversationHistory` es la fusión para el lateral. Tolerante: una cuenta que
    // falla se avisa y no impide las demás.
    loadConversationHistory: async () => {
      const activeId = get().activeAccountId;
      const accounts = get().accounts.filter((account) => HISTORY_PROVIDERS_SET.has(account.providerId));
      const ordered = [...accounts.filter((a) => a.id === activeId), ...accounts.filter((a) => a.id !== activeId)];
      const results = await Promise.allSettled(ordered.map(async (account) => mage.listConversations(account.id)));
      if (get().activeAccountId !== activeId) return; // cambio de cuenta mientras cargaba: descartar
      const lists: AccountHistory[] = [];
      results.forEach((result, index) => {
        const accountId = ordered[index]?.id ?? '';
        if (result.status === 'rejected') {
          console.warn('No se pudo cargar el historial de conversaciones:', describeError(result.reason));
          return;
        }
        lists.push({ accountId, items: result.value });
      });
      const active = lists.find((list) => list.accountId === activeId);
      const activeHasHistory = ordered.some((account) => account.id === activeId);
      const activeItems: readonly ConversationSummary[] | undefined = active?.items ?? (activeHasHistory ? undefined : []);
      set({
        allConversationHistory: mergeAccountHistories(lists),
        ...(activeItems === undefined ? {} : { conversationHistory: activeItems }),
      });
    },
  };
}
