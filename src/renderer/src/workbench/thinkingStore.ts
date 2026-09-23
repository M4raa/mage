import { create } from 'zustand';

// Pensamientos que Mage guarda de una conversacion, porque el CLI los persiste VACIOS (medido: sus
// bloques `thinking` llevan solo la firma). Store propio y no un campo del de transcripcion porque no
// vienen del mismo sitio ni del mismo fichero: la transcripcion la escribe el CLI, esto lo escribe
// Mage.
//
// Indexado POR SESION, no de una en una (4.1): con el workspace dividido hay varios paneles
// hidratando a la vez, y con un solo hueco el ultimo `load` borraba los pensamientos del panel
// anterior — que se quedaba hidratando sin ellos. De paso desaparece la carrera de la respuesta
// tardia: cada una escribe en SU clave, asi que ninguna puede pisar a otra.
export interface ThinkingStoreState {
  readonly textsBySession: Readonly<Record<string, readonly string[]>>;
  load: (sessionId: string) => Promise<void>;
}

export const useThinkingStore = create<ThinkingStoreState>((set) => ({
  textsBySession: {},
  load: async (sessionId) => {
    if (sessionId.length === 0) return;
    try {
      const texts = await window.mage.readThinking(sessionId);
      set((s) => ({ textsBySession: { ...s.textsBySession, [sessionId]: texts } }));
    } catch (err) {
      // No es critico: sin esto el bloque "▸ Pensó" se queda como estaba, sin cuerpo. Se traza igual.
      console.warn('No se pudieron leer los pensamientos guardados:', err);
    }
  },
}));
