import { useRef } from 'react';
import { MIN_ZONE_SIZE_PX, RESIZE_STEP_PX, resolveResize, type Anchor } from '@shared/panelLayout';

// Divisor de resize de una zona (F6 Fase 4, PLAN-F6-PANELES.md §6). Restriccion de rendimiento
// explicita del plan: durante el arrastre, el feedback visual muta una variable CSS DIRECTAMENTE sobre
// el nodo de la zona (`paneRef.current.style.setProperty`) — sin despachar al store en cada
// `pointermove`. El valor se confirma (onCommit -> store -> IPC) solo al soltar, o de inmediato en
// teclado (que ya es discreto, un paso por pulsacion).
export const DOCK_ZONE_SIZE_VAR = '--dock-zone-size';
// Variable DISTINTA para el split entre 'a' y 'b' (2026-08-06, feedback del usuario: "los paneles
// divididos no se pueden agrandar o hacer mas pequeños") — una zona 'a' puede necesitar ajustar SU
// PROPIO tamaño (DOCK_ZONE_SIZE_VAR, contra el centro) Y a la vez el reparto con 'b' (esta), a la vez;
// dos variables porque son dos ejes perpendiculares e independientes.
export const DOCK_SPLIT_SIZE_VAR = '--dock-split-size';

// Grosor del divisor en px (feedback del usuario, 2026-08-06: "las lineas no estan cuadradas"). Causa
// real: en right/bottom el divisor "outer" se pinta ANTES del pane (handleFirst en DockZone.tsx), asi
// que el borde IZQUIERDO/SUPERIOR del pane queda desplazado este mismo grosor respecto al borde de su
// envoltorio — cualquier otro elemento que deba alinearse con ese borde (p.ej. ContextFooterConnected
// en RightDock.tsx) necesita el MISMO desplazamiento para que las lineas casen en la esquina. Constante
// compartida (no repetir "3" a mano en cada sitio) porque tiene que coincidir exactamente con w-[Npx]/
// h-[Npx] de abajo.
export const RESIZE_HANDLE_THICKNESS_PX = 3;

// Dos ejes sobre el MISMO mecanismo de arrastre/teclado:
// - 'outer' (por defecto, el original de F6): resizea la zona CONTRA el centro/la ventana. left/right
//   en vertical (columna, w-3px); bottom en horizontal (fila, h-3px).
// - 'split': resizea el reparto ENTRE 'a' y 'b' de la MISMA stripe cuando ambas estan abiertas — eje
//   CONTRARIO al 'outer' (left/right en horizontal; bottom en vertical) y el arrastre SIEMPRE crece
//   'a' hacia Right/Down (zona 'a' es siempre la de arriba/izquierda, sin el signo por lado del eje
//   'outer', que depende de en que lado de la ventana vive el borde).
export type ResizeAxis = 'outer' | 'split';

function orientationFor(anchor: Anchor, axis: ResizeAxis): 'vertical' | 'horizontal' {
  const outerOrientation = anchor === 'bottom' ? 'horizontal' : 'vertical';
  if (axis === 'outer') return outerOrientation;
  return outerOrientation === 'horizontal' ? 'vertical' : 'horizontal';
}

function dragSignFor(anchor: Anchor, axis: ResizeAxis): 1 | -1 {
  if (axis === 'split') return 1;
  return anchor === 'left' ? 1 : -1;
}

// Tope superior del resize: una fraccion del viewport disponible (el plan fija el minimo,
// MIN_ZONE_SIZE_PX, pero no un maximo numerico — decision de implementacion para que ninguna zona
// pueda colapsar el centro/las otras zonas por completo). Clave por ORIENTACION (no por anchor): el
// eje 'split' de left/right es horizontal (reparte alto, limitado por innerHeight) igual que el eje
// 'outer' de bottom — misma cuenta, msima formula.
const MAX_ZONE_FRACTION = 0.6;
// El eje 'split' NO reparte contra el centro, sino entre 'a' y 'b' del MISMO borde: el 0.6 del eje
// 'outer' dejaba a 'b' un suelo derivado de ~40% imposible de bajar (Ronda 3, item 14: "el panel de Uso
// no se puede achicar" — vive en la zona 'b' izquierda y no tiene handle propio de alto). Con 0.85, 'a'
// puede crecer casi hasta el final y 'b' encogerse de verdad, sin llegar nunca a colapsar a 0.
const MAX_SPLIT_FRACTION = 0.85;

