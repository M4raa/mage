import { useEffect, useRef } from 'react';
import { writesClaudeTranscript } from '@shared/providers';
import { useWorkbenchStore } from './workbenchStore';
import { transcriptStoreForTab } from './transcriptStore';
import { useThinkingStore } from './thinkingStore';
import type { ChatStatus } from './types';
import { latestCustomTitle } from './conversationTitle';

// Ciclo de vida de la lectura de la transcripcion de UNA pestaña (M2.2.2): abre, cancela y refresca
// la lectura que consumen el panel de Logs, el de Contexto y —lo que importa de verdad— la
// HIDRATACION del chat de una conversacion reanudada (`BlockChat.useHydrateFromTranscript`).
//
// Lo llama `ChatPane` con SU `tabId` (4.1), no `App` con el activo. El motivo es 4.3: con el workspace
// dividido solo se leia la transcripcion del panel enfocado, asi que el otro panel se quedaba con el
// chat vacio teniendo historial en disco. Un panel montado = una lectura viva, y como el panel
// enfocado es por invariante el de `activeTabId`, los consumidores globales (dock, StatusBar) siguen
// viendo lo que ya veian.
//
// Por que NO vive en `RightDock` (§3.5 del analisis, hallazgo colateral): estaba dentro de un
// componente que solo se monta cuando alguna zona del borde derecho esta ABIERTA, asi que **con el dock
// derecho cerrado Mage no leia ninguna transcripcion** y una conversacion reabierta del historial se
// quedaba con el chat vacio. La lectura no es del dock: es de la conversacion. `ChatPane` esta montado
// mientras la conversacion se ve, asi que `entries` existe pase lo que pase con los paneles.
//
// Un solo llamador por pestaña: dos `open()` sobre el MISMO store compiten, porque el primero que
// entra `cancel()`a al anterior. Sobre stores distintos (otra pestaña, o el drill-down de subagentes
// con `useSubagentTranscriptStore`) son independientes.
export function useTranscriptLifecycle(tabId: string): void {
  const configDir = useWorkbenchStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
    return tab === undefined ? undefined : (tab.resolvedConfigDir ?? tab.accountId);
  });
  const cwd = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId)?.cwd);
  // Sesion a mostrar: la viva si existe, o el resumeSessionId de una conversacion RESTAURADA (aun sin
  // sesion viva). Sin este fallback, al reabrir Mage no se cargaba la transcripcion y el chat quedaba
  // vacio (la hidratacion de BlockChat depende de estas entradas).
  const sessionId = useWorkbenchStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
    return s.sessionIdByChat[tabId] ?? tab?.resumeSessionId;
  });
  const chatStatus = useWorkbenchStore((s) => s.statusByChat[tabId]);
  // ¿Hay transcripcion que leer para esta pestaña? Solo la escriben los proveedores cuyo motor es el
  // CLI de Claude Code (E3: `agy` lleva la suya en su propia carpeta y en su propio formato).
  const hasTranscript = useWorkbenchStore((s) => {
    const provider = s.tabs.find((t) => t.id === tabId)?.provider;
    return provider === undefined || writesClaudeTranscript(provider);
  });
  const useTranscriptStore = transcriptStoreForTab(tabId);
  const openTranscript = useTranscriptStore((s) => s.open);
  const cancelTranscript = useTranscriptStore((s) => s.cancel);
  const refreshTranscript = useTranscriptStore((s) => s.refresh);
  const loadThinking = useThinkingStore((s) => s.load);
  // Nombre que la conversacion tiene en el CLI (`/rename`, P-026 1.6). Selector a una CADENA: zustand
  // compara por valor, asi que la pestaña solo se re-renderiza cuando el nombre cambia de verdad.
  const cliTitle = useTranscriptStore((s) => latestCustomTitle(s.entries));
  const renameTab = useWorkbenchStore((s) => s.renameTab);

  useEffect(() => {
    if (cliTitle === null) return;
    const tab = useWorkbenchStore.getState().tabs.find((t) => t.id === tabId);
    // Respaldo (P-028): el camino normal es la salida del `/rename` en `handleEvent`, que llega aunque
    // haya un turno en marcha. Un nombre puesto en Mage que aun no llego al CLI gana (D3): la
    // transcripcion trae el viejo. Un `/rename` tecleado despues borra ese pendiente al enviarse.
    if (tab === undefined || tab.pendingCliTitle !== undefined || tab.title === cliTitle) return;
    renameTab(tabId, cliTitle);
  }, [tabId, cliTitle, renameTab]);

  useEffect(() => {
    if (configDir === undefined || cwd === undefined || sessionId === undefined) return;
    // Proveedor sin transcripcion en el config dir (E3, `agy`): pedirla daria un error de "fichero
    // inexistente" en cada pestaña suya, que es peor que no ofrecer el panel.
    if (!hasTranscript) return;
    void openTranscript({ accountDir: configDir, cwd, sessionId });
    // Los pensamientos van APARTE de la transcripcion: son de Mage, no del CLI (que los persiste
    // vacios), y viven en otro fichero. Se piden a la vez porque se consumen a la vez, al hidratar.
    void loadThinking(sessionId);
    return () => cancelTranscript();
    // Reabre solo cuando cambia la sesion real a mostrar (nueva sesion en esta pestaña) o el store al
    // que se abre. `openTranscript`/`cancelTranscript` entran en las deps porque con un store por
    // pestaña su identidad ya no es constante.
  }, [configDir, cwd, sessionId, hasTranscript, openTranscript, cancelTranscript, loadThinking]);

  // Auto-refresco al TERMINAR cada interaccion: el CLI escribe la transcripcion mientras trabaja, asi
  // que releerla al pasar a `idle` es lo que hace que Logs/Contexto vean el turno recien acabado.
  const prevStatusRef = useRef<{ readonly sessionId: string; readonly status: ChatStatus | undefined } | null>(null);
  useEffect(() => {
    if (sessionId === undefined) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = { sessionId, status: chatStatus };
    if (prev === null || prev.sessionId !== sessionId) return; // montaje o cambio de sesion: no releer
    if (chatStatus === 'idle' && prev.status !== undefined && prev.status !== 'idle') {
      refreshTranscript();
    }
  }, [sessionId, chatStatus, refreshTranscript]);
}
