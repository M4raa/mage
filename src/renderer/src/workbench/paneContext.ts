import { createContext, useContext } from 'react';
import type { StoreApi, UseBoundStore } from 'zustand';
import { useWorkbenchStore } from './workbenchStore';
import { transcriptStoreForTab, type TranscriptStoreState } from './transcriptStore';

// Que conversacion pinta CADA panel del centro cuando el workspace esta dividido (Ronda 3, item 13).
//
// Por que un contexto y no una prop: `BlockChat`/`PromptBar` leen el estado del motor por `tabId` en
// una veintena de selectores repartidos entre cinco subcomponentes. Un contexto cambia la respuesta a
// "¿de que pestaña hablo?" en un solo sitio, sin enhebrar la prop por toda la jerarquia.
//
// Sin proveedor (todo lo que vive FUERA del centro: dock, sidebar, atajos, widget) sigue valiendo el
// `activeTabId` global, que por invariante es SIEMPRE el del panel enfocado. Por eso dividir el
// workspace no obliga a tocar ninguno de esos consumidores: siguen mostrando "la conversacion en la
// que estas trabajando", que es lo que ya significaban.
const PaneTabContext = createContext<string | null>(null);

export const PaneTabProvider = PaneTabContext.Provider;

export function usePaneTabId(): string {
  const fromPane = useContext(PaneTabContext);
  const globalActive = useWorkbenchStore((s) => s.activeTabId);
  return fromPane ?? globalActive;
}

// El store de transcripcion que le toca a quien pregunta (4.1). Misma regla que `usePaneTabId`, y por
// el mismo motivo: dentro de un `ChatPane` es la conversacion de ESE panel (asi el panel no enfocado
// de un split hidrata con su propia transcripcion, 4.3); fuera es la pestaña ACTIVA, que es lo que ya
// significaban Logs, Contexto, Agentes y la StatusBar.
//
// Devuelve el hook, no el estado: el llamador aplica su propio selector y solo se re-renderiza con lo
// que mira. Que la identidad del hook cambie al cambiar de pestaña es correcto — zustand se apoya en
// `useSyncExternalStore`, que se re-suscribe cuando cambia la funcion de suscripcion.
export function usePaneTranscriptStore(): UseBoundStore<StoreApi<TranscriptStoreState>> {
  return transcriptStoreForTab(usePaneTabId());
}
