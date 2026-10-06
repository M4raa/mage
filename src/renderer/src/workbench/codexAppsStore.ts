import { create } from 'zustand';
import type { CodexAccountMetadata } from '@shared/mcp';

export interface CodexAppsApi { readonly readCodexApps: (home: string) => Promise<CodexAccountMetadata> }
interface CodexAppsState {
  readonly results: Readonly<Record<string, CodexAccountMetadata>>;
  readonly loading: boolean;
  refresh: (homes: readonly string[]) => Promise<void>;
}

export function createCodexAppsStore(api: CodexAppsApi) {
  return create<CodexAppsState>((set, get) => ({
    results: {}, loading: false,
    refresh: async (homes) => {
      if (get().loading) return;
      set({ loading: true });
      try {
        await queryAccounts(api, homes, (home, value) => set((state) => ({ results: { ...state.results, [home]: value } })));
      } finally { set({ loading: false }); }
    },
  }));
}

async function queryAccounts(api: CodexAppsApi, homes: readonly string[], receive: (home: string, value: CodexAccountMetadata) => void): Promise<void> {
  for (const home of homes) {
    const value = await api.readCodexApps(home).catch((): CodexAccountMetadata => ({ authenticated: null, apps: null, error: 'No se pudieron consultar las Apps de esta cuenta.' }));
    receive(home, value);
  }
}

export const useCodexAppsStore = createCodexAppsStore({ readCodexApps: (home) => window.mage.readCodexApps(home) });
