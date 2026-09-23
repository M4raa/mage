import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { POPOVER_VARIANTS, TAB_COLOR_SWATCH_TRANSITION } from '../motionPresets';
import { TAB_COLOR_COUNT } from '../tabActions';
import type { DropZone } from '../splitLayout';

// Menu contextual de una pestaña (Ronda 3, item 12: "clic derecho en pestañas, falta menu contextual").
// MISMO patron que ConversationContextMenu/PanelMoveMenu (portal a body, posicion fija con clamp,
// role="menu", Escape/clic fuera cierra). El estado de apertura vive en TabBar, que tambien envuelve
// esto en AnimatePresence.
//
// "Cerrar todas" NO pide confirmacion (decision del usuario, 2026-09-15): cerrar dejo de ser
// destructivo — una conversacion con trabajo en vuelo se va a segundo plano en vez de morir, y todas
// siguen en el historial. Un dialogo para algo reversible es un clic de peaje.
//
// "Dividir a..." (I11-drag): alternativa SIN raton al arrastre (mismo patron que "Mover a..." de los
// iconos de panel en F6, dock/Stripe.tsx) — mueve esta pestaña a un panel nuevo junto al ENFOCADO.
const SPLIT_OPTIONS: readonly { readonly zone: DropZone; readonly label: string }[] = [
  { zone: 'right', label: 'Dividir a la derecha' },
  { zone: 'bottom', label: 'Dividir abajo' },
  { zone: 'left', label: 'Dividir a la izquierda' },
  { zone: 'top', label: 'Dividir arriba' },
];

