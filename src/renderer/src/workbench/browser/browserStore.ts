import { create } from 'zustand';
import type { BrowserEntryState } from '@shared/browser';
import { usePanelLayoutStore } from '../panelLayoutStore';
import { describeError } from '../describeError';
import { useWorkbenchStore } from '../workbenchStore';
import type { PenMemory } from './browserPen';
import { indexStates, shouldRevealBrowser, type BrowserStates } from './browserPanelModel';

interface BrowserStoreState {
  readonly states: BrowserStates;
  readonly penByTab: Readonly<Record<string, PenMemory>>;
  setStates(list: readonly BrowserEntryState[]): void;
  rememberPen(tabId: string, memory: PenMemory): void;
}

export const useBrowserStore = create<BrowserStoreState>((set) => ({
  states: {},
  penByTab: {},
  setStates: (list) => set({ states: indexStates(list) }),
  rememberPen: (tabId, memory) => set((s) => ({ penByTab: { ...s.penByTab, [tabId]: memory } })),
}));

let syncing = false;

function applyPushedStates(list: readonly BrowserEntryState[]): void {
  const workbench = useWorkbenchStore.getState();
  const activeSessionId = workbench.sessionIdByChat[workbench.activeTabId];
  const next = indexStates(list);
  if (shouldRevealBrowser(useBrowserStore.getState().states, next, activeSessionId)) {
    usePanelLayoutStore.getState().revealPanelById('browser');
  }
  useBrowserStore.getState().setStates(list);
}

// Se arranca al importar el panel (lo importa el registro de paneles al cargar la app): el panel tiene que revelarse
// cuando el agente abre el navegador aunque esté cerrado (D-S7).
export function ensureBrowserStateSync(): void {
  if (syncing || typeof window === 'undefined' || window.mage === undefined) return;
  syncing = true;
  void window.mage
    .browserList()
    .then((list) => useBrowserStore.getState().setStates(list))
    .catch((err: unknown) => console.warn('No se pudo leer el estado del navegador', describeError(err)));
  window.mage.onBrowserState(applyPushedStates);
  if (import.meta.env.DEV) (window as unknown as { __mageBrowserDev?: unknown }).__mageBrowserDev = useBrowserStore;
}
