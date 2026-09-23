import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Capa unica de tooltips (#8 de AJUSTES): sustituye los tooltips nativos del SO (lentos y feos) por
// una burbuja tematizada. Funciona por DELEGACION de eventos sobre cualquier elemento con `data-tip`
// (no hay que envolver cada control) y se posiciona con `position: fixed` (portal a body), asi NO lo
// recortan los contenedores con overflow (rail, tabbar, sidebar). Se muestra al pasar el raton o al
// enfocar por teclado, con un pequeno retardo; se oculta al salir, hacer scroll, click o Escape.

const SHOW_DELAY_MS = 350;
const GAP = 8; // separacion vertical entre el control y la burbuja
const MARGIN = 6; // margen minimo con CUALQUIER borde de la ventana al clampar

interface TipState {
  readonly text: string;
  readonly x: number; // centro horizontal del control (posicion IDEAL, se clampa tras medir la burbuja)
  readonly top: number; // borde superior del control
  readonly bottom: number; // borde inferior del control
}

export function TooltipLayer(): React.JSX.Element | null {
  const [tip, setTip] = useState<TipState | null>(null);
  // Posicion FINAL, calculada tras medir el ancho/alto real de la burbuja ya renderizada (ver el
  // useLayoutEffect de abajo). null mientras no se ha medido todavia = burbuja invisible ese primer
  // frame, para no hacer parpadear una posicion provisional incorrecta.
  const [rect, setRect] = useState<{ readonly left: number; readonly top: number } | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clear = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    const hide = (): void => {
      clear();
      setTip(null);
    };
    // Programa mostrar la burbuja para el control con data-tip mas cercano al target.
    const schedule = (target: EventTarget | null): void => {
      const el = target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null;
      const text = el?.dataset.tip ?? '';
      if (el === null || text.trim().length === 0) return;
      clear();
      timer = setTimeout(() => {
        const elRect = el.getBoundingClientRect();
        setTip({ text, x: elRect.left + elRect.width / 2, top: elRect.top, bottom: elRect.bottom });
      }, SHOW_DELAY_MS);
    };

    const onOver = (e: PointerEvent): void => schedule(e.target);
    const onFocus = (e: FocusEvent): void => schedule(e.target);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', hide);
    document.addEventListener('pointerdown', hide);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    // En captura: cualquier scroll interno tambien oculta (la burbuja quedaria descolocada).
    window.addEventListener('scroll', hide, true);
    window.addEventListener('wheel', hide, { passive: true });
    window.addEventListener('blur', hide);

    return () => {
      clear();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', hide);
      document.removeEventListener('pointerdown', hide);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('wheel', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Clampar solo el CENTRO (versión anterior) dejaba la mitad de la burbuja fuera de la ventana cuando
  // el control disparador estaba pegado a un borde y el texto era largo — bug reportado ("tooltips que
  // se cortan en los bordes"). Ahora se mide el ancho/alto REAL ya renderizado y se clampan los CUATRO
  // bordes de la caja, no solo su centro.
  useLayoutEffect(() => {
    if (tip === null) {
      setRect(null);
      return;
    }
    const node = tipRef.current;
    if (node === null) return;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const above = tip.top - GAP - height >= MARGIN;
    const idealLeft = tip.x - width / 2;
    const maxLeft = Math.max(MARGIN, window.innerWidth - MARGIN - width);
    const left = clamp(idealLeft, MARGIN, maxLeft);
    const top = above ? tip.top - GAP - height : Math.min(tip.bottom + GAP, window.innerHeight - MARGIN - height);
    setRect({ left, top });
  }, [tip]);

  if (tip === null) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: rect?.left ?? tip.x,
    top: rect?.top ?? tip.top,
    opacity: rect === null ? 0 : 1,
    pointerEvents: 'none',
    zIndex: 9999,
  };
  return createPortal(
    <div
      ref={tipRef}
      style={style}
      role="tooltip"
      className="mg-tip max-w-[280px] rounded-[6px] border border-mg-border-pop bg-mg-tooltip px-[8px] py-[4px] text-[11px] leading-[1.4] text-mg-tooltip-ink mg-shadow-pop"
    >
      {tip.text}
    </div>,
    document.body,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
