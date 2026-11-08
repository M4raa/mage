// El único fichero del módulo que carga Electron; no tiene test unitario (lo cubre el spike).
import { BaseWindow, nativeImage, screen, session, WebContentsView } from 'electron';
import type { ImageDeps } from './annotatedCapture';
import { ISOLATED_WEB_PREFERENCES } from './isolationConfig';
import type { BrowserDeps } from './isolatedBrowser';
import { HIDDEN_DEFAULT_BOUNDS, type PlacementWindow } from './viewPlacement';

export const electronBrowserDeps: BrowserDeps = {
  createSession: (partition) => session.fromPartition(partition),
  createView: (browserSession) =>
    new WebContentsView({ webPreferences: { ...ISOLATED_WEB_PREFERENCES, session: browserSession } }),
  now: () => new Date(),
};

export const electronImageDeps: ImageDeps = {
  fromBitmap: (data, size) => nativeImage.createFromBitmap(data, size),
};

// Ventana de aparcamiento (Z01, medido en Windows con Electron 44.4.5): EN pantalla para que Chromium pinte la vista,
// invisible (opacidad 0), sin ratón, sin barra de tareas, no enfocable y mostrada sin activar. En Linux `setOpacity`
// no hace nada, así que va fuera de pantalla (SIN MEDIR: se mide en el punto de control).
const PARKING_SIZE = { width: HIDDEN_DEFAULT_BOUNDS.width, height: HIDDEN_DEFAULT_BOUNDS.height };
const LINUX_OFFSCREEN = -32000;
export function createParkingWindow(): PlacementWindow {
  const { x, y } = screen.getPrimaryDisplay().workArea;
  const offscreen = process.platform === 'linux';
  const window = new BaseWindow({
    show: false, frame: false, skipTaskbar: true, focusable: false,
    x: offscreen ? LINUX_OFFSCREEN : x, y: offscreen ? LINUX_OFFSCREEN : y, ...PARKING_SIZE,
  });
  window.setOpacity(0);
  window.setIgnoreMouseEvents(true);
  window.showInactive();
  return window;
}
