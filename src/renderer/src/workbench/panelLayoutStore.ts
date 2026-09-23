import { create } from 'zustand';
import { reconcileLayoutWithRegistry, type Anchor, type PanelId, type PanelLayoutState, type PanelPlacement, type ZoneKey } from '@shared/panelLayout';
import { PANEL_REGISTRY } from './panels/panelRegistry';
import {
  didZoneJustOpen,
  locatePanel,
  moveDestinations,
  movePanelToZone,
  placePanelInZone,
  removePanelFromLayout,
  resizeSplit as resizeSplitOp,
  resizeZone as resizeZoneOp,
  toggleZonePanel,
  type MoveDestination,
  type ZoneLocation,
} from './panels/panelLayoutOps';

// Contrato de error del proyecto (mensaje legible con el valor recibido). Copia MINIMA e intencional
// de workbenchStore.ts (no se importa desde alli): workbenchStore SI necesita importar de este modulo
// (toggleSidebar/toggleInspector delegan en togglePanelById, ver mas abajo) y una importacion en el
// otro sentido crearia un ciclo entre los dos stores por un helper de una linea.
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : `Error desconocido: ${String(err)}`;
}

// Forma minima (id/defaultAnchor/defaultZone) del registro real, para el UNICO parametro que cruza a
// main por IPC (loadPanelLayout). Imprescindible: `PANEL_REGISTRY` trae `render` (una funcion) en cada
// entrada, y el algoritmo de structured clone que usa Electron para IPC NO PUEDE serializar funciones
// — mandar el registro completo tal cual lanzaria un DataCloneError en cuanto se abriera la app.
const PANEL_PLACEMENT_REGISTRY: readonly PanelPlacement[] = PANEL_REGISTRY.map(({ id, defaultAnchor, defaultZone }) => ({ id, defaultAnchor, defaultZone }));

// Store DEDICADO (F6 Fase 4, PLAN-F6-PANELES.md §3/§6/§7) para el layout de paneles EN VIVO: a
// diferencia de Fase 3 (que cableo LeftDock/RightDock contra los booleanos preexistentes
// `sidebarVisible`/`inspectorVisible` del workbenchStore, un atajo que reproducia el layout de hoy
// pero no admitia mover un panel a otra zona), este store es la fuente de verdad real del `ZoneState`
// por zona — necesaria para que "mover un panel a cualquier borde/zona" (§6) tenga un sitio donde vivir.
// Store SEPARADO de workbenchStore (no una seccion mas de un store ya grande): misma razon de fondo que
// transcriptStore/memoryStore, un dominio con su propio ciclo de vida (hidratacion async por IPC).
export interface PanelLayoutStoreState {
  readonly layout: PanelLayoutState;
  readonly hydrated: boolean;
  // Id del panel que se ACABA de abrir/mover por una accion EXPLICITA del usuario (§6: "si el panel se
  // abre por una accion explicita... el foco entra al primer elemento focusable"). `null` en reposo o
  // tras hidratar (arranque): la hidratacion NUNCA debe robar el foco. Lo consume (y limpia) el pane
  // que efectivamente monta/activa ese panel — ver ZonePane.tsx.
  readonly pendingFocusPanelId: PanelId | null;

  init: () => void;
  togglePanel: (anchor: Anchor, zone: ZoneKey, panelId: PanelId) => void;
  // Alterna un panel por id SIN que el caller conozca su zona actual (D5 llama `toggleSidebar`/
  // `toggleInspector`, que delegan aqui vía workbenchStore; StatusBar tambien la usa directamente).
  togglePanelById: (panelId: PanelId) => void;
  // Asegura que un panel esta VISIBLE (no lo alterna). Lo piden la tarjeta de permiso del chat ("Más
  // información") y el aviso de fichero nuevo: con `togglePanelById`, si el panel ya estaba abierto el
  // boton lo CERRABA — justo lo contrario de lo que promete.
  revealPanelById: (panelId: PanelId) => void;
  movePanel: (panelId: PanelId, toAnchor: Anchor, toZone: ZoneKey) => void;
  // Saca el icono de `panelId` de la barra sin ponerlo en ningun otro sitio (Ronda 3, item 11). No
  // destruye nada: reaparece en el menu "Añadir panel" de cualquier borde.
  hidePanel: (panelId: PanelId) => void;
  // Tamaño del borde contra el centro. Es POR BORDE, no por zona (Ronda 3, items 14b+15): las dos
  // zonas de un mismo lado comparten ancho/alto, si no la mas estrecha deja un hueco transparente.
  resizeZone: (anchor: Anchor, sizePx: number) => void;
  // Reparto entre 'a' y 'b' de una stripe cuando ambas estan abiertas (divisor de split, distinto del
  // divisor de resizeZone — ese resizea la zona contra el centro, este el reparto ENTRE las dos).
  resizeSplit: (anchor: Anchor, splitPx: number) => void;
  isPanelOpen: (panelId: PanelId) => boolean;
  locate: (panelId: PanelId) => ZoneLocation | undefined;
  destinationsFor: (panelId: PanelId) => readonly MoveDestination[];
  // `true` y limpia el pendiente SOLO si coincide con `panelId` — el caller (ZonePane) decide que
  // hacer con el resultado (robar el foco o no). Nunca lanza: un id que no coincide simplemente no roba.
  consumePendingFocus: (panelId: PanelId) => boolean;
  // I10a: vuelve a la disposicion de fabrica (mismo calculo que el arranque en frio, sin fichero
  // persistido) y lo persiste. Accion explicita del usuario desde Ajustes; no hay deshacer.
  resetLayout: () => void;
}

