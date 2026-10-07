import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Icon } from './Icon';
import { NotificationContent } from './NotificationToasts';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { POPOVER_VARIANTS } from '../motionPresets';
import { unreadCount } from '../notifications';
import { clearNotificationHistory, markNotificationsRead, useNotificationStore } from '../notificationStore';

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

// Campana de la cabecera con el centro de notificaciones: las ultimas de esta ventana (en
// memoria, no se persisten), marcar como leidas y limpiar. Descartar un toast no lo quita de aqui.
export function NotificationBell(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const unread = useNotificationStore(unreadCount);
  const label = unread === 0 ? 'Notificaciones' : `Notificaciones (${unread} sin leer)`;
  return (
    <div className="relative flex items-center" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tip="Notificaciones"
        data-notification-bell="true"
        className="flex cursor-pointer items-center gap-[3px] rounded-[5px] px-[4px] py-[1px] hover:bg-mg-hover hover:text-mg-body"
      >
        <Icon name="bell" size={12} />
        {unread > 0 && (
          <span className="rounded-full bg-mg-activity px-[4px] font-mono text-[9px] leading-[13px] text-mg-window" data-notification-unread="true">
            {unread}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />
            <CenterPanel onClose={() => setOpen(false)} />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function CenterPanel({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  // Con Tab atrapado, como un modal: el velo de detras ya cierra al pulsar fuera, y asi Escape sigue
  // valiendo cuando «Limpiar» se deshabilita bajo el foco (Chromium lo manda a <body>).
  const panelRef = useDialogA11y({ onClose });
  const history = useNotificationStore((s) => s.history);
  const anyUnread = history.some((n) => !n.read);
  return (
    <motion.div
      ref={panelRef}
      variants={POPOVER_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      role="dialog"
      aria-label="Centro de notificaciones"
      data-notification-center="true"
      style={{ zIndex: 9999 }}
      className="absolute top-[calc(100%_+_10px)] right-0 flex max-h-[min(420px,70vh)] w-[340px] flex-col rounded-[9px] border border-mg-border-pop bg-mg-popover text-[11px] text-mg-body mg-shadow-pop"
    >
      <div className="flex items-center gap-[6px] border-b border-mg-border-subtle p-[8px_10px]">
        <span className="flex-1 text-[9.5px] font-bold tracking-[.08em] text-mg-ter">NOTIFICACIONES</span>
        <button onClick={markNotificationsRead} disabled={!anyUnread} className="cursor-pointer rounded-[5px] px-[6px] py-[1px] text-mg-sec hover:bg-mg-hover disabled:cursor-default disabled:opacity-40">
          Marcar como leídas
        </button>
        <button onClick={clearNotificationHistory} disabled={history.length === 0} className="cursor-pointer rounded-[5px] px-[6px] py-[1px] text-mg-sec hover:bg-mg-hover disabled:cursor-default disabled:opacity-40">
          Limpiar
        </button>
      </div>
      {history.length === 0 ? (
        <p className="p-[14px_10px] text-center text-mg-ter">No hay notificaciones.</p>
      ) : (
        <ul className="flex flex-col overflow-y-auto">
          {history.map((n) => (
            <li key={n.id} data-notification-entry={n.id} data-read={n.read} className="flex flex-col gap-[2px] border-b border-mg-border-subtle p-[8px_10px] last:border-b-0">
              <NotificationContent notification={n} titleId={`notification-entry-${n.id}`} />
              <span className="pl-[22px] text-[9.5px] text-mg-muted">
                {!n.read && <span className="mr-[5px] inline-block h-[5px] w-[5px] rounded-full bg-mg-activity" aria-label="Sin leer" />}
                {TIME_FORMAT.format(n.createdAtMs)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  );
}
