// Cableado del auto-update (B2). Aqui vive TODO lo que toca Electron/red/timers; la decision de si
// toca comprobar y el texto de cada aviso estan en updatePolicy.ts (puro y con tests).
//
// A proposito NO hay IPC ni preload ni UI propia: el unico punto de contacto con el usuario es un
// dialog NATIVO cuando la actualizacion ya esta descargada, con dos botones. Un banner en el renderer
// costaria canal IPC + estado + componente para el mismo mensaje de una linea.
//
// El updater NO se instancia si la app no esta empaquetada: en dev no existe app-update.yml y
// electron-updater lanza al primer acceso.
//
// ponytail: sin opt-out del usuario, sin canal beta y sin barra de progreso de la descarga. Techo: el
// que no quiera actualizarse no tiene interruptor (habria que añadir un ajuste a AppSettings y
// pasarlo a startAutoUpdate); para un canal beta basta `autoUpdater.channel`/`allowPrerelease`.

import { app, dialog, type BrowserWindow } from 'electron';
import type { AppUpdater } from 'electron-updater';
import type { LogFn } from '../debug/logBus';
import {
  decideCheck,
  describeEvent,
  FIRST_CHECK_DELAY_MS,
  MIN_CHECK_INTERVAL_MS,
  summarizeUpdaterMessage,
  type RestartPrompt,
  type UpdateEvent,
} from './updatePolicy';

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

// Arranca el auto-update. Idempotente por llamada del arranque: se invoca una vez desde whenReady.
// `getParentWindow` se resuelve en el momento de avisar (la ventana puede haberse cerrado al tray).
export function startAutoUpdate(baseLog: LogFn, getParentWindow: () => BrowserWindow | null): void {
  const log = mirrorToConsole(baseLog);
  const decision = decideCheck({ isPackaged: app.isPackaged, checkInFlight, lastCheckAtMs, nowMs: Date.now() });
  if (!decision.check) {
    log('debug', `Auto-update desactivado: ${decision.reason}`);
    return;
  }
  void wireUpdater(log, getParentWindow);
}

async function wireUpdater(log: LogFn, getParentWindow: () => BrowserWindow | null): Promise<void> {
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

  autoUpdater.on('checking-for-update', () => report(log, { kind: 'checking' }, getParentWindow));
  autoUpdater.on('update-available', (info) => report(log, { kind: 'available', version: info.version }, getParentWindow));
  autoUpdater.on('update-not-available', (info) => {
    checkInFlight = false;
    report(log, { kind: 'notAvailable', version: info.version }, getParentWindow);
  });
  autoUpdater.on('update-downloaded', (event) => {
    checkInFlight = false;
    report(log, { kind: 'downloaded', version: event.version }, getParentWindow);
  });
  autoUpdater.on('error', (error: Error) => {
    checkInFlight = false;
    report(log, { kind: 'error', message: error.message }, getParentWindow);
  });

  // Margen para no competir con el arranque de la ventana; despues, re-comprobacion periodica porque
  // Mage es residente en el tray y puede pasar dias sin reiniciarse. unref: un timer pendiente no
  // debe retrasar la salida del proceso.
  setTimeout(() => void runCheck(log), FIRST_CHECK_DELAY_MS).unref();
  setInterval(() => void runCheck(log), MIN_CHECK_INTERVAL_MS).unref();
}

// El LogBus solo tiene suscriptor en DEV (la ventana de debug), asi que en la app empaquetada —el
// unico sitio donde el updater corre— sus mensajes no se verian en ningun lado, y "nunca en silencio"
// dejaria de ser cierto justo donde importa. Se reflejan tambien en la consola del proceso main,
// visible al arrancar Mage desde una terminal (que es como se diagnostica un update que no llega).
// No sale nada sensible: versiones, URLs de metadatos publicos y mensajes de error de red.
function mirrorToConsole(log: LogFn): LogFn {
  return (level, message, data) => {
    log(level, message, data);
    console.log(`[update:${level}] ${message}`, data ?? '');
  };
}

// Lanza una comprobacion si la politica lo permite. El resultado se observa por los eventos de
// arriba; aqui solo se marca el "en vuelo" y se recoge el rechazo de la promesa (que duplica el
// evento 'error', ya reportado: sin este catch seria un unhandledRejection).
async function runCheck(log: LogFn): Promise<void> {
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

// Traduce un evento del updater a log + (si toca) aviso al usuario.
function report(log: LogFn, event: UpdateEvent, getParentWindow: () => BrowserWindow | null): void {
  const notice = describeEvent(event);
  log(notice.level, notice.message);
  if (notice.prompt === null) return;
  void promptRestart(notice.prompt, getParentWindow()).then((restart) => {
    // El usuario manda: si elige "Mas tarde" no se reinicia nada. La actualizacion queda instalada
    // en el proximo cierre normal de la app (autoInstallOnAppQuit, el default de electron-updater:
    // instala al salir, no relanza por su cuenta).
    if (!restart) {
      log('info', 'El usuario aplazo la actualizacion; se instalara al cerrar Mage');
      return;
    }
    log('info', 'El usuario acepto reiniciar para actualizar');
    // isSilent=false: el instalador NSIS muestra su progreso. isForceRunAfter=true: relanzar Mage.
    void updater().then((u) => u.quitAndInstall(false, true));
  });
}

async function promptRestart(prompt: RestartPrompt, parent: BrowserWindow | null): Promise<boolean> {
  const options = {
    type: 'info' as const,
    message: prompt.message,
    detail: prompt.detail,
    buttons: [...prompt.buttons],
    defaultId: prompt.restartIndex,
    cancelId: prompt.cancelIndex,
  };
  const result =
    parent !== null && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
  return result.response === prompt.restartIndex;
}
