import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import type { MoveDestination } from '../../panels/panelLayoutOps';
import { POPOVER_VARIANTS } from '../../motionPresets';
import { Icon } from '../Icon';

const STEP_ITEMS = [
  { direction: -1, key: 'up', label: 'Subir', icon: 'arrowUp' },
  { direction: 1, key: 'down', label: 'Bajar', icon: 'arrowDown' },
] as const;

// Menu contextual "Mover a..." de un icono de stripe (F6 Fase 4, PLAN-F6-PANELES.md §6). MISMO patron
// que ConversationContextMenu.tsx (portal a body, posicion fija clamp, role="menu", Escape/clic fuera
// cierra) — no un componente nuevo desde cero, solo un dominio distinto (destino de panel en vez de
// cuenta/privacidad). Unica adicion sobre ese patron: al montar enfoca el primer item, porque este menu
// SI se abre por teclado (Shift+F10 / tecla de menu, ademas de clic derecho o el boton "⋮") y sin foco
// dentro seria inoperable sin raton.
export function PanelMoveMenu({
  panelTitle,
  destinations,
  x,
  y,
  onClose,
  onSelect,
  onHide,
  stepOptions,
  onStep,
}: {
  readonly panelTitle: string;
  readonly destinations: readonly MoveDestination[];
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  readonly onSelect: (destination: MoveDestination) => void;
  // "Esconder icono" (Ronda 3, item 11): saca el panel de la barra sin llevarlo a ningun destino.
  readonly onHide: () => void;
  // «Subir/Bajar»: reordenar el icono dentro de su zona con teclado (alternativa al arrastre). Un
  // extremo de la lista deshabilita su direccion.
  readonly stepOptions: { readonly up: boolean; readonly down: boolean };
  readonly onStep: (direction: -1 | 1) => void;
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Clamp para no salir de la ventana. El alto se aproxima: cabecera + separador (40) + un item por
  // destino (30) + el item "Esconder icono", que lleva dos lineas (44).
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - (destinations.length + 2) * 30 - 84);

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
        aria-label={`Mover panel ${panelTitle}`}
        style={{ position: 'fixed', left, top, zIndex: 9999 }}
        className="w-[190px] overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] text-[11.5px] text-mg-body mg-shadow-pop"
      >
        <div className="truncate px-[10px] py-[5px] text-[10px] text-mg-muted">Mover «{panelTitle}»</div>
        <div className="my-[3px] h-px bg-mg-border-subtle" />
        {STEP_ITEMS.map((item) => (
          <button
            key={item.direction}
            role="menuitem"
            disabled={!stepOptions[item.key]}
            onClick={() => {
              onStep(item.direction);
              onClose();
            }}
            className="flex w-full items-center gap-[6px] px-[10px] py-[5px] text-left transition-colors duration-150 ease-out hover:bg-mg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Icon name={item.icon} size={12} />
            {item.label}
          </button>
        ))}
        <div className="my-[3px] h-px bg-mg-border-subtle" />
        {destinations.map((d) => (
          <button
            key={`${d.anchor}-${d.zone}`}
            role="menuitem"
            onClick={() => {
              onSelect(d);
              onClose();
            }}
            className="block w-full px-[10px] py-[5px] text-left transition-colors duration-150 ease-out hover:bg-mg-hover"
          >
            {d.label}
          </button>
        ))}
        {/* Separado de los 6 destinos: no es "mover a", es "no estar en ningun sitio". Sin
            confirmacion — no destruye nada (el panel vuelve al menu "Añadir panel"), y el propio
            texto de ayuda lo dice. */}
        <div className="my-[3px] h-px bg-mg-border-subtle" />
        <button
          role="menuitem"
          onClick={() => {
            onHide();
            onClose();
          }}
          className="block w-full px-[10px] py-[5px] text-left transition-colors duration-150 ease-out hover:bg-mg-hover"
        >
          Esconder icono
          <span className="block text-[10px] text-mg-muted">Volverá a estar en «Añadir panel»</span>
        </button>
      </motion.div>
    </>,
    document.body,
  );
}
