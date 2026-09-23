import type { MageEvent } from '@shared/events';
import type { ChatStatus } from './types';

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
  readonly sessionId: string;
  readonly title: string; // el de la pestaña al cerrarla (la fila del historial puede tardar en refrescarse)
  readonly accountId: string;
  readonly state: BackgroundState;
  readonly sinceMs: number; // cuando se mando a segundo plano; base del TTL
}

// Se mata la sesion huerfana a la semana de mandarla a segundo plano (decision del usuario): si nadie
// ha vuelto en ese plazo, el proceso del CLI ya no le sirve a nadie. Cabe en un setTimeout (el tope de
// los temporizadores del navegador son ~24,8 dias).
export const BACKGROUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Solo se manda a segundo plano lo que TIENE trabajo vivo. Una conversacion parada se cierra como
// siempre (su proceso se para): dejarla viva seria pagar un CLI por cada pestaña que se cierra.
export function shouldBackgroundOnClose(status: ChatStatus | undefined): boolean {
  return status === 'streaming' || status === 'needs_permission';
}

// Transicion de estado al llegar un evento de una sesion SIN pestaña. Devuelve el estado actual si el
// evento no cambia nada (la inmensa mayoria: deltas de texto, herramientas...), para que quien llama
// pueda no tocar el store.
export function nextBackgroundState(current: BackgroundState, event: MageEvent): BackgroundState {
  if (event.kind === 'permission_request') return 'needs_action';
  // `error` cuenta como fin de turno: el trabajo ya no avanza y lo que queda es mirarlo.
  if (event.kind === 'result' || event.kind === 'error') return 'done';
  // Un permiso cancelado (por timeout del CLI o por el propio agente) deja de exigir accion: si el
  // turno sigue, vuelve a ser trabajo normal.
  if (event.kind === 'permission_cancelled' && current === 'needs_action') return 'working';
  return current;
}

// Etiqueta de la fila del panel de Conversaciones.
export function backgroundLabel(state: BackgroundState): string {
  if (state === 'working') return 'en segundo plano';
  return state === 'needs_action' ? 'pendiente de acción' : 'pendiente de revisión';
}
