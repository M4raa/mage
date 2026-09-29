import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { usePanelLayoutStore } from '../panelLayoutStore';
import { findPanelDefinition, PANEL_REGISTRY, resolvePanelDefinitions } from '../panels/panelRegistry';
import { allAssignedPanelIds, type MoveDestination } from '../panels/panelLayoutOps';
import {
  DockZoneToolbar,
  STRIPE_PAD_CLASS,
  STRIPE_SCROLL_CLASS,
  STRIPE_WIDTH_CLASS,
  StripeSeparator,
  PANEL_ICON_PX,
  StripeZoneButtons,
} from './dock/Stripe';
import { PanelMoveMenu } from './dock/PanelMoveMenu';
import { Icon } from './Icon';
import { AddPanelMenu } from './dock/AddPanelMenu';
import type { Anchor, PanelId } from '@shared/panelLayout';

const LEFT_ANCHOR: Anchor = 'left';
const BOTTOM_ANCHOR: Anchor = 'bottom';

// Rail izquierdo, UNA sola barra (F6, feedback del usuario: "sobra el icono de la app... no
// deberian ser 2 barras separadas"). Antes: el logo de Mage arriba + este rail y la stripe de iconos
// del borde izquierdo eran dos columnas de 52px pegadas, con el mismo fondo pero sin fundirse en una
// sola. Ahora: sin logo (no aportaba nada que el propio icono de "conversaciones" no diera ya) y los
// iconos de la zona 'a' ("arriba") y 'b' ("medio") del borde izquierdo viven DENTRO de este mismo rail
// — arriba y justo antes de ajustes respectivamente — compartiendo el mismo `flex-1` de siempre en vez
// de tener uno propio. El boton ◔ dedicado (que abria un popover flotante) tambien desaparecio: 'usage'
// es ahora un panel del registro mas, con `defaultZone: 'b'` (panelRegistry.ts) — ya aparece solo en el
// grupo "medio", no hace falta un botón aparte que abra otra cosa por su cuenta. Tercer grupo, 2026-08-
// 06: "abajo" (bottom/a) — icono aqui, panel en el borde compartido de abajo (ver mas abajo en el JSX).
export function AccountRail(): React.JSX.Element {

  const layout = usePanelLayoutStore((s) => s.layout);
  const stripe = layout.stripes.left;
  const bottomStripe = layout.stripes.bottom;
  const togglePanel = usePanelLayoutStore((s) => s.togglePanel);
  const movePanel = usePanelLayoutStore((s) => s.movePanel);
  const hidePanel = usePanelLayoutStore((s) => s.hidePanel);
  const destinationsFor = usePanelLayoutStore((s) => s.destinationsFor);
  const stepPanel = usePanelLayoutStore((s) => s.stepPanel);
  const stepOptions = usePanelLayoutStore((s) => s.stepOptions);
  const [moveMenu, setMoveMenu] = useState<{ readonly panelId: PanelId; readonly x: number; readonly y: number } | null>(null);
  const [addMenu, setAddMenu] = useState<{ readonly x: number; readonly y: number } | null>(null);

  // Solo es "añadible" un panel que no esta abierto en NINGUNA zona de NINGUN borde (Ronda 3, item
  // 19): ofrecer aqui uno que ya vive en el borde derecho lo movia sin aviso al pulsarlo.
  const assignedIds = allAssignedPanelIds(layout);
  const addablePanels = PANEL_REGISTRY.filter((p) => !assignedIds.has(p.id));
  const onSelectDestination = (destination: MoveDestination): void => {
    if (moveMenu === null) return;
    movePanel(moveMenu.panelId, destination.anchor, destination.zone);
  };

  // `min-h-0` en la raiz: sin el, un flex column se niega a bajar de la altura de su CONTENIDO (el
  // default de `min-height` en un flex item es `auto`) y empuja la pagina entera hasta sacarle scroll
  // vertical, con la barra de estado y el prompt fuera de la vista. Y el contenido de esta columna
  // crece con el USO —una entrada por cuenta— mientras la altura de la ventana no, asi que desbordar
  // era cuestion de tiempo. Lo que scrollea es la LISTA DE CUENTAS, no la columna: los iconos de
  // panel de arriba y los controles de abajo se quedan siempre a la vista, como en VS Code/JetBrains.
  return (
    <div className={`flex min-h-0 flex-col items-center gap-[2px] border-r border-mg-border bg-mg-rail ${STRIPE_WIDTH_CLASS} ${STRIPE_PAD_CLASS}`}>
      {/* TODOS los grupos de iconos van dentro de UN contenedor que scrollea, y los controles de abajo
          (añadir panel, ajustes) quedan fuera, siempre a la vista.

          Es el arreglo del reporte "sigue saliendo scroll vertical, solo en modo ventana", y la causa
          era esta: el hueco elastico de mas abajo llevaba el `overflow-y-auto` pero estaba VACIO, asi
          que no contenia nada. Lo que crece son los ICONOS —el usuario mueve paneles a este borde y hoy
          el catalogo tiene once—, y crecian fuera de cualquier caja con overflow. Medido: con los once
          apilados y la ventana a 480 px, el rail pedia 464 px en una caja de 422 y empujaba el scroll a
          la PAGINA entera, con la barra de estado fuera de vista.

          La barra de scroll se oculta a proposito (`scrollbar-width: none`): en la columna de la stripe
          (STRIPE_WIDTH_CLASS, 37 px) se comeria un tercio del ancho. Se sigue pudiendo desplazar con la
          rueda. */}
      <div data-stripe-scroll="true" className={`flex w-full flex-col items-center gap-[2px] ${STRIPE_SCROLL_CLASS}`}>
      <DockZoneToolbar ariaLabel="Paneles del borde izquierdo, zona superior">
        <StripeZoneButtons
          panels={resolvePanelDefinitions(stripe.a.panelIds)}
          activeId={stripe.a.activePanelId}
          onClick={(id) => togglePanel(LEFT_ANCHOR, 'a', id)}
          onRequestMove={(id, x, y) => setMoveMenu({ panelId: id, x, y })}
          onDrop={(id, beforeId) => movePanel(id, LEFT_ANCHOR, 'a', beforeId)}
        />
      </DockZoneToolbar>

      {/* Separador entre "arriba" y "medio" (feedback del usuario, 2026-08-06: en JetBrains van
          pegadas arriba con una linea entre medias, no "medio" empujada al fondo). */}
      <StripeSeparator />

      <DockZoneToolbar ariaLabel="Paneles del borde izquierdo, zona media">
        <StripeZoneButtons
          panels={resolvePanelDefinitions(stripe.b.panelIds)}
          activeId={stripe.b.activePanelId}
          onClick={(id) => togglePanel(LEFT_ANCHOR, 'b', id)}
          onRequestMove={(id, x, y) => setMoveMenu({ panelId: id, x, y })}
          onDrop={(id, beforeId) => movePanel(id, LEFT_ANCHOR, 'b', beforeId)}
        />
      </DockZoneToolbar>

      {/* Hueco elastico DENTRO del contenedor que scrollea: empuja la zona "abajo" al fondo mientras
          sobre sitio, y se colapsa a cero en cuanto no sobra. Ya no lleva overflow propio — el que
          manda es el del contenedor de arriba, que si tiene contenido. */}
      <div className="min-h-0 w-full flex-1" />

      {/* Separador antes de "abajo" (reporte del usuario: "entre la zona de arriba y la de abajo no has
          puesto la barra separadora"). Sin el, esta tercera zona no se distinguia del boton de ajustes
          ni del hueco elastico, asi que la posicion existia pero no se veia — y una zona de suelta que
          no se ve es una zona que nadie usa. */}
      <StripeSeparator />

      {/* Posicion "abajo" (2026-08-06): icono aqui, en la barra izquierda, pero panel en el borde
          COMPARTIDO de abajo (bottom/a) — no en un pane de este lado. Vacio por defecto (ningun panel
          del catalogo lo targetea); aparece en cuanto el usuario mueve algo aqui con "Mover a...". */}
      <DockZoneToolbar ariaLabel="Paneles del borde izquierdo, zona abajo (panel compartido)">
        <StripeZoneButtons
          panels={resolvePanelDefinitions(bottomStripe.a.panelIds)}
          activeId={bottomStripe.a.activePanelId}
          onClick={(id) => togglePanel(BOTTOM_ANCHOR, 'a', id)}
          onRequestMove={(id, x, y) => setMoveMenu({ panelId: id, x, y })}
          onDrop={(id, beforeId) => movePanel(id, BOTTOM_ANCHOR, 'a', beforeId)}
        />
      </DockZoneToolbar>
      </div>

      {addablePanels.length > 0 && (
        <button
          onClick={(e) => setAddMenu({ x: e.clientX, y: e.clientY })}
          aria-label="Añadir panel al borde izquierdo"
          data-tip="Añadir panel al borde izquierdo"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[13px] text-mg-muted hover:bg-mg-hover hover:text-mg-body"
        >
          <Icon name="ellipsis" size={PANEL_ICON_PX} />
        </button>
      )}

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
            stepOptions={stepOptions(moveMenu.panelId)}
            onStep={(direction) => stepPanel(moveMenu.panelId, direction)}
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
            onSelect={(id) => movePanel(id, LEFT_ANCHOR, 'a')}
          />
        )}
      </AnimatePresence>
    </div>
  );
}


