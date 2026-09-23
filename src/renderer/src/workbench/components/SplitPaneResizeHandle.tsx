import { useEffect, useRef } from 'react';

// Divisor de resize entre los dos lados de una division del workspace (I11 — generaliza el split fijo
// de Ronda 3 item 13). A diferencia de `dock/ZoneResizeHandle.tsx` (F6), que resizea una zona en PIXELES
// contra el borde de la ventana, aqui el reparto es una FRACCION (0..1) del contenedor flex inmediato:
// el propio arbol de paneles puede anidarse a cualquier profundidad, asi que no hay un "viewport" fijo
// contra el que medir.
const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;
const RESIZE_STEP = 0.03;

// Reparto en vivo durante el arrastre, misma restriccion de rendimiento que `ZoneResizeHandle` (F6): el
// `pointermove` muta estas variables CSS sobre el contenedor de la division y NO despacha al store —
// escribir el ratio en cada movimiento re-renderizaba el arbol entero de `ChatPane` a ritmo de raton. El
// store se toca solo al soltar (y de inmediato en teclado, que ya es un paso por pulsacion). Son DOS
// variables (y no `calc(1 - a)`) porque `flex-grow` es un <number>: dos numeros ya resueltos en JS no
// dependen de que el motor acepte calc() en esa propiedad.
export const SPLIT_A_VAR = '--split-a';
export const SPLIT_B_VAR = '--split-b';

export function splitRatioVars(ratio: number): React.CSSProperties {
  return { [SPLIT_A_VAR]: ratio, [SPLIT_B_VAR]: 1 - ratio } as React.CSSProperties;
}

export interface SplitPaneResizeHandleProps {
  readonly direction: 'row' | 'col'; // misma orientacion que el split al que pertenece
  readonly ratio: number;
  readonly containerRef: React.RefObject<HTMLElement | null>;
  readonly onCommit: (ratio: number) => void;
  readonly ariaLabel: string;
}

export function SplitPaneResizeHandle({ direction, ratio, containerRef, onCommit, ariaLabel }: SplitPaneResizeHandleProps): React.JSX.Element {
  const dragStartRef = useRef<{ readonly pos: number; readonly size: number; readonly ratio: number } | null>(null);
  // Como soltar los listeners de `window` desde FUERA del gesto (auditoria B.1.3). Sin esto solo los
  // quitaba `pointerup`, y hay dos caminos por los que ese `pointerup` no llega: desmontar el panel a
  // media divisoria, y un `pointercancel` —que con `setPointerCapture` SUSTITUYE al `pointerup` cuando
  // el navegador aborta el gesto (lapiz, tactil)—. En los dos quedaba el `pointermove` enganchado y,
  // como `dragStartRef` seguia no nulo, mover el raton SIN boton pulsado seguia redimensionando.
  const detachRef = useRef<(() => void) | null>(null);
  useEffect(() => () => detachRef.current?.(), []);
  const clientPos = (e: { readonly clientX: number; readonly clientY: number }): number => (direction === 'row' ? e.clientX : e.clientY);

  const ratioFromPointer = (pos: number): number => {
    const drag = dragStartRef.current;
    if (drag === null || drag.size <= 0) return ratio;
    const delta = (pos - drag.pos) / drag.size;
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, drag.ratio + delta));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    const container = containerRef.current;
    const rect = container?.getBoundingClientRect();
    if (container === null || container === undefined || rect === undefined) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { pos: clientPos(e), size: direction === 'row' ? rect.width : rect.height, ratio };

    const onMove = (ev: PointerEvent): void => {
      const next = ratioFromPointer(clientPos(ev));
      container.style.setProperty(SPLIT_A_VAR, `${next}`);
      container.style.setProperty(SPLIT_B_VAR, `${1 - next}`);
    };
    const detach = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      detachRef.current = null;
      dragStartRef.current = null;
    };
    const onUp = (ev: PointerEvent): void => {
      const dragging = dragStartRef.current !== null;
      const next = ratioFromPointer(clientPos(ev));
      detach();
      if (dragging) onCommit(next);
    };
    // Gesto ABORTADO: no se confirma el reparto, y hay que devolver las variables en vivo al ratio
    // comprometido — las escribe `onMove` como estilo INLINE, asi que sin restaurarlas la division se
    // quedaria pintada donde iba el arrastre mientras el store dice otra cosa.
    const onCancel = (): void => {
      detach();
      container.style.setProperty(SPLIT_A_VAR, `${ratio}`);
      container.style.setProperty(SPLIT_B_VAR, `${1 - ratio}`);
    };
    detachRef.current = detach;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    const relevantKeys = direction === 'row' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (!relevantKeys.includes(e.key)) return;
    e.preventDefault();
    const grows = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    onCommit(Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio + (grows ? RESIZE_STEP : -RESIZE_STEP))));
  };

  // Patron de VS Code (feedback del usuario, 2026-09-15: "no se ve y cuesta cogerla"): la LINEA sigue
  // midiendo 1 px —es una divisoria, no una barra— pero la zona de AGARRE se extiende 3 px a cada lado
  // con un `::after` transparente, que el hit-testing atribuye a este mismo elemento sin ocupar sitio en
  // el flex (de ahi el `z-10`: el area invisible monta sobre los paneles vecinos). En hover/foco el
  // `shadow` pinta 1 px extra a cada lado: se ve la divisoria sin mover ni un pixel del layout.
  const grabArea = direction === 'row' ? 'after:inset-y-0 after:-left-[3px] after:-right-[3px]' : 'after:inset-x-0 after:-top-[3px] after:-bottom-[3px]';
  return (
    <div
      role="separator"
      aria-orientation={direction === 'row' ? 'vertical' : 'horizontal'}
      aria-label={ariaLabel}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={Math.round(MIN_RATIO * 100)}
      aria-valuemax={Math.round(MAX_RATIO * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`relative z-10 shrink-0 bg-mg-border outline-none after:absolute after:content-[''] hover:bg-mg-focus hover:shadow-[0_0_0_1px_var(--color-mg-focus)] focus-visible:bg-mg-focus focus-visible:shadow-[0_0_0_1px_var(--color-mg-focus)] ${grabArea} ${
        direction === 'row' ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
      }`}
    />
  );
}
