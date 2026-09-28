// Escucha GLOBAL de los atajos de scope 'global' (D5, PLAN-D5-KEYBINDINGS.md §2.3/§3.2). Se monta UNA
// vez en la raiz (App.tsx): funciona sin importar donde este el foco, salvo que haya un dialogo modal
// abierto. Los atajos de scope 'prompt' NO viven aqui: se resuelven donde ya esta el `onKeyDown` del
// textarea (PromptBar.tsx), que es quien tiene el estado local (texto, seleccion) que necesitan.
import { useEffect } from 'react';
import { headPermission, useWorkbenchStore } from '../workbenchStore';
import type { WorkbenchState } from '../workbenchStore';
import { usePanelLayoutStore } from '../panelLayoutStore';
import type { PanelId } from '@shared/panelLayout';
import { resolveKeyEvent } from './resolver';
import type { KeyEventLike } from './keyParser';
import { isMacPlatform } from './platform';
import { hasPendingQuestion } from '../engineBlocks';

const PANEL_TOGGLE_PREFIX = 'panel.toggle.';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  return target.isContentEditable;
}

function toKeyEventLike(e: KeyboardEvent): KeyEventLike {
  return { code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey };
}

// Cualquiera de los 4 modales reales abierto: el resolver global se apaga por completo mientras dure
// (el modal se queda con el teclado; su propio Escape/Tab los gestiona useDialogA11y, ajeno al catalogo).
function isAnyDialogOpen(state: WorkbenchState): boolean {
  return state.newTabOpen || state.addAccountOpen || state.handoffOpen || state.settingsOpen || state.accountSwitchPrompt !== null;
}

// Exportada desde la Fase F: el MENU de aplicacion dispara exactamente las mismas acciones que los
// atajos. Si el menu tuviera su propio despachador, un dia harian cosas distintas.
export function runGlobalAction(actionId: string): void {
  // Generado (I10b): un `case` por panel duplicaria en este switch la misma lista de ids que ya vive
  // en PANEL_REGISTRY/actionCatalog.ts. 'conversations'/'permissions' no pasan por aqui: los resuelve
  // el switch de abajo (app.toggleSidebar/app.toggleInspector), que es su unico id.
  if (actionId.startsWith(PANEL_TOGGLE_PREFIX)) {
    const panelId = actionId.slice(PANEL_TOGGLE_PREFIX.length) as PanelId;
    usePanelLayoutStore.getState().togglePanelById(panelId);
    return;
  }
  const store = useWorkbenchStore.getState();
  switch (actionId) {
    case 'conversation.new':
      store.openNewTab();
      return;
    case 'window.new':
      // Ventana nueva VACIA: comparte configuracion con esta y arranca con su propio workspace.
      void window.mage.openWindow().catch((err: unknown) => console.warn('No se pudo abrir la ventana:', err));
      return;
    case 'tab.close':
      store.closeActiveTab();
      return;
    case 'tab.next':
      store.cycleTab('next');
      return;
    case 'tab.previous':
      store.cycleTab('previous');
      return;
    case 'session.interrupt':
      store.interruptActiveSession();
      return;
    case 'session.compact':
      void store.compactActiveSession();
      return;
    case 'app.openSettings':
      store.openSettings();
      return;
    case 'app.toggleSidebar':
      store.toggleSidebar();
      return;
    case 'app.toggleInspector':
      store.toggleInspector();
      return;
    case 'permission.allow':
      store.answerActivePermission({ behavior: 'allow' });
      return;
    case 'permission.allowAlways': {
      // Mismo alcance que el boton del panel (2.3b): concede Y guarda la regla por conversacion. Hasta
      // ahora el atajo hacia un `allow` a secas —igual que la tecla de al lado— asi que el usuario
      // pulsaba "Permitir siempre" y la siguiente peticion de la misma tool volvia a preguntar.
      const tool = headPermission(store, store.activeTabId)?.view.toolLabel;
      if (tool !== undefined) store.allowAlwaysAndAnswer(tool);
      return;
    }
    case 'permission.deny':
      store.answerActivePermission({ behavior: 'deny', message: 'Denegado por el usuario' });
      return;
    case 'permission.cycleMode':
      // cyclePermissionMode ya se apaga sola si la pestana activa no es Claude (workbenchStore.ts).
      store.cyclePermissionMode();
      return;
  }
}

export function useGlobalKeybindings(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const state = useWorkbenchStore.getState();
      const dialogOpen = isAnyDialogOpen(state);
      const status = state.statusByChat[state.activeTabId];
      const focusInEditableText = isEditableTarget(document.activeElement);
      const actionId = resolveKeyEvent({
        event: toKeyEventLike(e),
        activeScopes: dialogOpen ? [] : ['global'],
        overrides: state.settings.keybindingOverrides,
        isMac: isMacPlatform(),
        focusInEditableText,
        guardContext: {
          promptTextEmpty: false, // ninguna accion global usa este flag (solo prompt.cyclePermissionMode)
          permissionPending: headPermission(state, state.activeTabId) !== null,
          questionPending: hasPendingQuestion(headPermission(state, state.activeTabId), state.blocksByChat[state.activeTabId] ?? []),
          turnRunning: status === 'streaming' || status === 'needs_permission',
          dialogOrPopoverOpen: dialogOpen,
          focusInEditableText,
        },
      });
      if (actionId === null) return;
      e.preventDefault();
      runGlobalAction(actionId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
