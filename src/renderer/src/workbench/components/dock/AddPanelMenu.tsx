import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import type { PanelDefinition } from '../../panels/panelRegistry';
import type { PanelId } from '@shared/panelLayout';
import { POPOVER_VARIANTS } from '../../motionPresets';
import { Icon } from '../Icon';
import { PANEL_ICON_PX } from './Stripe';

// Menu "Añadir panel" del boton "⋮" al final de una stripe (F6, feedback del usuario tras ver la
// stripe en vivo: JetBrains deja añadir tool windows a una stripe desde un boton asi). MISMO patron que
// PanelMoveMenu.tsx/ConversationContextMenu.tsx (portal a body, clamp de posicion, role="menu",
// Escape/clic fuera cierra, foco al primer item al abrir porque este menu tambien se abre con teclado).
export function AddPanelMenu({
  panels,
  x,
  y,
  onClose,
  onSelect,
}: {
  readonly panels: readonly PanelDefinition[];
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  readonly onSelect: (panelId: PanelId) => void;
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

  const left = Math.min(x, window.innerWidth - 210);
  const top = Math.min(y, window.innerHeight - panels.length * 30 - 40);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <motion.div
        variants={POPOVER_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        ref={menuRef}
        role="menu"
        aria-label="Añadir panel a este borde"
        style={{ position: 'fixed', left, top, zIndex: 9999 }}
        className="w-[200px] overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] text-[11.5px] text-mg-body mg-shadow-pop"
      >
        <div className="truncate px-[10px] py-[5px] text-[10px] text-mg-muted">Añadir panel</div>
        <div className="my-[3px] h-px bg-mg-border-subtle" />
        {panels.map((p) => (
          <button
            key={p.id}
            role="menuitem"
            onClick={() => {
              onSelect(p.id);
              onClose();
            }}
            className="flex w-full items-center gap-[8px] px-[10px] py-[5px] text-left transition-colors duration-150 ease-out hover:bg-mg-hover"
          >
            <Icon name={p.icon} size={PANEL_ICON_PX} />
            {p.title}
          </button>
        ))}
      </motion.div>
    </>,
    document.body,
  );
}
