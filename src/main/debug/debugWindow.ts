import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import { DebugChannel } from '@shared/debug';
import type { LogBus } from './logBus';

// Dimensiones de la ventana de debug (sin magic numbers dispersos).
const DEBUG_WINDOW = { width: 900, height: 640 } as const;

// Gestiona la SEGUNDA ventana (solo dev): un visor tipo DevTools del stream del LogBus.
// No roba foco a la principal (showInactive) y se puede reabrir con el mismo gestor.
export class DebugWindowController {
  private window: BrowserWindow | null = null;
  private unsubscribe: (() => void) | null = null;

  // preloadPath: mismo preload que la principal (expone window.mageDebug).
  // rendererBaseUrl: URL de dev de electron-vite (undefined en prod -> carga por fichero).
  constructor(
    private readonly bus: LogBus,
    private readonly preloadPath: string,
    private readonly rendererBaseUrl: string | undefined,
    private readonly rendererDir: string,
  ) {}

  // Abre la ventana (o la enfoca si ya existe). Idempotente.
  open(): void {
    if (this.window !== null && !this.window.isDestroyed()) {
      this.window.show();
      return;
    }
    this.window = this.createWindow();
    this.wireLogStream(this.window);
    this.loadContent(this.window);
  }

  // Cierra y limpia la suscripcion (al salir de la app).
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.window !== null && !this.window.isDestroyed()) this.window.destroy();
    this.window = null;
  }

  private createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      width: DEBUG_WINDOW.width,
      height: DEBUG_WINDOW.height,
      title: 'Mage — Debug',
      show: false,
      backgroundColor: '#0b0b0b',
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    window.on('ready-to-show', () => window.showInactive()); // no robar foco a la principal
    window.on('closed', () => {
      this.unsubscribe?.();
      this.unsubscribe = null;
      this.window = null;
    });
    return window;
  }

  // Al terminar de cargar: reproduce el backlog y luego empuja cada entrada nueva en vivo.
  private wireLogStream(window: BrowserWindow): void {
    window.webContents.on('did-finish-load', () => {
      for (const entry of this.bus.history()) {
        if (!window.isDestroyed()) window.webContents.send(DebugChannel.Log, entry);
      }
    });
    this.unsubscribe = this.bus.subscribe((entry) => {
      if (!window.isDestroyed()) window.webContents.send(DebugChannel.Log, entry);
    });
  }

  private loadContent(window: BrowserWindow): void {
    if (this.rendererBaseUrl !== undefined) {
      void window.loadURL(`${this.rendererBaseUrl}/debug.html`);
    } else {
      void window.loadFile(join(this.rendererDir, 'debug.html'));
    }
  }
}
