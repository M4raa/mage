import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Icon, type IconName } from './Icon';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { TOAST_VARIANTS } from '../motionPresets';
import { MAX_VISIBLE_TOASTS, tickRemaining, type AppNotification, type NotifyLevel } from '../notifications';
import { dismissToast, runNotificationAction, useNotificationStore } from '../notificationStore';

export const LEVEL_ICON: Readonly<Record<NotifyLevel, IconName>> = {
  info: 'info',
  success: 'check',
  warning: 'warning',
  error: 'error',
};

const LEVEL_SKIN: Readonly<Record<NotifyLevel, string>> = {
  info: 'border-mg-border-subtle bg-mg-popover text-mg-body',
  success: 'border-mg-border-subtle bg-mg-popover text-mg-body',
  warning: 'border-mg-warn-border bg-mg-warn-bg text-mg-warn-text',
  error: 'border-mg-danger-border bg-mg-danger-bg text-mg-danger',
};

// Pila de toasts abajo a la derecha, encima de la barra de estado (26 px + 8 de aire) y por debajo de los
// modales (z-50). Las dos regiones vivas existen SIEMPRE, aunque esten vacias: un lector de pantalla solo
// anuncia lo que se inserta en una region que ya estaba. Nunca roba el foco.
export function NotificationToasts(): React.JSX.Element {
  const toasts = useNotificationStore((s) => s.toasts);
  const visible = toasts.slice(0, MAX_VISIBLE_TOASTS);
  return (
    <section
      aria-label="Notificaciones"
      data-notification-toasts="true"
      className="pointer-events-none fixed bottom-[34px] right-[8px] z-40 flex w-[340px] max-w-[calc(100vw-16px)] flex-col gap-[6px]"
    >
      <div role="status" aria-live="polite" className="flex flex-col gap-[6px]">
        <AnimatePresence initial={false}>
          {visible.filter((n) => n.level !== 'error').map((n) => <Toast key={n.id} notification={n} />)}
        </AnimatePresence>
      </div>
      <div role="alert" className="flex flex-col gap-[6px]">
        <AnimatePresence initial={false}>
          {visible.filter((n) => n.level === 'error').map((n) => <Toast key={n.id} notification={n} />)}
        </AnimatePresence>
      </div>
    </section>
  );
}

function Toast({ notification }: { readonly notification: AppNotification }): React.JSX.Element {
  const { id } = notification;
  const panelRef = useDialogA11y({ onClose: () => dismissToast(id), stealFocusOnMount: false, trapTab: false });
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const attentive = useWindowAttention();
  // El reloj solo corre con la ventana a la vista y sin el usuario encima: un aviso que nace con Mage en
  // segundo plano no puede caducar sin que nadie lo vea.
  useToastClock(notification, hovered || focusWithin || !attentive);
  const titleId = `notification-title-${id}`;
  return (
    <motion.div
      ref={panelRef}
      layout
      variants={TOAST_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      aria-labelledby={titleId}
      data-notification-id={id}
      data-notification-level={notification.level}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocusWithin(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocusWithin(false);
      }}
      className={`pointer-events-auto rounded-[8px] border p-[8px_10px] text-[11px] mg-shadow-pop ${LEVEL_SKIN[notification.level]}`}
    >
      <NotificationContent notification={notification} titleId={titleId} onDismiss={() => dismissToast(id)} />
    </motion.div>
  );
}

// Cuerpo comun del toast y de la fila del centro de notificaciones.
export function NotificationContent({
  notification,
  titleId,
  onDismiss,
}: {
  readonly notification: AppNotification;
  readonly titleId: string;
  readonly onDismiss?: () => void;
}): React.JSX.Element {
  const { title, body, count, actions } = notification;
  return (
    <div className="flex items-start gap-[8px]">
      <Icon name={LEVEL_ICON[notification.level]} className="mt-[1px] shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex items-baseline gap-[6px]">
          <span id={titleId} className="min-w-0 flex-1 font-medium">
            {title}
          </span>
          {count > 1 && <span className="shrink-0 font-mono text-[10px] opacity-75" data-notification-count="true">×{count}</span>}
        </div>
        {/* Rutas y mensajes largos: dos lineas como mucho, el texto entero en el `title`. */}
        {body !== null && (
          <span className="line-clamp-2 break-all opacity-90" title={body}>
            {body}
          </span>
        )}
        {actions.length > 0 && (
          <div className="mt-[3px] flex flex-wrap gap-[6px]">
            {actions.map((action) => (
              <button
                key={action.label}
                onClick={() => runNotificationAction(notification.id, action)}
                className="cursor-pointer rounded-[5px] border border-mg-border-ctrl px-[7px] py-[2px] text-[10.5px] hover:bg-mg-hover"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {onDismiss !== undefined && (
        <button onClick={onDismiss} aria-label="Descartar notificación" className="shrink-0 cursor-pointer opacity-70 hover:opacity-100">
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  );
}

// Ventana enfocada y visible. `useSyncExternalStore` lee `document` en cada evento: sin estado propio.
function subscribeAttention(onChange: () => void): () => void {
  window.addEventListener('focus', onChange);
  window.addEventListener('blur', onChange);
  document.addEventListener('visibilitychange', onChange);
  return () => {
    window.removeEventListener('focus', onChange);
    window.removeEventListener('blur', onChange);
    document.removeEventListener('visibilitychange', onChange);
  };
}

function readAttention(): boolean {
  return document.hasFocus() && document.visibilityState === 'visible';
}

function useWindowAttention(): boolean {
  return useSyncExternalStore(subscribeAttention, readAttention);
}

// Cuenta atras pausable. Al pausar se guarda lo que queda; un aviso repetido (dedupe: sube `count`)
// vuelve a empezar desde su tiempo entero.
function useToastClock(notification: AppNotification, paused: boolean): void {
  const { id, timeoutMs, count } = notification;
  const remaining = useRef(timeoutMs ?? 0);
  useEffect(() => {
    remaining.current = timeoutMs ?? 0;
  }, [timeoutMs, count]);
  useEffect(() => {
    if (timeoutMs === null || paused) return;
    const startedAt = performance.now();
    const timer = setTimeout(() => dismissToast(id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = tickRemaining(remaining.current, performance.now() - startedAt);
    };
  }, [id, timeoutMs, count, paused]);
}
