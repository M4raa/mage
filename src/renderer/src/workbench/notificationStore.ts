import { create } from 'zustand';
import {
  EMPTY_NOTIFICATIONS,
  clearHistory,
  dismissNotification,
  markAllRead,
  pushNotification,
  type NotificationsState,
  type NotifyAction,
  type NotifyInput,
} from './notifications';

// Store propio de las notificaciones de Mage, aparte del `workbenchStore`. Por ventana (cada ventana es
// su renderer) y en memoria: el centro no se persiste. `notify()` es funcion de modulo para poder
// llamarla desde stores y componentes sin hooks.
export const useNotificationStore = create<NotificationsState>(() => EMPTY_NOTIFICATIONS);

let nextId = 0;

export function notify(input: NotifyInput): string {
  const id = `n${++nextId}`;
  const next = pushNotification(useNotificationStore.getState(), input, { id, nowMs: Date.now() });
  useNotificationStore.setState(next, true);
  // Con dedupe el id puede ser el del toast que ya estaba.
  return next.history[0]?.id ?? id;
}

export function dismissToast(id: string): void {
  useNotificationStore.setState((s) => dismissNotification(s, id), true);
}

export function markNotificationsRead(): void {
  useNotificationStore.setState((s) => markAllRead(s), true);
}

export function clearNotificationHistory(): void {
  useNotificationStore.setState((s) => clearHistory(s), true);
}

// Pulsar una accion descarta el toast. Si la accion falla no se traga: sale otro aviso de error.
export function runNotificationAction(id: string, action: NotifyAction): void {
  dismissToast(id);
  void Promise.resolve()
    .then(() => action.run())
    .catch((err: unknown) => reportActionError(`No se pudo «${action.label}»`, err, 'notification-action'));
}

// Fallo de una accion del usuario: se queda en el log (como antes) y ademas se ve. `dedupeKey` agrupa
// los que se repiten (un guardado con debounce fallaria en cada cambio).
export function reportActionError(title: string, err: unknown, source: string, dedupeKey?: string): void {
  const message = describeError(err);
  console.warn(`${title}:`, message);
  notify({ level: 'error', title, body: message, source, ...(dedupeKey === undefined ? {} : { dedupeKey }) });
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
