// Cableado del auto-update (B2). Aqui vive TODO lo que toca Electron/red/timers; la decision de si
// toca comprobar, el texto de cada log y el estado que ve el usuario estan en updatePolicy.ts (puro y
// con tests).
//
// Lo que ve el usuario (grupo B de la 0.1.2): main calcula el estado (`nextUpdateState`) y lo DIFUNDE a
// todas las ventanas (indicador de la barra de estado); al quedar lista una version nueva pide el
// dialogo propio a la ventana ENFOCADA, y si no hay ninguna (Mage en el tray o en segundo plano) espera
// a que alguna recupere el foco. Nada se pinta fuera de Mage. `quitAndInstall` sigue aqui, en main.
//
// El updater NO se instancia si la app no esta empaquetada: en dev no existe app-update.yml y
// electron-updater lanza al primer acceso.
//
// ponytail: sin opt-out del usuario, sin canal beta y sin barra de progreso de la descarga. Techo: el
// que no quiera actualizarse no tiene interruptor (habria que añadir un ajuste a AppSettings y
// pasarlo a startAutoUpdate); para un canal beta basta `autoUpdater.channel`/`allowPrerelease`.

import { app } from 'electron';
import type { AppUpdater } from 'electron-updater';
import { IDLE_UPDATE_STATE, type UpdateState } from '@shared/update';
import type { LogFn } from '../debug/logBus';
import {
  assertInstallable,
  decideCheck,
  describeEvent,
  FIRST_CHECK_DELAY_MS,
  MIN_CHECK_INTERVAL_MS,
  nextUpdateState,
  normalizeReleaseNotes,
  summarizeUpdaterMessage,
  type UpdateEvent,
} from './updatePolicy';

// Lo que el updater necesita de las ventanas, inyectado desde index.ts.
export interface UpdateUi {
  // A todas las ventanas: el estado cambio.
  readonly broadcast: (state: UpdateState) => void;
  // A la ventana enfocada: enseña el dialogo de esa version. false = no hay ninguna enfocada.
  readonly promptFocused: (version: string) => boolean;
}

// Estado de la unica instancia del updater del proceso. Module-level a proposito: el `autoUpdater` de
// electron-updater YA es un singleton de modulo, asi que una clase con su estado solo añadiria una
// capa que no puede tener dos instancias.
// ponytail: si la descarga se queda colgada sin emitir ni 'update-downloaded' ni 'error', checkInFlight
// se queda en true y no se vuelve a comprobar hasta reiniciar Mage. Techo aceptado (electron-updater
// emite 'error' en todos los fallos que se han visto); si aparece, poner un plazo maximo al "en vuelo".
// `electron-updater` se carga en DIFERIDO (P13). El import estatico metia el paquete y su cierre
// transitivo (semver, lodash, js-yaml) en el bundle de main: medido reconstruyendo sin el, 945 kB
// -> 373 kB, o sea el 60 % del bundle. Y se parseaba SIEMPRE, incluso en dev, donde `decideCheck`
// sale por `!app.isPackaged` sin usarlo para nada, y en produccion, donde la primera comprobacion no
// ocurre hasta 20 s despues de arrancar. Se resuelve una sola vez, detras de la guarda de politica.
let updaterPromise: Promise<AppUpdater> | null = null;

function updater(): Promise<AppUpdater> {
  updaterPromise ??= import('electron-updater').then((mod) => mod.autoUpdater);
  return updaterPromise;
}

let checkInFlight = false;
let lastCheckAtMs: number | null = null;
let updateState: UpdateState = IDLE_UPDATE_STATE;
// Version lista cuyo dialogo aun no ha visto ninguna ventana (se pide una sola vez por version).
let pendingPromptVersion: string | null = null;
let ui: UpdateUi | null = null;
let log: LogFn = () => undefined;

// Arranca el auto-update. Idempotente por llamada del arranque: se invoca una vez desde whenReady.
export function startAutoUpdate(baseLog: LogFn, updateUi: UpdateUi): void {
  log = mirrorToConsole(baseLog);
  ui = updateUi;
  const decision = decideCheck({ isPackaged: app.isPackaged, checkInFlight, lastCheckAtMs, nowMs: Date.now() });
  if (!decision.check) {
    log('debug', `Auto-update desactivado: ${decision.reason}`);
    return;
  }
  void wireUpdater();
}

// Para una ventana que carga tarde (o se recarga): el estado de ahora.
export function getUpdateState(): UpdateState {
  return updateState;
}

// Una ventana recupero el foco: si hay un dialogo pendiente, es su momento.
export function flushPendingUpdatePrompt(): void {
  if (pendingPromptVersion === null || ui === null) return;
  if (ui.promptFocused(pendingPromptVersion)) pendingPromptVersion = null;
}

