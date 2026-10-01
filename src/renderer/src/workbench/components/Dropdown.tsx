import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { isArrowNavKey, nextIndexForArrow } from '../a11y/keyboardNav';
import { POPOVER_VARIANTS } from '../motionPresets';

export interface DropdownOption {
  readonly value: string;
  readonly label: string;
}

const MENU_WIDTH_PX = 170;
const MENU_ITEM_HEIGHT_PX = 28;
const MENU_PADDING_PX = 10;
const MENU_GAP_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

// Posicion fija del popover respecto al trigger. Puro para poder probar el caso que reporto el
// usuario: con el trigger pegado al fondo (PromptBar), el menu no cabe debajo y hay que VOLCARLO
// hacia arriba anclado al boton — antes se clampaba contra el borde de la ventana sin ninguna
// relacion geometrica con el trigger, asi que el menu nacia "suelto" muy por encima.
export function dropdownMenuPosition(
  rect: DOMRect | undefined,
  optionCount: number,
  viewport: Viewport,
): { readonly left: number; readonly top: number } {
  if (rect === undefined) return { left: 0, top: 0 };
  const menuHeight = optionCount * MENU_ITEM_HEIGHT_PX + MENU_PADDING_PX;
  const fitsBelow = rect.bottom + menuHeight + MENU_GAP_PX <= viewport.height;
  return {
    left: Math.min(rect.left, viewport.width - MENU_WIDTH_PX),
    top: fitsBelow
      ? rect.bottom + MENU_GAP_PX
      : Math.max(VIEWPORT_MARGIN_PX, rect.top - menuHeight - MENU_GAP_PX),
  };
}

// Selector propio (F6, feedback del usuario tras ver el `<select>` nativo en vivo: "muy feo en
// comparacion al resto de la aplicacion" y su popup nativo se pinta SIEMPRE por encima de cualquier
// capa propia — asi que el tooltip de otro control queda "por detras" mientras esta abierto, y no hay
// forma de arreglarlo con z-index porque el navegador lo renderiza fuera del DOM). Mismo patron de
// popover que PanelMoveMenu/ConversationContextMenu (portal a body, z-index propio, cierra con
// Escape/clic fuera): al vivir en NUESTRO stacking context, un tooltip nunca vuelve a quedar detras.
export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  tip,
  triggerClassName = '',
  leading,
}: {
  readonly value: string;
  readonly options: readonly DropdownOption[];
  readonly onChange: (value: string) => void;
  readonly ariaLabel: string;
  readonly tip?: string;
  readonly triggerClassName?: string;
  // Algo que va delante de la etiqueta en el disparador (el icono de la rama de git, P-026 3.5).
  readonly leading?: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(value)}"]`)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!isArrowNavKey(e.key)) return;
    e.preventDefault();
    const items = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
    if (items === undefined || items.length === 0) return;
    const current = Array.from(items).indexOf(document.activeElement as HTMLElement);
    const nextIndex = nextIndexForArrow(items.length, Math.max(0, current), e.key);
    items[nextIndex]?.focus();
  };

  const { left, top } = dropdownMenuPosition(triggerRef.current?.getBoundingClientRect(), options.length, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-tip={tip}
        className={`shrink-0 cursor-pointer self-center rounded-full border border-mg-border-ctrl bg-transparent px-[8px] py-[2px] text-[10.5px] text-mg-sec outline-none transition-colors duration-150 ease-out hover:text-mg-body ${triggerClassName}`}
      >
        {leading === undefined ? (
          selectedLabel
        ) : (
          <span className="inline-flex items-center gap-[5px]">
            {leading}
            <span className="truncate">{selectedLabel}</span>
          </span>
        )}
      </button>
      {createPortal(
        // AnimatePresence VA DENTRO del portal, no envolviendolo: un createPortal(...) no es un
        // elemento React valido (React.isValidElement devuelve false), asi que si AnimatePresence lo
        // recibe como hijo directo lo descarta en silencio y el popover nunca llega al DOM (medido por
        // CDP: aria-expanded pasaba a true pero no aparecia ningun nodo con role="listbox"). Aqui
        // dentro el hijo condicional es un Fragment, que si es un elemento valido.
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0 z-[9998]" onClick={close} />
              <motion.div
                variants={POPOVER_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                ref={listRef}
                role="listbox"
                aria-label={ariaLabel}
                onKeyDown={onListKeyDown}
                style={{ position: 'fixed', left, top, zIndex: 9999 }}
                className="max-h-[70vh] w-[170px] overflow-y-auto rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] text-[11.5px] text-mg-body mg-shadow-pop"
              >
                {options.map((o) => (
                  <button
                    key={o.value}
                    role="option"
                    data-value={o.value}
                    aria-selected={o.value === value}
                    tabIndex={o.value === value ? 0 : -1}
                    onClick={() => {
                      // Como el <select> nativo: reelegir la opción puesta no es un cambio (el selector
                      // de modelo avisaba «Modelo cambiado» al reelegir Opus sobre `opus[1m]`).
                      if (o.value !== value) onChange(o.value);
                      close();
                    }}
                    className={`block w-full px-[10px] py-[5px] text-left transition-colors duration-150 ease-out hover:bg-mg-hover ${
                      o.value === value ? 'font-bold text-mg-focus' : ''
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
