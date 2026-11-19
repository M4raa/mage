import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useLocalPopover } from '../localPopovers';
import { POPOVER_VARIANTS } from '../motionPresets';
import { useT } from '../../i18n/uiLanguage';
import { reportActionError } from '../notificationStore';

// Ancho del menú y alto aproximado (tres elementos), para no salirse de la ventana.
const MENU_WIDTH = 220;
const MENU_HEIGHT = 100;
const ITEM_CLASS =
  'block w-full px-[10px] py-[5px] text-left transition-colors duration-90 ease-out hover:bg-mg-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

// Menú contextual de un enlace del chat. Mismo patrón que PanelMoveMenu.tsx (portal a body, capa que cierra, role="menu",
// Escape cierra, foco al primer elemento): ofrece siempre los dos navegadores, sea cual sea el ajuste del clic normal.
export function LinkContextMenu({
  href,
  x,
  y,
  canOpenInternal,
  onClose,
  onOpenInternal,
  onOpenExternal,
}: {
  readonly href: string;
  readonly x: number;
  readonly y: number;
  readonly canOpenInternal: boolean;
  readonly onClose: () => void;
  readonly onOpenInternal: () => void;
  readonly onOpenExternal: () => void;
}): React.JSX.Element {
  const t = useT();
  const menuRef = useRef<HTMLDivElement>(null);
  useLocalPopover(true); // el menú existe solo abierto

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = (): void => {
    navigator.clipboard.writeText(href).catch((err: unknown) => reportActionError(t('chat.artifact.copyFailed'), err, 'chat-link'));
    onClose();
  };
  const run = (action: () => void): void => {
    action();
    onClose();
  };

  const left = Math.max(0, Math.min(x, window.innerWidth - MENU_WIDTH));
  const top = Math.max(0, Math.min(y, window.innerHeight - MENU_HEIGHT));

  return createPortal(
    <>
      {/* Capa invisible: un clic fuera cierra el menú. */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <motion.div
        variants={POPOVER_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        ref={menuRef}
        role="menu"
        aria-label={href}
        style={{ position: 'fixed', left, top, zIndex: 9999, width: MENU_WIDTH }}
        className="overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] text-[11.5px] text-mg-body mg-shadow-pop"
      >
        <button role="menuitem" data-link-menu="internal" disabled={!canOpenInternal} onClick={() => run(onOpenInternal)} className={ITEM_CLASS}>
          {t('chat.link.openInternal')}
        </button>
        <button role="menuitem" data-link-menu="external" onClick={() => run(onOpenExternal)} className={ITEM_CLASS}>
          {t('chat.link.openExternal')}
        </button>
        <button role="menuitem" data-link-menu="copy" onClick={copy} className={ITEM_CLASS}>
          {t('chat.link.copy')}
        </button>
      </motion.div>
    </>,
    document.body,
  );
}