export function TabContextMenu({
  title,
  pinned,
  colorIndex,
  closableCount,
  inactiveCount,
  canSplit,
  x,
  y,
  onClose,
  onCloseTab,
  onCloseAll,
  onCloseInactive,
  onTogglePinned,
  onPickColor,
  onSplit,
  windows,
  onMoveToNewWindow,
  onMoveToWindow,
}: {
  readonly title: string;
  readonly pinned: boolean;
  readonly colorIndex: number | undefined;
  // Cuantas cerraria cada accion en masa: se enseña en el propio item (nunca un "cerrar todas" que no
  // dice cuantas mata) y a 0 lo deshabilita.
  readonly closableCount: number;
  readonly inactiveCount: number;
  // Falso si esta pestaña YA es la enfocada: dividir un panel con su propio contenido no significa
  // nada. Deshabilita los 4 "Dividir a..." en vez de escondelos (un menu que cambia de tamaño segun
  // el estado es peor).
  readonly canSplit: boolean;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  readonly onCloseTab: () => void;
  readonly onCloseAll: () => void;
  readonly onCloseInactive: () => void;
  readonly onTogglePinned: () => void;
  readonly onPickColor: (colorIndex: number | undefined) => void;
  readonly onSplit: (zone: DropZone) => void;
  // MULTIVENTANA: sacar la pestaña a una ventana nueva, o mandarla a una ya abierta. `windows` son las
  // OTRAS ventanas (main ya excluye la actual); vacia = solo se ofrece "ventana nueva".
  readonly windows: readonly { readonly windowId: string }[];
  readonly onMoveToNewWindow: () => void;
  readonly onMoveToWindow: (windowId: string) => void;
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: MENU_WIDTH_PX, height: 0 });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) return;
    setSize({ width: menu.offsetWidth, height: menu.offsetHeight });
  }, []);

  useEffect(() => {
    // Se abre tambien por teclado (Shift+F10 / tecla de menu), asi que sin foco dentro seria
    // inoperable sin raton — mismo motivo que en PanelMoveMenu.
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Clamp para no salir de la ventana. Se MIDE el menu real (antes del pintado) en vez de descontar un
  // alto aproximado: ese numero depende del contenido y se quedo obsoleto en cuanto el menu perdio tres
  // filas (2.11). `offsetWidth/Height` y no `getBoundingClientRect`: el popover entra con una animacion
  // de escala y el rect mentiria a mitad de la transicion. Se mide UNA sola vez: desde que se fue la
  // confirmacion de "Cerrar todas", el contenido del menu ya no cambia de alto mientras esta abierto.
  const left = Math.max(0, Math.min(x, window.innerWidth - size.width - MENU_MARGIN_PX));
  const top = Math.max(0, Math.min(y, window.innerHeight - size.height - MENU_MARGIN_PX));

  return createPortal(
    <>
      {/* Capa invisible: un clic fuera cierra el menu. */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <motion.div
        variants={POPOVER_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        ref={menuRef}
        role="menu"
        aria-label={`Acciones de la pestaña ${title}`}
        style={{ position: 'fixed', left, top, zIndex: 9999, width: MENU_WIDTH_PX }}
        className="overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] text-[11.5px] text-mg-body mg-shadow-pop"
      >
        {/* 2.11: sin fila de titulo (el menu se abre SOBRE la pestaña, ya se ve cual es) y sin
            subtitulos explicativos bajo los items. El nombre de la pestaña sigue en el `aria-label`
            del menu, que es donde lo necesita un lector de pantalla. */}
        <MenuItem onClick={() => { onTogglePinned(); onClose(); }}>{pinned ? 'Desanclar' : 'Anclar'}</MenuItem>

        <div className="my-[3px] h-px bg-mg-border-subtle" />
        {SPLIT_OPTIONS.map(({ zone, label }) => (
          <MenuItem key={zone} disabled={!canSplit} onClick={() => { onSplit(zone); onClose(); }}>
            {label}
          </MenuItem>
        ))}

        <div className="my-[3px] h-px bg-mg-border-subtle" />
        <MenuItem onClick={() => { onMoveToNewWindow(); onClose(); }}>Mover a una ventana nueva</MenuItem>
        {windows.map((w, index) => (
          <MenuItem key={w.windowId} onClick={() => { onMoveToWindow(w.windowId); onClose(); }}>
            {`Mover a la ventana ${index + 2}`}
          </MenuItem>
        ))}

        <div className="my-[3px] h-px bg-mg-border-subtle" />
        <div className="px-[10px] pt-[2px] text-[9.5px] font-bold tracking-[.06em] text-mg-ter">COLOR</div>
        <ColorSwatches selected={colorIndex} onPick={(index) => { onPickColor(index); onClose(); }} />

        <div className="my-[3px] h-px bg-mg-border-subtle" />

        <MenuItem onClick={() => { onCloseTab(); onClose(); }}>Cerrar</MenuItem>
        <MenuItem
          disabled={inactiveCount === 0}
          onClick={() => { onCloseInactive(); onClose(); }}
        >
          Cerrar las inactivas ({inactiveCount})
        </MenuItem>

        <MenuItem disabled={closableCount === 0} danger onClick={() => { onCloseAll(); onClose(); }}>
          Cerrar todas ({closableCount})
        </MenuItem>
      </motion.div>
    </>,
    document.body,
  );
}

// Ancho del menu (el mismo que tenia como clase `w-[220px]`; ahora tambien lo necesita el clamp) y
// margen que se le deja al borde de la ventana.
const MENU_WIDTH_PX = 220;
const MENU_MARGIN_PX = 10;

// Fila de muestras de color: los MISMOS acentos del tema que usan las cuentas (no una paleta nueva) +
// "sin color" para volver a heredar el de la cuenta.
function ColorSwatches({
  selected,
  onPick,
}: {
  readonly selected: number | undefined;
  readonly onPick: (colorIndex: number | undefined) => void;
}): React.JSX.Element {
  return (
    <div role="group" aria-label="Color de la pestaña" className="flex flex-wrap items-center gap-[6px] px-[10px] py-[6px]">
      {Array.from({ length: TAB_COLOR_COUNT }, (_, index) => (
        <motion.button
          key={index}
          whileHover={{ scale: 1.15 }}
          transition={TAB_COLOR_SWATCH_TRANSITION}
          onClick={() => onPick(index)}
          aria-label={`Color ${index + 1}`}
          aria-pressed={selected === index}
          className={`h-[16px] w-[16px] rounded-[5px] border ${selected === index ? 'border-mg-focus' : 'border-transparent'}`}
          style={{ background: `var(--mg-accent-${index}-base)` }}
        />
      ))}
      <button
        onClick={() => onPick(undefined)}
        aria-label="Sin color propio, usar el de la cuenta"
        aria-pressed={selected === undefined}
        data-tip="Usar el color de la cuenta"
        className={`h-[16px] rounded-[5px] border border-dashed px-[5px] text-[9px] leading-[14px] text-mg-muted ${
          selected === undefined ? 'border-mg-focus text-mg-body' : 'border-mg-border-ctrl'
        }`}
      >
        auto
      </button>
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled = false,
  danger = false,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
}): React.JSX.Element {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`block w-full px-[10px] py-[5px] text-left transition-colors duration-150 ease-out disabled:opacity-40 ${
        danger ? 'text-mg-danger hover:bg-mg-danger-bg' : 'hover:bg-mg-hover'
      }`}
    >
      {children}
    </button>
  );
}
