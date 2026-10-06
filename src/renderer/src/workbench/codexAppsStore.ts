import { create } from 'zustand';
import type { CodexAccountMetadata } from '@shared/mcp';

export interface CodexAppsApi { readonly readCodexApps: (home: string) => Promise<CodexAccountMetadata> }
interface CodexAppsState {
  readonly results: Readonly<Record<string, CodexAccountMetadata>>;
  readonly loading: boolean;
  refresh: (homes: readonly string[]) => Promise<void>;
}
type SetAppsState = (update: Partial<CodexAppsState> | ((state: CodexAppsState) => Partial<CodexAppsState>)) => void;
interface RefreshContext { readonly api: CodexAppsApi; readonly set: SetAppsState; readonly get: () => CodexAppsState }

export function createCodexAppsStore(api: CodexAppsApi) {
  return create<CodexAppsState>((set, get) => ({
    results: {}, loading: false,
    refresh: (homes) => refreshApps({ api, set, get }, homes),
  }));
}

async function refreshApps(ctx: RefreshContext, homes: readonly string[]): Promise<void> {
  if (ctx.get().loading) return;
  ctx.set({ loading: true });
  try {
    await queryAccounts(ctx.api, homes, (home, value) => storeResult(ctx.set, home, value));
  } finally { ctx.set({ loading: false }); }
}

function storeResult(set: SetAppsState, home: string, value: CodexAccountMetadata): void {
  set((state) => ({ results: { ...state.results, [home]: value } }));
}

async function queryAccounts(api: CodexAppsApi, homes: readonly string[], receive: (home: string, value: CodexAccountMetadata) => void): Promise<void> {
  for (const home of homes) {
    const value = await api.readCodexApps(home).catch((): CodexAccountMetadata => ({ authenticated: null, apps: null, error: 'No se pudieron consultar las Apps de esta cuenta.' }));
    receive(home, value);
  }
}

export const useCodexAppsStore = createCodexAppsStore({ readCodexApps: (home) => window.mage.readCodexApps(home) });
