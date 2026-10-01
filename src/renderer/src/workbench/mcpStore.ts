import { create } from 'zustand';
import type {
  McpAgySyncPreview,
  McpAgySyncResult,
  McpAgySyncState,
  McpCommonMutation,
  McpExtensionList,
  McpImportPick,
  McpImportPreview,
  McpInventory,
  McpStatusByAccount,
  McpStatusCache,
  McpWriteResult,
} from '@shared/mcp';
import { useSharedConfigStore } from './sharedConfigStore';
import { mcpAuthKey, mcpAuthMessage, type McpAuthMessage } from './mcpView';

// Store de «MCP y conectores» (P-028 puntos 5 y 34). Dominio propio, como sharedConfigStore. Lo que
// guarda nunca lleva valores de env/headers: el inventario trae nombres de clave, y los valores que
// devuelve «mostrar» se quedan en el estado local del editor, no aqui.
interface McpStoreState {
  readonly inventory: McpInventory | null;
  readonly projectDirs: readonly string[];
  readonly loadError: string | null;
  // Lo sondeado o guardado de cada cuenta (C3-e): la cache de main, con su fecha. `probed` son solo sus
  // servidores, que es lo que mezclan las vistas con lo que reportan las sesiones.
  readonly cache: McpStatusCache;
  readonly probed: McpStatusByAccount;
  readonly probing: boolean;
  readonly probeError: string | null;
  load: (projectDirs: readonly string[]) => Promise<void>;
  // Resultado del guardado; `stale` recarga igualmente para traer la huella nueva. Lanza si main
  // rechaza el borrador (el editor enseña el mensaje).
  mutate: (mutation: McpCommonMutation) => Promise<McpWriteResult>;
  previewImport: () => Promise<McpImportPreview>;
  applyImport: (picks: readonly McpImportPick[], expected: string | null) => Promise<McpWriteResult>;
  probeStatus: () => Promise<void>;
  loadCache: () => Promise<void>;
  // Extensiones .mcpb (pestaña Extensiones). `run` ejecuta una accion y recarga la lista y el inventario.
  readonly extensions: McpExtensionList | null;
  readonly extensionsError: string | null;
  loadExtensions: () => Promise<void>;
  runExtensionAction: (action: () => Promise<unknown>) => Promise<void>;
  // «Sincronizar con agy».
  readonly agy: McpAgySyncState | null;
  loadAgy: () => Promise<void>;
  previewAgy: (secretsConfirmed?: readonly string[]) => Promise<McpAgySyncPreview>;
  applyAgy: (expected: string | null, secretsConfirmed: readonly string[]) => Promise<McpAgySyncResult>;
  setAgyAuto: (auto: boolean) => Promise<void>;
  // «Autenticar» (punto 18): uno a la vez (el CLI de esa cuenta queda vivo esperando el navegador).
  // Clave `mcpAuthKey(cuenta, servidor)`.
  readonly authenticating: string | null;
  readonly authMessages: Readonly<Record<string, McpAuthMessage>>;
  authenticate: (accountDir: string, serverName: string) => Promise<void>;
}

export const useMcpStore = create<McpStoreState>((set, get) => ({
  inventory: null,
  projectDirs: [],
  loadError: null,
  cache: {},
  probed: {},
  probing: false,
  extensions: null,
  extensionsError: null,
  agy: null,
  probeError: null,
  authenticating: null,
  authMessages: {},

  load: async (projectDirs) => {
    set({ projectDirs, loadError: null });
    try {
      set({ inventory: await window.mage.loadMcpInventory({ projectDirs }) });
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : String(err) });
    }
  },

  mutate: async (mutation) => {
    const expected = get().inventory?.commonVersion ?? null;
    try {
      return await window.mage.mutateMcpCommon({ mutation, expected });
    } finally {
      await reloadAll(get);
    }
  },

  previewImport: () => window.mage.previewMcpImport({ projectDirs: get().projectDirs }),

  applyImport: async (picks, expected) => {
    try {
      return await window.mage.applyMcpImport({ picks, expected, projectDirs: get().projectDirs });
    } finally {
      await reloadAll(get);
    }
  },

  probeStatus: async () => {
    set({ probing: true, probeError: null });
    try {
      set(withCache(await window.mage.probeMcpStatus()));
    } catch (err) {
      set({ probeError: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ probing: false });
    }
  },

  loadCache: async () => {
    try {
      set(withCache(await window.mage.loadMcpStatusCache()));
    } catch (err) {
      set({ probeError: err instanceof Error ? err.message : String(err) });
    }
  },

  loadExtensions: async () => {
    try {
      set({ extensions: await window.mage.listMcpExtensions(), extensionsError: null });
    } catch (err) {
      set({ extensionsError: err instanceof Error ? err.message : String(err) });
    }
  },

  // Lanza si la accion falla (quien la llama enseña el mensaje); recarga igualmente.
  runExtensionAction: async (action) => {
    try {
      await action();
    } finally {
      await Promise.all([get().loadExtensions(), get().load(get().projectDirs), get().loadAgy()]);
    }
  },

  loadAgy: async () => {
    set({ agy: await window.mage.loadMcpAgySync() });
  },

  previewAgy: (secretsConfirmed) => window.mage.previewMcpAgySync(secretsConfirmed),

  applyAgy: async (expected, secretsConfirmed) => {
    try {
      return await window.mage.applyMcpAgySync(expected, secretsConfirmed);
    } finally {
      await Promise.all([get().loadAgy(), get().load(get().projectDirs), get().loadExtensions()]);
    }
  },

  setAgyAuto: async (auto) => {
    set({ agy: await window.mage.setMcpAgyAutoSync(auto) });
    await get().load(get().projectDirs);
  },

  authenticate: async (accountDir, serverName) => {
    const key = mcpAuthKey(accountDir, serverName);
    set((s) => ({ authenticating: key, authMessages: withoutKey(s.authMessages, key) }));
    let message: McpAuthMessage;
    try {
      const result = await window.mage.authenticateMcp({ accountDir, serverName });
      // El ultimo mcp_status de esa cuenta sustituye al sondeado: asi la fila cambia sin re-sondear todo.
      const statuses = result.kind === 'error' ? null : result.statuses;
      if (statuses !== null) set((s) => ({ probed: { ...s.probed, [accountDir]: statuses } }));
      // Main ya lo guardo con su fecha: se trae la cache para que la pestaña Conectores la enseñe.
      if (statuses !== null) await get().loadCache();
      message = mcpAuthMessage(result);
    } catch (err) {
      message = { ok: false, text: err instanceof Error ? err.message : String(err) };
    }
    set((s) => ({ authenticating: null, authMessages: { ...s.authMessages, [key]: message } }));
  },
}));

function withCache(cache: McpStatusCache): Pick<McpStoreState, 'cache' | 'probed'> {
  return { cache, probed: Object.fromEntries(Object.entries(cache).map(([accountDir, snapshot]) => [accountDir, snapshot.servers])) };
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

// Tras escribir mcp-common.json: el inventario (huella nueva) y el snapshot de la config compartida
// (nombres comunes que usa el Inspector).
async function reloadAll(get: () => McpStoreState): Promise<void> {
  await Promise.all([get().load(get().projectDirs), useSharedConfigStore.getState().load(), get().loadAgy()]);
}
