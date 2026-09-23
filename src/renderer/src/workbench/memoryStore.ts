import { create } from 'zustand';
import type { ReadMemoryParams } from '@shared/ipc';
import { buildMemoryView, type MemoryView } from './memoryView';

interface MemoryStoreState {
  readonly view: MemoryView | null;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  // Últimos params cargados; sirven de identidad (descarta resultados tardíos de una carga ya
  // reemplazada) y permiten refrescar sin que el panel los reconozca.
  readonly lastParams: ReadMemoryParams | null;
  load: (params: ReadMemoryParams) => Promise<void>;
  refresh: () => void;
}

// Store dedicado a la memoria del proyecto (dominio propio; no engorda workbenchStore). A diferencia
// de las transcripciones NO hay streaming ni cancelación: los .md son pequeños (KB) y se leen de una
// vez por invoke. El guard `lastParams !== params` descarta la respuesta de una carga que ya fue
// reemplazada por un cambio de proyecto (identidad por referencia del objeto de params).
export const useMemoryStore = create<MemoryStoreState>((set, get) => ({
  view: null,
  isLoading: false,
  errorMessage: null,
  lastParams: null,

  load: async (params) => {
    set({ isLoading: true, errorMessage: null, lastParams: params });
    try {
      const files = await window.mage.readMemory(params);
      if (get().lastParams !== params) return; // otra carga (otro proyecto) ya la reemplazó
      set({ view: buildMemoryView(files), isLoading: false });
    } catch (err) {
      if (get().lastParams !== params) return;
      set({ errorMessage: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  refresh: () => {
    const { lastParams } = get();
    if (lastParams !== null) void get().load(lastParams);
  },
}));
