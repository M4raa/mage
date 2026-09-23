// Politica de auto-update (B2). Modulo PURO: ni electron, ni red, ni timers, ni reloj propio.
// Solo dos decisiones, que son las unicas que tienen ramas dignas de test:
//   1. SI toca comprobar (empaquetado, comprobacion en vuelo, intervalo minimo con reloj inyectado).
//   2. QUE se le dice al usuario / al log para cada evento del autoUpdater.
// La maquina de estados (descarga, reintentos, quitAndInstall) ya la trae electron-updater: aqui no
// se envuelve, solo se traduce.

import type { LogLevel } from '@shared/debug';

// Intervalo minimo entre comprobaciones. La app es residente en el tray (puede estar dias abierta),
// asi que la comprobacion de arranque no basta; pero tampoco hace falta molestar a GitHub mas de
// una vez cada seis horas.
export const MIN_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

// Margen tras el arranque antes de la PRIMERA comprobacion: la red y el disco del arranque son para
// la ventana, no para el updater.
export const FIRST_CHECK_DELAY_MS = 20_000;

// Tope de un mensaje del updater en el log. Medido en la app empaquetada: un 404 de GitHub llega con
// la respuesta HTTP ENTERA pegada al mensaje (~2 KB, cabeceras y Set-Cookie incluidos). Ese volcado
// no aporta nada y mete cookies de sesion en el log, asi que se resume a la primera linea.
const MAX_MESSAGE_CHARS = 200;

// Resume un mensaje del updater: primera linea, recortada. Frontera de entrada (el texto viene de
// electron-updater / de la red), asi que se normaliza aqui y no en cada punto de log.
export function summarizeUpdaterMessage(raw: string): string {
  const firstLine = (raw.split('\n')[0] ?? '').trim();
  if (firstLine.length === 0) return 'error sin mensaje';
  return firstLine.length <= MAX_MESSAGE_CHARS ? firstLine : `${firstLine.slice(0, MAX_MESSAGE_CHARS)}…`;
}

export interface CheckContext {
  readonly isPackaged: boolean; // en dev no existe app-update.yml -> el updater lanza
  readonly checkInFlight: boolean; // ya hay una comprobacion/descarga en curso
  readonly lastCheckAtMs: number | null; // null = nunca se comprobo en esta ejecucion
  readonly nowMs: number; // reloj inyectado
  readonly minIntervalMs?: number;
}

export type CheckDecision =
  | { readonly check: true }
  | { readonly check: false; readonly reason: string };

// Decide si lanzar una comprobacion de actualizaciones. Guard clauses en orden de coste: lo que
// descarta sin mirar el reloj, primero.
export function decideCheck(context: CheckContext): CheckDecision {
  const minIntervalMs = context.minIntervalMs ?? MIN_CHECK_INTERVAL_MS;
  if (!Number.isFinite(context.nowMs)) {
    throw new Error(`Reloj invalido para decidir la comprobacion de update: ${context.nowMs}`);
  }
  if (minIntervalMs < 0) {
    throw new Error(`Intervalo minimo invalido: ${minIntervalMs}`);
  }
  if (!context.isPackaged) {
    return { check: false, reason: 'la app no esta empaquetada (en dev no hay app-update.yml)' };
  }
  if (context.checkInFlight) {
    return { check: false, reason: 'ya hay una comprobacion en vuelo' };
  }
  if (context.lastCheckAtMs === null) return { check: true };
  const elapsedMs = context.nowMs - context.lastCheckAtMs;
  if (elapsedMs < minIntervalMs) {
    return { check: false, reason: `se comprobo hace ${elapsedMs} ms (minimo ${minIntervalMs} ms)` };
  }
  return { check: true };
}

// Eventos del autoUpdater que a Mage le importan, ya normalizados (sin los tipos de electron-updater).
export type UpdateEvent =
  | { readonly kind: 'checking' }
  | { readonly kind: 'available'; readonly version: string }
  | { readonly kind: 'notAvailable'; readonly version: string }
  | { readonly kind: 'downloaded'; readonly version: string }
  | { readonly kind: 'error'; readonly message: string };

// Aviso nativo al usuario (dialog.showMessageBox). `restartIndex` es el boton que reinicia; cualquier
// otra respuesta = "luego". NUNCA se reinicia sin eleccion explicita.
export interface RestartPrompt {
  readonly message: string;
  readonly detail: string;
  readonly buttons: readonly string[];
  readonly restartIndex: number;
  readonly cancelIndex: number;
}

// Lo que provoca cada evento: una entrada de log SIEMPRE (nada en silencio) y, solo cuando la
// actualizacion ya esta en disco, un aviso al usuario.
export interface UpdateNotice {
  readonly level: LogLevel;
  readonly message: string;
  readonly prompt: RestartPrompt | null;
}

export function describeEvent(event: UpdateEvent): UpdateNotice {
  switch (event.kind) {
    case 'checking':
      return { level: 'info', message: 'Comprobando actualizaciones de Mage', prompt: null };
    case 'available':
      return { level: 'info', message: `Actualizacion ${event.version} disponible; descargando en segundo plano`, prompt: null };
    case 'notAvailable':
      return { level: 'info', message: `Mage esta al dia (version ${event.version})`, prompt: null };
    case 'downloaded':
      return {
        level: 'info',
        message: `Actualizacion ${event.version} descargada; esperando al usuario para reiniciar`,
        prompt: buildRestartPrompt(event.version),
      };
    // El fallo del updater es un 'warn', no un 'error': no poder mirar si hay version nueva (sin red,
    // GitHub caido, release sin metadatos) no rompe nada de lo que el usuario esta haciendo. Pero se
    // registra: nunca en silencio.
    case 'error':
      return { level: 'warn', message: `No se pudo actualizar Mage: ${summarizeUpdaterMessage(event.message)}`, prompt: null };
  }
}

function buildRestartPrompt(version: string): RestartPrompt {
  if (version.length === 0) throw new Error('Version vacia en la actualizacion descargada');
  return {
    message: `Mage ${version} esta listo para instalarse`,
    detail: 'La actualizacion se aplica al reiniciar. Puedes seguir trabajando y reiniciar cuando quieras.',
    buttons: ['Reiniciar ahora', 'Mas tarde'],
    restartIndex: 0,
    cancelIndex: 1,
  };
}