function maxSizePx(orientation: 'vertical' | 'horizontal', axis: ResizeAxis): number {
  const viewportPx = orientation === 'horizontal' ? window.innerHeight : window.innerWidth;
  const fraction = axis === 'split' ? MAX_SPLIT_FRACTION : MAX_ZONE_FRACTION;
  return Math.max(MIN_ZONE_SIZE_PX, Math.floor(viewportPx * fraction));
}

function clientPosOf(orientation: 'vertical' | 'horizontal', e: { readonly clientX: number; readonly clientY: number }): number {
  return orientation === 'vertical' ? e.clientX : e.clientY;
}

export interface ZoneResizeHandleProps {
  readonly anchor: Anchor;
  readonly sizePx: number;
  readonly paneRef: React.RefObject<HTMLElement | null>;
  readonly onCommit: (sizePx: number) => void;
  readonly ariaLabel: string;
  readonly axis?: ResizeAxis; // default 'outer', preserva el comportamiento original de F6
  // Variable CSS a mutar en vivo (DOCK_ZONE_SIZE_VAR para 'outer', DOCK_SPLIT_SIZE_VAR para 'split') —
  // explicita en vez de derivada de `axis` para que el caller decida sin acoplar este componente a
  // donde vive cada variable.
  readonly sizeVar?: string;
}

export function ZoneResizeHandle({ anchor, sizePx, paneRef, onCommit, ariaLabel, axis = 'outer', sizeVar = DOCK_ZONE_SIZE_VAR }: ZoneResizeHandleProps): React.JSX.Element {
  const orientation = orientationFor(anchor, axis);
  const dragSign = dragSignFor(anchor, axis);
  const max = maxSizePx(orientation, axis);
  const dragStartRef = useRef<{ readonly pos: number; readonly size: number } | null>(null);

  const sizeFromPointer = (clientPos: number): number => {
    const drag = dragStartRef.current;
    if (drag === null) return sizePx;
    const delta = (clientPos - drag.pos) * dragSign;
    return Math.min(Math.max(drag.size + delta, MIN_ZONE_SIZE_PX), max);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { pos: clientPosOf(orientation, e), size: sizePx };

    const onMove = (ev: PointerEvent): void => {
      paneRef.current?.style.setProperty(sizeVar, `${sizeFromPointer(clientPosOf(orientation, ev))}px`);
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (dragStartRef.current === null) return;
      onCommit(sizeFromPointer(clientPosOf(orientation, ev)));
      dragStartRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // El caller solo escucha el par de flechas que tiene sentido para SU orientacion (§6: "el caller
  // decide que flechas escuchar segun la orientacion de su borde") — el otro par no hace nada aqui.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const relevantKeys = orientation === 'vertical' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (![...relevantKeys, 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    onCommit(resolveResize(sizePx, e.key, MIN_ZONE_SIZE_PX, max, RESIZE_STEP_PX)); // teclado: inmediato
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      aria-valuenow={sizePx}
      aria-valuemin={MIN_ZONE_SIZE_PX}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      style={orientation === 'vertical' ? { width: RESIZE_HANDLE_THICKNESS_PX } : { height: RESIZE_HANDLE_THICKNESS_PX }}
      // INVISIBLE en reposo (2026-09-21, feedback del usuario: "es visible todo el rato y encima es muy
      // grueso"). El grosor NO baja: 3 px es ya el minimo razonable para agarrarlo con el raton, y
      // adelgazar la zona sensible para que se vea menos seria cambiar un defecto visual por uno de
      // uso. Lo que se quita es el RELLENO: en reposo deja pasar el fondo del shell, o sea se lee como
      // el mismo hueco de 3 px que separa las islas entre si, y solo se pinta cuando el puntero o el
      // foco estan encima — que es cuando la linea significa algo. Es lo que hacen VS Code y JetBrains.
      className={`shrink-0 bg-transparent outline-none transition-colors duration-100 ease-out hover:bg-mg-focus focus-visible:bg-mg-focus ${
        orientation === 'vertical' ? 'cursor-col-resize' : 'cursor-row-resize'
      }`}
    />
  );
}
