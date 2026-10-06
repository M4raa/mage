import { reduceEvent, useWorkbenchStore } from './workbenchStore';
import { transcriptStoreForTab, type TranscriptStoreState } from './transcriptStore';
import type { StoreApi, UseBoundStore } from 'zustand';
import { transcriptToBlocks } from './transcriptToBlocks';
import { usePanelLayoutStore } from './panelLayoutStore';
import { PANEL_REGISTRY } from './panels/panelRegistry';
import { notify, useNotificationStore } from './notificationStore';
import { useCodexAppsStore } from './codexAppsStore';

// Asidero SOLO de desarrollo para `pnpm verify:gui`: deja medir el DOM del chat sin gastar un turno
// real ni spawnear el CLI. Sin el, el harness no puede hidratar una conversacion (el store de Zustand
// es de ambito de modulo, el preload solo expone suscripciones que dispara `main`, y las
// transcripciones se resuelven desde `homedir()`, no desde el perfil aislado del harness).
//
// NO entra en el bundle de produccion: `App.tsx` lo carga con un import DINAMICO bajo
// `import.meta.env.DEV`, que Vite reemplaza por `false` al construir, asi que Rollup elimina la rama y
// el modulo entero. Comprobado en el "hecho" de la Fase A con `grep __mageDev out/renderer/assets`.
export interface MageDevBridge {
  readonly codexAppsStore: typeof useCodexAppsStore;
  readonly store: typeof useWorkbenchStore;
  // 4.1: ya no hay un store global, hay uno por pestaña. El puente entrega el de la ACTIVA, que es lo
  // que el harness siempre quiso decir (mide el panel enfocado) — asi sus llamadas no cambian.
  readonly transcriptStore: UseBoundStore<StoreApi<TranscriptStoreState>>;
  // El de una pestaña CONCRETA: con el workspace dividido hay dos paneles hidratando a la vez y "el
  // activo" ya no alcanza para montar ese estado (comprobacion de 4.3).
  readonly transcriptStoreFor: typeof transcriptStoreForTab;
  readonly transcriptToBlocks: typeof transcriptToBlocks;
  // El reducer REAL de eventos del motor. Con el, el harness puede inyectar un evento (p.ej. un
  // `permission_request` de AskUserQuestion) sin sesion viva: `handleEvent` no vale, porque resuelve la
  // pestaña por `sessionId` y una conversacion recien abierta todavia no tiene ninguno.
  readonly reduceEvent: typeof reduceEvent;
  // Layout de paneles + catalogo. Con los dos, el harness puede montar el estado que reporta un
  // usuario ("nueve iconos apilados en una columna") en vez de esperar a toparselo por casualidad.
  readonly panelStore: typeof usePanelLayoutStore;
  readonly panelRegistry: typeof PANEL_REGISTRY;
  // Notificaciones propias: el harness inyecta avisos (sin cerrar una pestaña de verdad) y vacia el store
  // al acabar cada comprobacion.
  readonly notify: typeof notify;
  readonly notifications: typeof useNotificationStore;
}

(window as unknown as { __mageDev?: MageDevBridge }).__mageDev = {
  codexAppsStore: useCodexAppsStore,
  store: useWorkbenchStore,
  // Getter, no valor: la pestaña activa cambia durante la propia verificacion.
  get transcriptStore() {
    return transcriptStoreForTab(useWorkbenchStore.getState().activeTabId);
  },
  transcriptStoreFor: transcriptStoreForTab,
  transcriptToBlocks,
  reduceEvent,
  panelStore: usePanelLayoutStore,
  panelRegistry: PANEL_REGISTRY,
  notify,
  notifications: useNotificationStore,
};
