import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { allAssignedPanelIds, type MoveDestination } from '../panels/panelLayoutOps';
import { findPanelDefinition, PANEL_REGISTRY, resolvePanelDefinitions } from '../panels/panelRegistry';
import { usePanelLayoutStore } from '../panelLayoutStore';
import { Stripe } from './dock/Stripe';
import { SplitZones } from './dock/DockZone';
import { PanelMoveMenu } from './dock/PanelMoveMenu';
import { AddPanelMenu } from './dock/AddPanelMenu';
import type { Anchor, PanelId, ZoneKey } from '@shared/panelLayout';

// Ver LeftDock.tsx: sin `border-t` en la zona 'b' — el divisor de split ya pinta esa linea (item 6).
const BORDER = 'border-l border-mg-border';
const RIGHT_ANCHOR: Anchor = 'right';
const BOTTOM_ANCHOR: Anchor = 'bottom';

// Los PANES del borde derecho, separados de su stripe de iconos (2026-09-21). Van aparte porque en el
// marco continuo no viven en la misma caja: los panes flotan DENTRO del hueco de 3 px, como el resto de
// islas, mientras que la stripe es parte del marco y toca la barra de titulo y la de estado. Separarlos
// no cuesta estado: `SplitZones` lo lee todo del store, no de `RightDock`.
export function RightDockPanes(): React.JSX.Element {
  const stripe = usePanelLayoutStore((s) => s.layout.stripes.right);

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <SplitZones
        anchor="right"
        stripe={stripe}
        borderClassNameA={BORDER}
        borderClassNameB={BORDER}
        resizeAriaLabelA="Redimensionar panel derecho arriba"
        resizeAriaLabelB="Redimensionar panel derecho medio"
        splitAriaLabel="Redimensionar reparto entre arriba y medio, borde derecho"
        className="flex-1"
      />
    </div>
  );
}

// Borde derecho (F6, PLAN-F6-PANELES.md §3.2/§6/§7, ajustado con el feedback del usuario tras verlo en
// vivo): igual estructura que LeftDock/AccountRail (stripe VERTICAL + un pane por zona ABIERTA, sin
// pestañas propias — ver ZonePane.tsx), mas dos piezas que no son de un panel concreto:
// - El punto de "permiso pendiente": antes decoraba la pestaña `permissions` (ya eliminada); ahora es
//   un badge sobre SU ICONO en la stripe, dondequiera que este.
// - La posicion "abajo" (2026-08-06, tercer grupo de `Stripe`): icono en ESTE borde, panel en el
//   COMPARTIDO de abajo (bottom/b) — no en un pane de este borde. `BottomDock.tsx` ya no pinta su
//   propio stripe de iconos: viven aqui y en AccountRail.tsx (bottom/a), uno por lado.
export function RightDock(): React.JSX.Element {
  const layout = usePanelLayoutStore((s) => s.layout);
  const stripe = layout.stripes.right;
  const bottomStripe = layout.stripes.bottom;
  const togglePanel = usePanelLayoutStore((s) => s.togglePanel);
  const movePanel = usePanelLayoutStore((s) => s.movePanel);
  const hidePanel = usePanelLayoutStore((s) => s.hidePanel);
  const destinationsFor = usePanelLayoutStore((s) => s.destinationsFor);
  const permissionPending = useWorkbenchStore((s) => s.permissionByChat[s.activeTabId] !== null && s.permissionByChat[s.activeTabId] !== undefined);
  const [moveMenu, setMoveMenu] = useState<{ readonly panelId: PanelId; readonly x: number; readonly y: number } | null>(null);
  const [addMenu, setAddMenu] = useState<{ readonly x: number; readonly y: number } | null>(null);

  const badgedPanelIds = permissionPending ? new Set<PanelId>(['permissions']) : undefined;

  // Ver AccountRail.tsx: el conjunto de asignados es GLOBAL (las 6 zonas), no solo las de este borde.
  const assignedIds = allAssignedPanelIds(layout);
  const addablePanels = PANEL_REGISTRY.filter((p) => !assignedIds.has(p.id));

  const onRequestMove = (_zone: ZoneKey, panelId: PanelId, x: number, y: number): void => setMoveMenu({ panelId, x, y });
  const onSelectDestination = (destination: MoveDestination): void => {
    if (moveMenu === null) return;
    movePanel(moveMenu.panelId, destination.anchor, destination.zone);
  };

  return (
    <>
      <Stripe
        ariaLabel="Paneles del borde derecho"
        orientation="vertical"
        zoneAPanels={resolvePanelDefinitions(stripe.a.panelIds)}
        zoneAActiveId={stripe.a.activePanelId}
        zoneBPanels={resolvePanelDefinitions(stripe.b.panelIds)}
        zoneBActiveId={stripe.b.activePanelId}
        onToggle={(zone, panelId) => togglePanel('right', zone, panelId)}
        onRequestMove={onRequestMove}
        onDropPanel={(zone, panelId) => movePanel(panelId, 'right', zone)}
        addablePanels={addablePanels}
        onRequestAdd={(x, y) => setAddMenu({ x, y })}
        badgedPanelIds={badgedPanelIds}
        className={BORDER}
        thirdPanels={resolvePanelDefinitions(bottomStripe.b.panelIds)}
        thirdActiveId={bottomStripe.b.activePanelId}
        onToggleThird={(panelId) => togglePanel(BOTTOM_ANCHOR, 'b', panelId)}
        onRequestMoveThird={(panelId, x, y) => setMoveMenu({ panelId, x, y })}
        onDropThird={(panelId) => movePanel(panelId, BOTTOM_ANCHOR, 'b')}
      />
      <AnimatePresence>
        {moveMenu !== null && (
          <PanelMoveMenu
            key="panel-move-menu"
            panelTitle={findPanelDefinition(moveMenu.panelId)?.title ?? moveMenu.panelId}
            destinations={destinationsFor(moveMenu.panelId)}
            x={moveMenu.x}
            y={moveMenu.y}
            onClose={() => setMoveMenu(null)}
            onSelect={onSelectDestination}
            onHide={() => hidePanel(moveMenu.panelId)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {addMenu !== null && (
          <AddPanelMenu
            key="add-panel-menu"
            panels={addablePanels}
            x={addMenu.x}
            y={addMenu.y}
            onClose={() => setAddMenu(null)}
            onSelect={(id) => movePanel(id, RIGHT_ANCHOR, 'a')}
          />
        )}
      </AnimatePresence>
    </>
  );
}
