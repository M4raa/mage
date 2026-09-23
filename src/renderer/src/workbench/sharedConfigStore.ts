import { create } from 'zustand';
import type { SharedConfigFile, SharedConfigSnapshot } from '@shared/ipc';

interface SharedConfigStoreState {
  readonly snapshot: SharedConfigSnapshot | null;
  readonly isLoading: boolean;
  readonly loadError: string | null;
  readonly savingByFile: Readonly<Record<SharedConfigFile, boolean>>;
  readonly saveErrorByFile: Readonly<Record<SharedConfigFile, string | null>>;
  load: () => Promise<void>;
  // Devuelve `true` solo si el fichero se escribio de verdad. `false` = rechazado (JSON invalido o el
  // fichero cambio fuera de Mage): el editor lo necesita para NO dar por guardado su borrador.
  save: (file: SharedConfigFile, text: string, expected: string | null) => Promise<boolean>;
}

const NOT_SAVING: Readonly<Record<SharedConfigFile, boolean>> = { 'mcp-common': false, 'settings-common': false };
const NO_SAVE_ERRORS: Readonly<Record<SharedConfigFile, string | null>> = { 'mcp-common': null, 'settings-common': null };

// Store dedicado a la config compartida entre cuentas (D1 Fase 2: mcp-common.json/
// settings-common.json). Dominio propio (no engorda workbenchStore), mismo patron que memoryStore:
// sin streaming, los ficheros son pequenos y se leen/escriben de una vez por invoke.
export const useSharedConfigStore = create<SharedConfigStoreState>((set, get) => ({
  snapshot: null,
  isLoading: false,
  loadError: null,
  savingByFile: NOT_SAVING,
  saveErrorByFile: NO_SAVE_ERRORS,

  load: async () => {
    set({ isLoading: true, loadError: null });
    try {
      const snapshot = await window.mage.loadSharedConfig();
      set({ snapshot, isLoading: false });
    } catch (err) {
      set({ loadError: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  // Guarda un fichero y recarga el snapshot ENTERO (no solo ese fichero): el guardado de mcp-common
  // cambia tambien mcpCommonServerNames, que el Inspector necesita al dia. Un fallo (JSON invalido)
  // se queda en saveErrorByFile, sin tocar el snapshot ya cargado.
  //
  // `stale` (el fichero cambio fuera de Mage) NO es una excepcion: se recarga el snapshot igualmente
  // para traer la baseline nueva -- asi el siguiente intento del usuario puede tener exito -- y se
  // devuelve false para que el editor conserve su borrador sin darlo por guardado.
  save: async (file, text, expected) => {
    set((s) => ({
      savingByFile: { ...s.savingByFile, [file]: true },
      saveErrorByFile: { ...s.saveErrorByFile, [file]: null },
    }));
    try {
      const result = await window.mage.saveSharedConfig({ file, text, expected });
      await get().load();
      if (result.status === 'stale') {
        set((s) => ({ saveErrorByFile: { ...s.saveErrorByFile, [file]: result.message } }));
        return false;
      }
      return true;
    } catch (err) {
      set((s) => ({
        saveErrorByFile: { ...s.saveErrorByFile, [file]: err instanceof Error ? err.message : String(err) },
      }));
      return false;
    } finally {
      set((s) => ({ savingByFile: { ...s.savingByFile, [file]: false } }));
    }
  },
}));
