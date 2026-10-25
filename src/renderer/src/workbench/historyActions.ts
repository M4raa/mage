import type { MageApi } from '@shared/ipc';
import type { WorkbenchState } from './workbenchStore';
import { AGY_PROVIDER_ID, CODEX_PROVIDER_ID } from '@shared/providers';

// Historial de conversaciones y proyectos de chat (F2.5, division del store por dominio): cargar la lista de la
// cuenta activa y organizar las conversaciones en proyectos. Fuera de `workbenchStore.ts` como las de PR y
// ajustes; el store las mezcla tal cual. Este modulo es el UNICO que escribe `conversationHistory`.

// Proveedores cuyo historial en disco sabe leer Mage (un lector por CLI: el de Claude y el rollout de Codex).
const HISTORY_PROVIDERS: readonly string[] = ['claude', CODEX_PROVIDER_ID, AGY_PROVIDER_ID];

export type HistoryActions = Pick<WorkbenchState, 'saveChatProject' | 'deleteChatProject' | 'assignChatProject' | 'loadConversationHistory'>;

export interface HistoryDeps {
  readonly mage: MageApi;
  readonly get: () => WorkbenchState;
  readonly set: (fn: ((s: WorkbenchState) => Partial<WorkbenchState>) | Partial<WorkbenchState>) => void;
  readonly persistSettings: () => void;
  readonly persistTabs: () => void;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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

    // Carga el historial en disco de la cuenta activa (M2.6). Tolerante: un fallo no rompe el shell.
    loadConversationHistory: async () => {
      const accountId = get().activeAccountId;
      if (accountId.length === 0 || !HISTORY_PROVIDERS.includes(get().accounts.find((account) => account.id === accountId)?.providerId ?? '')) {
        set({ conversationHistory: [] });
        return;
      }
      try {
        const list = await mage.listConversations(accountId);
        if (get().activeAccountId !== accountId) return; // cambio de cuenta mientras cargaba: descartar
        set({ conversationHistory: list });
      } catch (err) {
        console.warn('No se pudo cargar el historial de conversaciones:', describeError(err));
      }
    },
  };
}
