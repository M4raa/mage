import type { MageEvent } from '@shared/events';
import type { ChatStatus } from './types';
import { t } from '../i18n/uiLanguage';

// Cerrar una conversacion con trabajo en vuelo NO la corta (decision del usuario, 2026-09-15): la
// sesion del CLI sigue viva "en segundo plano" y la conversacion reaparece en el panel de
// Conversaciones marcada como pendiente. Aqui viven las decisiones PURAS de ese estado —sin store ni
// IPC— para poder probarlas; el cableado (parar sesiones, notificar, temporizadores) vive en
// workbenchStore.
export type BackgroundState =
  | 'working' // el agente sigue trabajando sin pestaña a la vista
  | 'needs_action' // pidio un permiso y nadie puede contestarle: hay que reabrirla
  | 'done'; // el turno acabo: pendiente de revision

export interface BackgroundSession {
  readonly sessionId: string; // la sesion VIVA de Mage: con la que se habla con main (parar, eventos)
  // La CONVERSACION (conversationIdOfTab al cerrar), con la que pregunta el historial. En Codex y agy es el
  // hilo y no coincide con `sessionId`; sin hilo todavia no hay conversacion que buscar.
  readonly conversationId: string | undefined;
  readonly title: string; // el de la pestaña al cerrarla (la fila del historial puede tardar en refrescarse)
  readonly accountId: string;
  readonly state: BackgroundState;
  readonly sinceMs: number; // cuando se mando a segundo plano (la caducidad la lleva main, F2.4)
}

// Solo se manda a segundo plano lo que TIENE trabajo vivo. Una conversacion parada se cierra como
// siempre (su proceso se para): dejarla viva seria pagar un CLI por cada pestaña que se cierra.
export function shouldBackgroundOnClose(status: ChatStatus | undefined): boolean {
  return status === 'streaming' || status === 'needs_permission';
}

// Motivo por el que una pestaña NO se puede mover a otra ventana (ni arrastrar fuera), o null si se
// puede (P-028, 36, D36-2a). Con un turno en marcha, moverla es cerrarla aqui —la mandaria a segundo
// plano con el CLI vivo— y la otra ventana no podria reanudarla. No hay traspaso en vivo de la sesion.
export function tabMoveBlockedReason(status: ChatStatus | undefined): string | null {
  if (!shouldBackgroundOnClose(status)) return null;
  return t('history.background.tabMoveBlocked');
}

// La entrada de segundo plano de una conversacion del historial. La UNICA busqueda por conversacion: el mapa
// va por la sesion viva y el historial no la conoce. Recorre las entradas: son las pocas que se cerraron
// trabajando, nunca el historial entero.
export function backgroundOfConversation(
  sessions: Readonly<Record<string, BackgroundSession>>,
  conversationId: string,
): BackgroundSession | undefined {
  return Object.values(sessions).find((b) => b.conversationId === conversationId);
}

// Lo mismo para una fila del historial que sigue viva en segundo plano. Terminada ('done') si se puede:
// solo queda revisarla, y abrirla en otra ventana corta su sesion como abrirla aqui.
export function backgroundMoveBlockedReason(background: BackgroundSession | undefined): string | null {
  if (background === undefined || background.state === 'done') return null;
  return t('history.background.moveBlocked');
}

// Transicion de estado al llegar un evento de una sesion SIN pestaña. Devuelve el estado actual si el
// evento no cambia nada (la inmensa mayoria: deltas de texto, herramientas...), para que quien llama
// pueda no tocar el store.
export function nextBackgroundState(current: BackgroundState, event: MageEvent): BackgroundState {
  if (event.kind === 'permission_request' || event.kind === 'elicitation_request') return 'needs_action';
  // `error` cuenta como fin de turno: el trabajo ya no avanza y lo que queda es mirarlo.
  if (event.kind === 'result' || event.kind === 'error') return 'done';
  // Un permiso cancelado (por timeout del CLI o por el propio agente) deja de exigir accion: si el
  // turno sigue, vuelve a ser trabajo normal.
  if ((event.kind === 'permission_cancelled' || event.kind === 'elicitation_cancelled' || event.kind === 'elicitation_resolved') && current === 'needs_action') return 'working';
  return current;
}

// Etiqueta de la fila del panel de Conversaciones.
export function backgroundLabel(state: BackgroundState): string {
  if (state === 'working') return t('history.background.working');
  return state === 'needs_action' ? t('history.background.needsAction') : t('history.background.done');
}

// Conversaciones que un «Cerrar Mage» cortaria: las pestañas con un turno en marcha (o esperando un
// permiso) y las que siguen vivas en segundo plano sin haber terminado. Lo dice el dialogo de cierre.
export function countWorkingConversations(
  tabStatuses: readonly (ChatStatus | undefined)[],
  background: readonly BackgroundSession[],
): number {
  const busyTabs = tabStatuses.filter(shouldBackgroundOnClose).length;
  return busyTabs + background.filter((session) => session.state !== 'done').length;
}
