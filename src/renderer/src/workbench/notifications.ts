// Notificaciones propias de Mage (toasts + centro de notificaciones). Modulo PURO: datos -> datos. El
// store (`notificationStore.ts`) pone los ids y la hora; el componente, el reloj y el DOM.
//
// Dos listas con el MISMO objeto:
//   - `toasts`: las vivas en pantalla. Las `MAX_VISIBLE_TOASTS` primeras se ven; el resto espera en cola.
//   - `history`: las ultimas del centro de notificaciones (la campana), la mas nueva primero. Descartar un
//     toast no lo quita de aqui: es justo lo que el centro guarda.

export type NotifyLevel = 'info' | 'success' | 'warning' | 'error';

export interface NotifyAction {
  readonly label: string;
  readonly run: () => void | Promise<void>;
}

export interface NotifyInput {
  readonly level: NotifyLevel;
  readonly title: string;
  readonly body?: string;
  // Maximo `MAX_ACTIONS`; pulsar una descarta el toast.
  readonly actions?: readonly NotifyAction[];
  // undefined = el del nivel (`defaultTimeoutFor`); null = persistente hasta la ✕.
  readonly timeoutMs?: number | null;
  // Misma clave = sustituye a la anterior, reinicia su reloj y suma `count` («×2»).
  readonly dedupeKey?: string;
  // Quien la emite ('worktree', 'prompt', 'git'…): para el log y los tests.
  readonly source: string;
}

export interface AppNotification {
  readonly id: string;
  readonly level: NotifyLevel;
  readonly title: string;
  readonly body: string | null;
  readonly actions: readonly NotifyAction[];
  readonly timeoutMs: number | null;
  readonly dedupeKey: string | null;
  readonly source: string;
  readonly count: number;
  readonly createdAtMs: number;
  readonly read: boolean;
}

export interface NotificationsState {
  readonly toasts: readonly AppNotification[];
  readonly history: readonly AppNotification[];
}

export const EMPTY_NOTIFICATIONS: NotificationsState = { toasts: [], history: [] };

// Tres a la vez, como VS Code: mas tapan el trabajo.
export const MAX_VISIBLE_TOASTS = 3;
// ponytail: tope fijo de la cola; al pasarlo se va el no-error mas antiguo (sigue en el centro).
export const MAX_QUEUED_TOASTS = 20;
// Lo que guarda el centro de notificaciones (en memoria, por ventana).
export const MAX_HISTORY = 20;
export const MAX_ACTIONS = 2;

const INFO_TIMEOUT_MS = 6000;
const WARNING_TIMEOUT_MS = 10_000;

const DEFAULT_TIMEOUT: Readonly<Record<NotifyLevel, number | null>> = {
  info: INFO_TIMEOUT_MS,
  success: INFO_TIMEOUT_MS,
  warning: WARNING_TIMEOUT_MS,
  // Un error no caduca: si nadie lo ve, no se ha avisado.
  error: null,
};

export function defaultTimeoutFor(level: NotifyLevel): number | null {
  return DEFAULT_TIMEOUT[level];
}

// Contrato de la entrada: lanza con el valor recibido (titulo vacio, tiempo negativo, demasiadas acciones).
export function validateNotifyInput(input: NotifyInput): void {
  if (input.title.trim().length === 0) throw new Error(`notify: el titulo no puede estar vacio (recibido ${JSON.stringify(input.title)})`);
  const timeout = input.timeoutMs;
  if (timeout !== undefined && timeout !== null && (!Number.isFinite(timeout) || timeout < 0)) {
    throw new Error(`notify: timeoutMs tiene que ser un numero >= 0 o null (recibido ${String(timeout)})`);
  }
  const actions = input.actions?.length ?? 0;
  if (actions > MAX_ACTIONS) throw new Error(`notify: como mucho ${MAX_ACTIONS} acciones (recibidas ${actions})`);
}

export interface PushContext {
  readonly id: string;
  readonly nowMs: number;
}

// Añade (o sustituye por `dedupeKey`) una notificacion en los toasts y en el centro.
export function pushNotification(state: NotificationsState, input: NotifyInput, context: PushContext): NotificationsState {
  validateNotifyInput(input);
  const key = input.dedupeKey ?? null;
  const onScreen = key === null ? undefined : state.toasts.find((n) => n.dedupeKey === key);
  const previous = onScreen ?? (key === null ? undefined : state.history.find((n) => n.dedupeKey === key));
  // El que ya esta en pantalla conserva su id (y su sitio): se actualiza en vez de salir y volver a entrar.
  const next = buildNotification(input, { ...context, id: onScreen?.id ?? context.id }, (previous?.count ?? 0) + 1);
  const toasts = onScreen !== undefined ? state.toasts.map((n) => (n.id === onScreen.id ? next : n)) : capQueue([...state.toasts, next]);
  const history = [next, ...state.history.filter((n) => key === null || n.dedupeKey !== key)].slice(0, MAX_HISTORY);
  return { toasts, history };
}

function buildNotification(input: NotifyInput, context: PushContext, count: number): AppNotification {
  return {
    id: context.id,
    level: input.level,
    title: input.title,
    body: input.body === undefined || input.body.trim().length === 0 ? null : input.body,
    actions: input.actions ?? [],
    timeoutMs: input.timeoutMs === undefined ? defaultTimeoutFor(input.level) : input.timeoutMs,
    dedupeKey: input.dedupeKey ?? null,
    source: input.source,
    count,
    createdAtMs: context.nowMs,
    read: false,
  };
}

// Con la cola llena se descarta el no-error mas antiguo de la COLA (nunca uno visible, nunca un error).
function capQueue(toasts: readonly AppNotification[]): readonly AppNotification[] {
  if (toasts.length <= MAX_VISIBLE_TOASTS + MAX_QUEUED_TOASTS) return toasts;
  const dropIndex = toasts.findIndex((n, index) => index >= MAX_VISIBLE_TOASTS && n.level !== 'error');
  if (dropIndex === -1) return toasts;
  return toasts.filter((_, index) => index !== dropIndex);
}

// Quita el toast (el centro lo conserva). Un id que ya no esta no es un error: el reloj y la ✕ compiten.
export function dismissNotification(state: NotificationsState, id: string): NotificationsState {
  if (!state.toasts.some((n) => n.id === id)) return state;
  return { ...state, toasts: state.toasts.filter((n) => n.id !== id) };
}

export function markAllRead(state: NotificationsState): NotificationsState {
  if (state.history.every((n) => n.read)) return state;
  return { ...state, history: state.history.map((n) => (n.read ? n : { ...n, read: true })) };
}

// «Limpiar» vacia el centro. Los toasts en pantalla siguen hasta que caduquen o se descarten.
export function clearHistory(state: NotificationsState): NotificationsState {
  return { ...state, history: [] };
}

export function unreadCount(state: NotificationsState): number {
  return state.history.filter((n) => !n.read).length;
}

// Lo que le queda a un toast tras `elapsedMs` de reloj CORRIENDO (pausado no se llama). Nunca baja de 0.
export function tickRemaining(remainingMs: number, elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) throw new Error(`tickRemaining: elapsedMs tiene que ser >= 0 (recibido ${String(elapsedMs)})`);
  return Math.max(0, remainingMs - elapsedMs);
}
