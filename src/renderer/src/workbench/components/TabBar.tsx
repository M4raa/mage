import { useEffect, useMemo, useRef, useState } from 'react';
import type { SplitPath } from '../splitLayout';
import { Icon } from './Icon';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { isArrowNavKey, nextIndexForArrow } from '../a11y/keyboardNav';
import { TAB_INDICATOR_TRANSITION } from '../motionPresets';
import { orderTabsForDisplay, TAB_DRAG_MIME, tabColorVar, tabsToCloseAll, tabsToCloseInactive } from '../tabActions';
import { TabContextMenu } from './TabContextMenu';
import type { Tab as TabModel } from '../types';

// Id compartido del indicador de pestaña activa (Type 4 del catalogo de motion: shared-element). Solo
// la pestaña activa lo renderiza; motion detecta que "el mismo" elemento cambio de padre entre renders
// y anima la transicion (FLIP) en vez de saltar de una pestaña a otra.
const ACTIVE_TAB_INDICATOR_ID = 'active-tab-indicator';

// Barra de pestanas. Cada pestana conserva el acento de su cuenta de origen (border-top + chip),
// aunque cambies de cuenta activa en el rail. Accesibilidad (M3): patron ARIA tablist -> cada pestana
// es role="tab" con roving tabindex; las flechas mueven foco+seleccion, Enter/Espacio activan.
export function TabBar({
  tabIds,
  paneActiveTabId,
  path,
}: {
  // Pestañas de ESTE panel, en el orden del grupo. La barra ya no lista todas las de la app.
  readonly tabIds: readonly string[];
  // La que enseña este panel. Es independiente del foco global: dos paneles tienen dos activas.
  readonly paneActiveTabId: string;
  // Camino del panel en el arbol: lo necesitan "pestaña nueva aqui" y el destino de un arrastre.
  readonly path: SplitPath;
}): React.JSX.Element {
  const tabs = useWorkbenchStore((s) => s.tabs);
  const accounts = useWorkbenchStore((s) => s.accounts);
  const activeTabId = useWorkbenchStore((s) => s.activeTabId);
  const activeAccountId = useWorkbenchStore((s) => s.activeAccountId);
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);
  const focusPrompt = useWorkbenchStore((s) => s.focusPrompt);
  const closeTab = useWorkbenchStore((s) => s.closeTab);
  const addTabToPane = useWorkbenchStore((s) => s.addTabToPane);
  const openNewTabDialog = useWorkbenchStore((s) => s.openNewTabDialog);
  const openInNewWindow = useWorkbenchStore((s) => s.openInNewWindow);
  const moveTabToWindow = useWorkbenchStore((s) => s.moveTabToWindow);
  // Otras ventanas abiertas. Se piden al ABRIR el menu y no en cada render: es IPC, y entre que se
  // abre el menu y se elige no da tiempo a que la lista cambie de forma que importe.
  const [otherWindows, setOtherWindows] = useState<readonly { readonly windowId: string }[]>([]);
  const statusByChat = useWorkbenchStore((s) => s.statusByChat);
  const closeAllTabs = useWorkbenchStore((s) => s.closeAllTabs);
  const closeInactiveTabs = useWorkbenchStore((s) => s.closeInactiveTabs);
  const toggleTabPinned = useWorkbenchStore((s) => s.toggleTabPinned);
  const setTabColor = useWorkbenchStore((s) => s.setTabColor);

  const movePaneTab = useWorkbenchStore((s) => s.movePaneTab);
  const listRef = useRef<HTMLDivElement>(null);
  // Menu contextual (Ronda 3, item 12): pestaña objetivo + posicion del clic; null cuando esta cerrado.
  const [menu, setMenu] = useState<{ readonly tab: TabModel; readonly x: number; readonly y: number } | null>(null);

  // I11-drag: `visibleIds` decide el badge "en otro panel" de cada pestaña y con que "Dividir a..."
  // del menu contextual tiene sentido (dividir el panel enfocado CON EL MISMO tab que ya muestra no
  // significa nada).


  // Las ancladas van primero. useMemo sobre estado bruto: nunca un selector de Zustand que devuelva un
  // array nuevo por render (bucle infinito en v5).
  // Solo las de ESTE panel, respetando el orden del grupo; dentro, las ancladas primero.
  const orderedTabs = useMemo(() => {
    const byId = new Map(tabs.map((tab) => [tab.id, tab]));
    const mine = tabIds.map((id) => byId.get(id)).filter((tab): tab is TabModel => tab !== undefined);
    return orderTabsForDisplay(mine);
  }, [tabs, tabIds]);

  const accentOf = (accountId: string): string =>
    accounts.find((a) => a.id === accountId)?.accent.base ?? 'transparent';

  // Navegacion roving: flechas/Home/End mueven la seleccion y el foco a la pestana correspondiente.
  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!isArrowNavKey(e.key)) return;
    e.preventDefault();
    const currentIndex = Math.max(0, orderedTabs.findIndex((t) => t.id === paneActiveTabId));
    const nextIndex = nextIndexForArrow(orderedTabs.length, currentIndex, e.key);
    const nextTab = orderedTabs[nextIndex];
    if (nextTab === undefined) return;
    setActiveTab(nextTab.id);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[nextIndex]?.focus();
  };

  // La pestaña activa se trae A LA VISTA al cambiar (abrir una conversacion con muchas pestañas ya no
  // obliga a buscarla con el scroll, A6). `nearest` no mueve nada si ya se ve.
  useEffect(() => {
    const index = orderedTabs.findIndex((t) => t.id === paneActiveTabId);
    if (index < 0) return;
    const element = listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[index];
    element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [paneActiveTabId, orderedTabs]);

  // La rueda del raton scrollea la barra en HORIZONTAL (A7): sobre una barra de una sola fila el
  // deltaY vertical del raton no hacia nada. Listener NATIVO no pasivo: React registra `onWheel` como
  // pasivo y ahi preventDefault no surte efecto (el gesto se iria al contenedor de la app).
  useEffect(() => {
    const element = listRef.current;
    if (element === null) return;
    const onWheel = (e: WheelEvent): void => {
      if (element.scrollWidth <= element.clientWidth) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (delta === 0) return;
      e.preventDefault();
      element.scrollLeft += delta;
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  // La lista de pestañas scrollea AQUÍ dentro (overflow-x + min-w-0) si no caben; antes empujaba el
  // ancho y aparecia un scroll horizontal de TODA la ventana (#10 de AJUSTES). El botón ＋ queda fijo.
  return (
    <div className="flex min-w-0 border-b border-mg-border bg-mg-panel text-[11.5px]">
      <div
        ref={listRef}
        role="tablist"
        // Con el workspace dividido hay VARIAS barras a la vez: dos listas de pestañas con el mismo
        // nombre accesible son indistinguibles para un lector de pantalla. El camino del panel es
        // estable y corto, y sirve de desambiguador.
        aria-label={path.length === 0 ? 'Conversaciones abiertas' : `Conversaciones abiertas (panel ${path.join('')})`}
        onKeyDown={onListKeyDown}
        className="mg-tabscroll flex min-w-0 flex-1 overflow-x-auto"
      >
        {orderedTabs.map((tab) => (
          <Tab
            key={tab.id}
            tab={tab}
            accent={tabColorVar(tab.colorIndex, accentOf(tab.accountId))}
            active={tab.id === paneActiveTabId}
            // Activa de un panel que NO tiene el foco: encendida pero atenuada. Con el workspace dividido
            // hay N activas a la vez y solo una manda; sin esto las dos barras mienten igual.
            unfocusedPane={tab.id === paneActiveTabId && tab.id !== activeTabId}
            // Elegir una pestaña (clic, o Enter/Espacio sobre ella) SI deja el cursor listo para
            // escribir; recorrerlas con las flechas no, para que el tablist siga siendo navegable.
            onSelect={() => {
              setActiveTab(tab.id);
              focusPrompt();
            }}
            onClose={() => closeTab(tab.id)}
            onDragOutOfWindow={() => void openInNewWindow(tab.id)}
            onContextMenu={(x, y) => {
              setMenu({ tab, x, y });
              void window.mage
                .listWindows()
                .then((all) => setOtherWindows(all.filter((w) => !w.isCurrent)))
                .catch(() => setOtherWindows([]));
            }}
          />
        ))}
      </div>
      <button
        onClick={() => void addTabToPane(path)}
        // Clic derecho = el camino LARGO. El corto (clic normal) abre ya, en carpeta temporal y con
        // los valores por defecto; quien quiera elegir carpeta, proveedor o modelo sigue teniendo el
        // dialogo, solo que deja de estar en medio cada vez que se abre una conversacion.
        onContextMenu={(e) => {
          e.preventDefault();
          openNewTabDialog(path);
        }}
        disabled={activeAccountId.length === 0}
        className="flex-none p-[8px_12px] text-mg-icon disabled:opacity-40"
        data-tip="Nueva pestaña · clic derecho para elegir carpeta y modelo"
        aria-label="Nueva pestaña"
      >
        ＋
      </button>
      <AnimatePresence>
        {menu !== null && (
          <TabContextMenu
            key="tab-context-menu"
            title={menu.tab.title}
            pinned={menu.tab.pinned === true}
            colorIndex={menu.tab.colorIndex}
            closableCount={tabsToCloseAll(tabs).length}
            inactiveCount={tabsToCloseInactive(tabs, statusByChat).length}
            // I11-drag: "Dividir a..." mueve ESTA pestaña a un panel nuevo junto al ENFOCADO. Sin
            // sentido si ya es la enfocada (dividiria un panel con su propio contenido) — se
            // deshabilita en el menu en vez de esconderse (mismo criterio que el resto de la app: un
            // menu que cambia de tamaño segun el estado es peor).
            canSplit={menu.tab.id !== activeTabId}
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            onCloseTab={() => closeTab(menu.tab.id)}
            onCloseAll={closeAllTabs}
            onCloseInactive={closeInactiveTabs}
            onTogglePinned={() => toggleTabPinned(menu.tab.id)}
            onPickColor={(colorIndex) => setTabColor(menu.tab.id, colorIndex)}
            onSplit={(zone) => movePaneTab(menu.tab.id, path, zone)}
            windows={otherWindows}
            onMoveToNewWindow={() => void openInNewWindow(menu.tab.id)}
            onMoveToWindow={(windowId) => void moveTabToWindow(menu.tab.id, windowId)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Tab({
  tab,
  accent,
  active,
  unfocusedPane,
  onSelect,
  onClose,
  onContextMenu,
}: {
  readonly tab: TabModel;
  readonly accent: string;
  readonly active: boolean;
  // Se esta viendo en el SEGUNDO panel del centro (item 13): tambien esta a la vista, aunque el foco
  // no este en el, y conviene que la barra lo diga.
  readonly unfocusedPane: boolean;
  readonly onSelect: () => void;
  readonly onClose: () => void;
  readonly onContextMenu: (x: number, y: number) => void;
  // Se solto la pestaña fuera de la ventana: sale a una ventana nueva.
  readonly onDragOutOfWindow: () => void;
}): React.JSX.Element {
  const accountAlias = tab.accountAlias;
  // role="tab" sobre un div (no <button>) para poder anidar el boton ✕ sin HTML invalido. Enter/Espacio
  // activan; el roving (tabIndex 0 en la activa, -1 en el resto) y las flechas los gestiona el tablist.
  // Shift+F10 / tecla de menu abren el contextual sin raton (mismo contrato que los iconos del dock).
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
      return;
    }
    if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    onContextMenu(rect.left, rect.bottom);
  };
  return (
    <div
      role="tab"
      aria-selected={active}
      // Ancla ESTABLE para `pnpm verify:gui` (arrastrar una pestaña concreta por id). No la usa
      // ningun otro codigo de produccion.
      data-tab-id={tab.id}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      // Boton central del raton cierra la pestana (comportamiento estandar de pestanas).
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={(e) => {
        if (e.button === 1) onClose();
      }}
      // I11-drag: arrastrar esta pestaña a un panel del centro lo divide o lo mueve ahi (estilo VS
      // Code/IntelliJ) — mismo patron nativo que ya usa F6 para los iconos (dock/Stripe.tsx). Solo el
      // id viaja en el `dataTransfer`: quien recibe (ChatPane) resuelve el resto contra el store.
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(TAB_DRAG_MIME, tab.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`relative flex flex-none cursor-pointer items-center gap-[7px] border-r border-mg-border p-[8px_14px] transition-colors duration-150 ease-out ${
        active && !unfocusedPane
          ? 'bg-mg-window text-mg-text'
          : unfocusedPane
            ? 'bg-mg-window/60 text-mg-body2'
            : 'text-mg-sec hover:bg-mg-hover'
      }`}
    >
      {active && (
        <motion.span
          layoutId={ACTIVE_TAB_INDICATOR_ID}
          transition={TAB_INDICATOR_TRANSITION}
          className="absolute inset-x-0 top-0 h-[2px]"
          style={{ background: accent }}
        />
      )}
      {/* Punto con el color de la pestaña: el de su cuenta de origen, o el elegido a mano en el menu
          contextual (item 12). Sin el alias textual: basta el color. */}
      <span className="h-[7px] w-[7px] flex-none rounded-[2px]" style={{ background: accent }} />
      {tab.pinned === true && <Icon name="pin" size={10} className="flex-none text-mg-ter" />}

      <span className="max-w-[220px] truncate">{tab.title}</span>
      {active && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="text-mg-muted transition-colors duration-150 ease-out hover:text-mg-body"
          data-tip="Cerrar pestaña"
          aria-label={`Cerrar pestaña ${accountAlias} / ${tab.title}`}
        >
          ✕
        </button>
      )}
    </div>
  );
}
