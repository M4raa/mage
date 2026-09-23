import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Anchor, PanelId, ZoneKey } from '@shared/panelLayout';
import type { PanelDefinition } from '../../panels/panelRegistry';
import { focusFirst, useDialogA11y } from '../../a11y/useDialogA11y';
import { usePanelLayoutStore } from '../../panelLayoutStore';
import { PANEL_CONTENT_VARIANTS } from '../../motionPresets';
import { DOCK_ZONE_SIZE_VAR } from './ZoneResizeHandle';

export interface ZonePaneProps {
  readonly zoneRef: React.RefObject<HTMLDivElement | null>;
  readonly anchor: Anchor;
  readonly zone: ZoneKey;
  readonly panels: readonly PanelDefinition[]; // ya resueltos, en el orden de panelIds de la zona
  readonly activePanelId: PanelId;
  readonly sizePx: number;
  readonly borderClassName: string;
}

// Pane de contenido de UNA zona abierta (F6, PLAN-F6-PANELES.md §6/§7, ajustado con el feedback del
// usuario tras verlo en vivo): SIN pestañas propias. Si la zona comparte varios paneles, cambiar de
// activo es SOLO cosa del icono correspondiente en la stripe (el icono YA es el selector — un tablist
// aqui duplicaba esa misma decision, que es justo lo que el usuario pidio evitar desde el principio de
// F6, "no quiero mas pestañas"). Solo una cabecera de solo-lectura con el titulo del panel activo
// (mismo papel que la barra de titulo de un tool window de JetBrains). Dos mecanismos de foco del plan:
// 1) Escape dentro del pane cierra la zona y devuelve el foco al icono que la abrio — via
//    useDialogA11y, SIN robar el foco al montar (`stealFocusOnMount: false`) y SIN atrapar Tab
//    (`trapTab: false`: un panel de dock no es modal). El robo de foco real vive en el efecto de abajo.
// 2) El foco entra al primer elemento focusable SOLO si `activePanelId` coincide con el
//    `pendingFocusPanelId` del store (accion explicita: abrir la zona, o mover/añadir un panel hasta
//    aqui). Se ata a `activePanelId` (no al montaje) porque cambiar de panel activo en una zona YA
//    abierta no remonta este componente — solo cambia cual de sus paneles se ve.
export function ZonePane({ zoneRef, anchor, zone, panels, activePanelId, sizePx, borderClassName }: ZonePaneProps): React.JSX.Element {
  const togglePanel = usePanelLayoutStore((s) => s.togglePanel);
  const consumePendingFocus = usePanelLayoutStore((s) => s.consumePendingFocus);

  const closeZone = (): void => togglePanel(anchor, zone, activePanelId);
  const dialogRef = useDialogA11y({ onClose: closeZone, stealFocusOnMount: false, trapTab: false });

  useEffect(() => {
    if (!consumePendingFocus(activePanelId)) return;
    const node = zoneRef.current;
    if (node !== null) focusFirst(node);
    // consumePendingFocus es estable (accion de Zustand); solo debe re-evaluarse si cambia el panel activo.
  }, [activePanelId]);

  const activeDef = panels.find((p) => p.id === activePanelId);
  const dimension = anchor === 'bottom' ? 'height' : 'width';

  return (
    <div
      ref={(node) => {
        zoneRef.current = node;
        dialogRef.current = node;
      }}
      // Anclas ESTABLES para `pnpm verify:gui` (mismo patron que `data-pane-tab-id` en ChatPane): con
      // varias zonas abiertas, ningun selector de rol o texto identifica "el pane que esta mostrando
      // ESTE panel". No las usa ningun otro codigo de produccion.
      data-zone-pane={`${anchor}-${zone}`}
      data-active-panel={activePanelId}
      // Solo LEE la variable; quien la define es la raiz de SplitZones, comun a las dos zonas del
      // borde (Ronda 3, items 14b+15 — definirla aqui hacia que cada pane tuviera su propio ancho).
      style={{ [dimension]: `var(${DOCK_ZONE_SIZE_VAR}, ${sizePx}px)` } as React.CSSProperties}
      className={`mg-island flex min-h-0 min-w-0 flex-col overflow-hidden bg-mg-panel ${borderClassName}`}
    >
      {/* Solo con mas de un panel compartiendo zona: para uno solo, el propio contenido (p.ej. la
          cabecera de ChatSidebar con la cuenta) ya dice de que va — una cabecera aqui seria redundante. */}
      {panels.length > 1 && activeDef !== undefined && (
        <div className="flex shrink-0 items-center gap-[6px] border-b border-mg-border px-[10px] py-[7px] text-[10.5px] font-bold tracking-[.03em] text-mg-ter">
          <span aria-hidden="true">{activeDef.icon}</span>
          {activeDef.title.toUpperCase()}
        </div>
      )}
      {/* El ANCHO/ALTO de la zona (fijado arriba via DOCK_ZONE_SIZE_VAR) NO se anima aqui: toca la
          matematica flex de SplitZones/DockZone y una animacion a medias ahi es peor que ninguna
          (riesgo de descuadrar el resize). Lo que SI se anima sin tocar esa matematica es el CONTENIDO:
          un fundido al abrir la zona y al cambiar de panel activo dentro de ella (F6, varios paneles
          por zona) — key=activePanelId hace que AnimatePresence lo trate como "entra uno, sale otro". */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence>
          <motion.div
            key={activePanelId}
            variants={PANEL_CONTENT_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
            className="absolute inset-0 overflow-y-auto"
          >
            {activeDef?.render()}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
