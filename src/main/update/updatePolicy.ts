// Politica de auto-update (B2). Modulo PURO: ni electron, ni red, ni timers, ni reloj propio.
// Tres decisiones, que son las unicas que tienen ramas dignas de test:
//   1. SI toca comprobar (empaquetado, comprobacion en vuelo, intervalo minimo con reloj inyectado).
//   2. QUE se escribe en el log para cada evento del autoUpdater.
//   3. QUE estado ve el usuario (`nextUpdateState`): lo que main difunde a las ventanas.
// La descarga, los reintentos y quitAndInstall ya los trae electron-updater: aqui no se envuelven,
// solo se traducen.

import type { LogLevel } from '@shared/debug';
import { foreignText, localized, renderForLog, type LocalizedText } from '@shared/i18n/localizedText';
import type { UpdateState } from '@shared/update';

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
// electron-updater / de la red), asi que se normaliza aqui y no en cada punto de log. El texto es AJENO; solo
// el de reserva (mensaje vacio) es de Mage.
export function summarizeUpdaterError(raw: string): LocalizedText {
  const firstLine = (raw.split('\n')[0] ?? '').trim();
  if (firstLine.length === 0) return localized('app.update.noMessage');
  return foreignText(firstLine.length <= MAX_MESSAGE_CHARS ? firstLine : `${firstLine.slice(0, MAX_MESSAGE_CHARS)}…`);
}

// Lo mismo para el log (castellano, como siempre).
export function summarizeUpdaterMessage(raw: string): string {
  return renderForLog(summarizeUpdaterError(raw));
}

export interface CheckContext {
  readonly isPackaged: boolean; // en dev no existe app-update.yml -> el updater lanza
  readonly checkInFlight: boolean; // ya hay una comprobacion/descarga en curso
  readonly lastCheckAtMs: number | null; // null = nunca se comprobo en esta ejecucion
  readonly nowMs: number; // reloj inyectado
  readonly minIntervalMs?: number;
  // «Buscar actualizaciones» del usuario (F1.3, #15): ignora el intervalo minimo, nunca la comprobacion en vuelo.
  readonly manual?: boolean;
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
  if (context.lastCheckAtMs === null || context.manual === true) return { check: true };
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
  | { readonly kind: 'downloaded'; readonly version: string; readonly releaseNotes: string | null }
  // `text`: el texto de pantalla cuando es una frase de Mage y no el mensaje del updater (p. ej. «en desarrollo»).
  | { readonly kind: 'error'; readonly message: string; readonly text?: LocalizedText };

// Lo que provoca cada evento en el log: una entrada SIEMPRE (nada en silencio). Lo que ve el usuario
// sale de `nextUpdateState`, no de aqui.
export interface UpdateNotice {
  readonly level: LogLevel;
  readonly message: string;
}

export function describeEvent(event: UpdateEvent): UpdateNotice {
  switch (event.kind) {
    case 'checking':
      return { level: 'info', message: 'Comprobando actualizaciones de Mage' };
    case 'available':
      return { level: 'info', message: `Actualizacion ${event.version} disponible; descargando en segundo plano` };
    case 'notAvailable':
      return { level: 'info', message: `Mage esta al dia (version ${event.version})` };
    case 'downloaded':
      return { level: 'info', message: `Actualizacion ${event.version} descargada; esperando al usuario para reiniciar` };
    // El fallo del updater es un 'warn', no un 'error': no poder mirar si hay version nueva (sin red,
    // GitHub caido, release sin metadatos) no rompe nada de lo que el usuario esta haciendo. Pero se
    // registra: nunca en silencio.
    case 'error':
      return { level: 'warn', message: `No se pudo actualizar Mage: ${summarizeUpdaterMessage(event.message)}` };
  }
}

function requireVersion(version: string, kind: UpdateEvent['kind']): string {
  if (version.length === 0) throw new Error(`Version vacia en el evento de actualizacion ${JSON.stringify(kind)}`);
  return version;
}

// Estado que ve el usuario tras un evento. Una vez `ready`, solo lo cambia OTRA version: las
// comprobaciones periodicas siguientes (cada 6 h) no pueden esconder una actualizacion que ya esta en
// disco y se instalara al salir. Tampoco una comprobacion corta una descarga en curso.
export function nextUpdateState(state: UpdateState, event: UpdateEvent): UpdateState {
  if (state.kind === 'ready' && event.kind !== 'available' && event.kind !== 'downloaded') return state;
  switch (event.kind) {
    case 'checking':
      return state.kind === 'downloading' || state.kind === 'checking' ? state : CHECKING_STATE;
    case 'available': {
      const version = requireVersion(event.version, event.kind);
      if ((state.kind === 'downloading' || state.kind === 'ready') && state.version === version) return state;
      return { kind: 'downloading', version };
    }
    case 'notAvailable':
      return { kind: 'upToDate', version: requireVersion(event.version, event.kind) };
    case 'downloaded':
      return { kind: 'ready', version: requireVersion(event.version, event.kind), releaseNotes: event.releaseNotes };
    case 'error':
      return { kind: 'error', message: event.text ?? summarizeUpdaterError(event.message) };
  }
}

const CHECKING_STATE: UpdateState = { kind: 'checking' };

// `info.releaseNotes` de electron-updater, reducido a lo que el dialogo sabe pintar: Markdown. Llega
// como texto del `latest.yml` (el Markdown del changelog que mete el workflow de release) o, si el
// yml no lo trae, como el HTML del feed de GitHub: ese se descarta a proposito, porque pintar HTML de
// la red en el renderer es abrirle la puerta a lo que traiga. La lista por versiones (`fullChangelog`)
// no se usa en Mage.
export function normalizeReleaseNotes(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (text.length === 0 || text.startsWith('<')) return null;
  return text;
}

// Guarda de `UpdateInstall`: el renderer solo puede pedir instalar lo que ya esta descargado.
export function assertInstallable(state: UpdateState): void {
  if (state.kind !== 'ready') throw new Error(`No hay ninguna actualizacion lista para instalar: ${JSON.stringify(state)}`);
}