// «Reiniciar ahora» del dialogo o del indicador. Solo con una actualizacion descargada: lo demas lanza
// con el estado recibido. isSilent=false: el instalador NSIS muestra su progreso. isForceRunAfter=true:
// relanzar Mage. `quitAndInstall` pasa por `before-quit`, asi que el cierre ya no pregunta.
export function installUpdate(): void {
  assertInstallable(updateState);
  log('info', 'El usuario acepto reiniciar para actualizar');
  void updater().then((u) => u.quitAndInstall(false, true));
}

async function wireUpdater(): Promise<void> {
  const autoUpdater = await updater();

  // Los logs internos de electron-updater bajan a 'debug' (son detalle de protocolo: URLs de
  // metadatos, progreso de descarga) pero no se tiran a la basura: si un update no llega, es lo unico
  // que lo explica. Todos pasan por summarizeUpdaterMessage porque los de error traen pegada la
  // respuesta HTTP completa, cabeceras y Set-Cookie incluidos (medido contra GitHub).
  autoUpdater.logger = {
    debug: (message: string) => log('debug', `[updater] ${summarizeUpdaterMessage(message)}`),
    info: (message: string) => log('debug', `[updater] ${summarizeUpdaterMessage(message)}`),
    warn: (message: string) => log('warn', `[updater] ${summarizeUpdaterMessage(message)}`),
    error: (message: string) => log('warn', `[updater] ${summarizeUpdaterMessage(message)}`),
  };

  autoUpdater.on('checking-for-update', () => report({ kind: 'checking' }));
  autoUpdater.on('update-available', (info) => report({ kind: 'available', version: info.version }));
  autoUpdater.on('update-not-available', (info) => {
    checkInFlight = false;
    report({ kind: 'notAvailable', version: info.version });
  });
  autoUpdater.on('update-downloaded', (event) => {
    checkInFlight = false;
    report({ kind: 'downloaded', version: event.version, releaseNotes: normalizeReleaseNotes(event.releaseNotes) });
  });
  autoUpdater.on('error', (error: Error) => {
    checkInFlight = false;
    report({ kind: 'error', message: error.message });
  });

  // Margen para no competir con el arranque de la ventana; despues, re-comprobacion periodica porque
  // Mage es residente en el tray y puede pasar dias sin reiniciarse. unref: un timer pendiente no
  // debe retrasar la salida del proceso.
  setTimeout(() => void runCheck(), FIRST_CHECK_DELAY_MS).unref();
  setInterval(() => void runCheck(), MIN_CHECK_INTERVAL_MS).unref();
}

// El LogBus solo tiene suscriptor en DEV (la ventana de debug), asi que en la app empaquetada —el
// unico sitio donde el updater corre— sus mensajes no se verian en ningun lado, y "nunca en silencio"
// dejaria de ser cierto justo donde importa. Se reflejan tambien en la consola del proceso main,
// visible al arrancar Mage desde una terminal (que es como se diagnostica un update que no llega).
// No sale nada sensible: versiones, URLs de metadatos publicos y mensajes de error de red.
function mirrorToConsole(baseLog: LogFn): LogFn {
  return (level, message, data) => {
    baseLog(level, message, data);
    console.log(`[update:${level}] ${message}`, data ?? '');
  };
}

// Lanza una comprobacion si la politica lo permite. El resultado se observa por los eventos de
// arriba; aqui solo se marca el "en vuelo" y se recoge el rechazo de la promesa (que duplica el
// evento 'error', ya reportado: sin este catch seria un unhandledRejection).
async function runCheck(): Promise<void> {
  const decision = decideCheck({ isPackaged: app.isPackaged, checkInFlight, lastCheckAtMs, nowMs: Date.now() });
  if (!decision.check) {
    log('debug', `Comprobacion de update omitida: ${decision.reason}`);
    return;
  }
  checkInFlight = true;
  lastCheckAtMs = Date.now();
  (await updater()).checkForUpdates().catch((err: unknown) => {
    checkInFlight = false;
    log('debug', 'La comprobacion de update termino en error (reportado por el evento "error")', {
      error: summarizeUpdaterMessage(err instanceof Error ? err.message : String(err)),
    });
  });
}

// Traduce un evento del updater a log + estado; si el estado cambia, lo difunde, y si acaba de quedar
// lista una version nueva, pide su dialogo.
function report(event: UpdateEvent): void {
  const notice = describeEvent(event);
  log(notice.level, notice.message);
  // Un evento ilegible (version vacia) no puede tumbar main desde dentro de un listener del updater:
  // se registra y el estado se queda como estaba.
  try {
    applyEvent(event);
  } catch (err) {
    log('warn', `Evento de actualizacion ignorado: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function applyEvent(event: UpdateEvent): void {
  const previous = updateState;
  updateState = nextUpdateState(previous, event);
  if (updateState === previous) return;
  ui?.broadcast(updateState);
  if (updateState.kind !== 'ready') return;
  if (previous.kind === 'ready' && previous.version === updateState.version) return;
  pendingPromptVersion = updateState.version;
  flushPendingUpdatePrompt();
}