// Persiste de forma best-effort (fire-and-forget, igual que loadSettings/loadWorkspace en
// workbenchStore.ts): un fallo de escritura no debe romper la interaccion del usuario, pero tampoco se
// traga en silencio (se avisa por consola, mismo contrato de "nunca silenciar" del proyecto).
function persist(layout: PanelLayoutState): void {
  void window.mage.savePanelLayout(layout).catch((err: unknown) => console.warn('No se pudo guardar el layout de paneles:', describeError(err)));
}

export const usePanelLayoutStore = create<PanelLayoutStoreState>((set, get) => ({
  // Layout SINCRONO desde el registro (mismos defaults que hoy, §5.3 "migracion") mientras la carga
  // real por IPC esta en vuelo: el primer pintado ya reproduce el layout correcto sin esperar al main.
  layout: reconcileLayoutWithRegistry(null, PANEL_REGISTRY),
  hydrated: false,
  pendingFocusPanelId: null,

  init: () => {
    if (get().hydrated) return; // evita una segunda carga si App se remonta (p.ej. StrictMode)
    void window.mage
      .loadPanelLayout({ registry: PANEL_PLACEMENT_REGISTRY })
      .then((layout) => set({ layout, hydrated: true }))
      .catch((err: unknown) => {
        console.warn('No se pudo cargar el layout de paneles:', describeError(err));
        set({ hydrated: true }); // se queda con los defaults sincronos ya pintados
      });
  },

  togglePanel: (anchor, zone, panelId) => {
    const before = get().layout.stripes[anchor][zone];
    const layout = toggleZonePanel(get().layout, anchor, zone, panelId);
    const opened = didZoneJustOpen(before, layout.stripes[anchor][zone]);
    set((s) => ({ layout, pendingFocusPanelId: opened ? panelId : s.pendingFocusPanelId }));
    persist(layout);
  },

  togglePanelById: (panelId) => {
    const loc = locatePanel(get().layout, panelId);
    if (loc === undefined) return; // no deberia pasar tras reconciliar; no hay zona que alternar
    get().togglePanel(loc.anchor, loc.zone, panelId);
  },

  revealPanelById: (panelId) => {
    const loc = locatePanel(get().layout, panelId);
    if (loc === undefined) return; // el panel esta escondido: no hay zona donde revelarlo
    if (get().layout.stripes[loc.anchor][loc.zone].activePanelId === panelId) return; // ya se esta viendo
    get().togglePanel(loc.anchor, loc.zone, panelId);
  },

  movePanel: (panelId, toAnchor, toZone) => {
    // Dos operaciones distintas detras del mismo gesto: si el panel esta en alguna zona se MUEVE; si no
    // esta en ninguna (viene del menu "Añadir panel", que solo ofrece los escondidos) se COLOCA. Antes
    // se llamaba siempre a `movePanelToZone`, que en ese segundo caso lanza por precondicion — o sea
    // que añadir un panel escondido no funcionaba.
    const current = get().layout;
    const layout =
      locatePanel(current, panelId) === undefined
        ? placePanelInZone(current, panelId, toAnchor, toZone)
        : movePanelToZone(current, panelId, toAnchor, toZone);
    set({ layout, pendingFocusPanelId: panelId }); // mover es siempre una accion explicita: roba el foco
    persist(layout);
  },

  hidePanel: (panelId) => {
    const layout = removePanelFromLayout(get().layout, panelId);
    set({ layout }); // esconder NUNCA roba el foco: no hay nada nuevo que enfocar
    persist(layout);
  },

  resizeZone: (anchor, sizePx) => {
    // Se escribe en las DOS zonas del borde: la operacion pura sigue siendo por zona (es la unidad del
    // modelo persistido), pero la UI ya no permite que diverjan.
    const layout = resizeZoneOp(resizeZoneOp(get().layout, anchor, 'a', sizePx), anchor, 'b', sizePx);
    set({ layout });
    persist(layout);
  },

  resizeSplit: (anchor, splitPx) => {
    const layout = resizeSplitOp(get().layout, anchor, splitPx);
    set({ layout });
    persist(layout);
  },

  isPanelOpen: (panelId) => {
    const loc = locatePanel(get().layout, panelId);
    return loc !== undefined && get().layout.stripes[loc.anchor][loc.zone].activePanelId === panelId;
  },

  locate: (panelId) => locatePanel(get().layout, panelId),

  destinationsFor: (panelId) => {
    const loc = locatePanel(get().layout, panelId);
    return loc === undefined ? [] : moveDestinations(loc);
  },

  consumePendingFocus: (panelId) => {
    if (get().pendingFocusPanelId !== panelId) return false;
    set({ pendingFocusPanelId: null });
    return true;
  },

  resetLayout: () => {
    const layout = reconcileLayoutWithRegistry(null, PANEL_REGISTRY);
    set({ layout });
    persist(layout);
  },
}));
