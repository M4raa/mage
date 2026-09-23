import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { WIDGET_SNAPSHOT_CHANNEL } from '@shared/ipc';
import type { WidgetSnapshot } from '@shared/widget';

// Dimensiones y colocacion del widget flotante (sin magic numbers dispersos). El margen lo separa del
// borde de la pantalla al colocarlo arriba a la derecha.
const WIDGET_WINDOW = { width: 300, height: 440, screenMargin: 24 } as const;

// Gestiona la ventana del WIDGET FLOTANTE (M3): un HUD pequeno always-on-top con los agentes en
// curso, el uso y las alertas. Disponible tambien en produccion (a diferencia de la de debug).
// Es de SOLO LECTURA: recibe snapshots del renderer principal (via main) y los pinta; el unico
// camino de vuelta es "activar pestana" (lo maneja main, no esta clase).
export class WidgetWindowController {
  private window: BrowserWindow | null = null;
  // Ultimo snapshot recibido: se reproduce en did-finish-load para no mostrar el widget en blanco
  // hasta el siguiente cambio de estado.
  private lastSnapshot: WidgetSnapshot | null = null;

  // preloadPath: mismo preload que la principal (expone window.mage). rendererBaseUrl: URL de dev de
  // electron-vite (undefined en prod -> carga por fichero). backgroundColor: neutro por tema (evita
  // flash), resuelto por el caller. onClosed: se llama si la ventana se cierra (sincroniza el setting).
  constructor(
    private readonly preloadPath: string,
    private readonly rendererBaseUrl: string | undefined,
    private readonly rendererDir: string,
    private readonly resolveBackgroundColor: () => string,
    private readonly onClosed: () => void,
  ) {}

  // Abre la ventana (o la enfoca si ya existe). Idempotente.
  open(): void {
    if (this.window !== null && !this.window.isDestroyed()) {
      this.window.showInactive();
      return;
    }
    this.window = this.createWindow();
    this.wireSnapshotReplay(this.window);
    this.loadContent(this.window);
  }

  // Cierra la ventana (accion del usuario: toggle/checkbox). No llama a onClosed (evitar bucle).
  close(): void {
    if (this.window === null || this.window.isDestroyed()) return;
    const window = this.window;
    this.window = null; // limpiar antes de destroy para que el handler 'closed' no dispare onClosed
    window.removeAllListeners('closed');
    window.destroy();
  }

  // Alterna la ventana. Devuelve el nuevo estado (true = abierta) para sincronizar la preferencia.
  toggle(): boolean {
    if (this.isOpen()) {
      this.close();
      return false;
    }
    this.open();
    return true;
  }

  isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  // Empuja un snapshot a la ventana (si esta abierta). Guarda el ultimo para el replay al cargar.
  pushSnapshot(snapshot: WidgetSnapshot): void {
    this.lastSnapshot = snapshot;
    if (this.window !== null && !this.window.isDestroyed()) {
      this.window.webContents.send(WIDGET_SNAPSHOT_CHANNEL, snapshot);
    }
  }

  // Cierra y limpia (al salir de la app).
  dispose(): void {
    if (this.window !== null && !this.window.isDestroyed()) {
      this.window.removeAllListeners('closed');
      this.window.destroy();
    }
    this.window = null;
  }

  private createWindow(): BrowserWindow {
    const window = new BrowserWindow({
      width: WIDGET_WINDOW.width,
      height: WIDGET_WINDOW.height,
      title: 'Mage — Widget',
      show: false,
      frame: false, // sin marco: cabecera propia arrastrable (-webkit-app-region)
      resizable: true,
      alwaysOnTop: true,
      skipTaskbar: true, // no ensucia la barra de tareas / dock
      backgroundColor: this.resolveBackgroundColor(),
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    this.positionTopRight(window);
    window.on('ready-to-show', () => window.showInactive()); // no robar foco a la principal
    window.on('closed', () => {
      this.window = null;
      this.onClosed(); // cierre inesperado del SO -> el caller apaga la preferencia
    });
    return window;
  }

  // Coloca el widget arriba a la derecha del area de trabajo de la pantalla donde esta el cursor.
  private positionTopRight(window: BrowserWindow): void {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width } = display.workArea;
    window.setPosition(
      x + width - WIDGET_WINDOW.width - WIDGET_WINDOW.screenMargin,
      y + WIDGET_WINDOW.screenMargin,
    );
  }

  // Al terminar de cargar, reproduce el ultimo snapshot conocido (evita widget en blanco).
  private wireSnapshotReplay(window: BrowserWindow): void {
    window.webContents.on('did-finish-load', () => {
      if (this.lastSnapshot !== null && !window.isDestroyed()) {
        window.webContents.send(WIDGET_SNAPSHOT_CHANNEL, this.lastSnapshot);
      }
    });
  }

  private loadContent(window: BrowserWindow): void {
    if (this.rendererBaseUrl !== undefined) {
      void window.loadURL(`${this.rendererBaseUrl}/widget.html`);
    } else {
      void window.loadFile(join(this.rendererDir, 'widget.html'));
    }
  }
}
