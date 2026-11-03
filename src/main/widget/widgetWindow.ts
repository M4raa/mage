import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import { UI_LANGUAGE_CHANGED_CHANNEL, WIDGET_PREFS_CHANNEL, WIDGET_SESSIONS_CHANNEL, WIDGET_SNAPSHOT_CHANNEL } from '@shared/ipc';
import type { ResolvedUiLanguage } from '@shared/i18n/language';
import type { WidgetPrefs, WidgetSessionsPayload, WidgetSnapshot } from '@shared/widget';
import { relocate, resizeAnchored, sameBounds, topRightOf, WIDGET_SCREEN_MARGIN, WIDGET_SIZES } from './widgetPlacement';

// preloadPath: mismo preload que la principal (expone window.mage). rendererBaseUrl: URL de dev de
// electron-vite (undefined en prod -> carga por fichero). backgroundColor: neutro por tema (evita
// flash), resuelto por el caller. onClosed: se llama si la ventana se cierra (sincroniza el setting).
// initiallyExpanded: la última vista que recuerda el widget (compacta o expandida).
export interface WidgetWindowDeps {
  readonly preloadPath: string;
  readonly rendererBaseUrl: string | undefined;
  readonly rendererDir: string;
  readonly resolveBackgroundColor: () => string;
  readonly onClosed: () => void;
  readonly initiallyExpanded: () => boolean;
}

// Gestiona la ventana del WIDGET FLOTANTE (M3, acompañante en F9): un HUD pequeño always-on-top con los
// agentes en curso, el uso y las alertas, en vista compacta o expandida. Disponible también en producción
// (a diferencia de la de debug). Recibe snapshots del renderer principal y las sesiones de main, y contesta
// peticiones A TRAVÉS de main (IPC al coordinador); esta clase solo gestiona la ventana.
export class WidgetWindowController {
  private window: BrowserWindow | null = null;
  private expanded = false;
  // Ultimo snapshot, sesiones y preferencias recibidos: se reproducen en did-finish-load para no mostrar el
  // widget en blanco hasta el siguiente cambio de estado.
  private lastSnapshot: WidgetSnapshot | null = null;
  private lastSessions: WidgetSessionsPayload | null = null;
  private lastPrefs: WidgetPrefs | null = null;

  constructor(private readonly deps: WidgetWindowDeps) {}

  // Abre la ventana (o la enfoca si ya existe). Idempotente.
  open(): void {
    if (this.window !== null && !this.window.isDestroyed()) {
      this.window.showInactive();
      return;
    }
    this.expanded = this.deps.initiallyExpanded();
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
    this.detachDisplayListeners();
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
    return this.liveWindow() !== null;
  }

  // Empuja un snapshot a la ventana (si esta abierta). Guarda el ultimo para el replay al cargar.
  pushSnapshot(snapshot: WidgetSnapshot): void {
    this.lastSnapshot = snapshot;
    this.send(WIDGET_SNAPSHOT_CHANNEL, snapshot);
  }

  // Empuja las sesiones vivas (main -> widget). Guarda las ultimas para el replay al cargar.
  pushSessions(payload: WidgetSessionsPayload): void {
    this.lastSessions = payload;
    this.send(WIDGET_SESSIONS_CHANNEL, payload);
  }

  // Empuja las preferencias del widget. Guarda las ultimas para el replay al cargar.
  pushPrefs(prefs: WidgetPrefs): void {
    this.lastPrefs = prefs;
    this.send(WIDGET_PREFS_CHANNEL, prefs);
  }

  // Cambia entre vista compacta y expandida conservando el borde derecho y el superior.
  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    const window = this.liveWindow();
    if (window === null) return;
    const bounds = window.getBounds();
    const size = WIDGET_SIZES[expanded ? 'expanded' : 'compact'];
    const target = resizeAnchored(bounds, size, screen.getDisplayMatching(bounds).workArea);
    if (!sameBounds(bounds, target)) window.setBounds(target);
  }

  // Muestra el widget SIN robar el foco (nunca abre un widget apagado ni llama a focus()).
  reveal(): void {
    this.liveWindow()?.showInactive();
  }

  // Id del webContents de la ventana (para que el IPC compruebe quien llama); null sin ventana.
  webContentsId(): number | null {
    return this.liveWindow()?.webContents.id ?? null;
  }

  // Avisa del cambio de idioma de la interfaz: el widget no está en `windowManager`, así que no recibe el
  // broadcast general.
  sendUiLanguage(resolved: ResolvedUiLanguage): void {
    this.send(UI_LANGUAGE_CHANGED_CHANNEL, resolved);
  }

  // Cierra y limpia (al salir de la app).
  dispose(): void {
    if (this.window !== null && !this.window.isDestroyed()) {
      this.window.removeAllListeners('closed');
      this.window.destroy();
    }
    this.window = null;
    this.detachDisplayListeners();
  }

  private createWindow(): BrowserWindow {
    const size = WIDGET_SIZES[this.expanded ? 'expanded' : 'compact'];
    const window = new BrowserWindow({
      width: size.width,
      height: size.height,
      title: 'Mage — Widget',
      show: false,
      frame: false, // sin marco: cabecera propia arrastrable (-webkit-app-region)
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true, // no ensucia la barra de tareas / dock
      backgroundColor: this.deps.resolveBackgroundColor(),
      webPreferences: {
        preload: this.deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    // Arriba a la derecha del area de trabajo de la pantalla donde esta el cursor.
    const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    window.setBounds(topRightOf(workArea, size, WIDGET_SCREEN_MARGIN));
    this.attachDisplayListeners();
    window.on('ready-to-show', () => window.showInactive()); // no robar foco a la principal
    window.on('closed', () => {
      this.window = null;
      this.detachDisplayListeners();
      this.deps.onClosed(); // cierre inesperado del SO -> el caller apaga la preferencia
    });
    return window;
  }

  // Ventana viva o null (cerrada o destruida).
  private liveWindow(): BrowserWindow | null {
    return this.window !== null && !this.window.isDestroyed() ? this.window : null;
  }

  private send(channel: string, payload: unknown): void {
    this.liveWindow()?.webContents.send(channel, payload);
  }

  // Al cambiar las pantallas, recoloca el widget si ha quedado fuera o su area ha cambiado (margen de ±2 px).
  private readonly onDisplaysChanged = (): void => {
    const window = this.liveWindow();
    if (window === null) return;
    const bounds = window.getBounds();
    const workAreas = screen.getAllDisplays().map((d) => d.workArea);
    const target = relocate(bounds, workAreas, screen.getPrimaryDisplay().workArea, WIDGET_SCREEN_MARGIN);
    if (!sameBounds(bounds, target)) window.setBounds(target);
  };

  private attachDisplayListeners(): void {
    screen.on('display-metrics-changed', this.onDisplaysChanged);
    screen.on('display-added', this.onDisplaysChanged);
    screen.on('display-removed', this.onDisplaysChanged);
  }

  private detachDisplayListeners(): void {
    screen.removeListener('display-metrics-changed', this.onDisplaysChanged);
    screen.removeListener('display-added', this.onDisplaysChanged);
    screen.removeListener('display-removed', this.onDisplaysChanged);
  }

  // Al terminar de cargar, reproduce lo ultimo conocido (snapshot, sesiones y preferencias; evita widget en blanco).
  private wireSnapshotReplay(window: BrowserWindow): void {
    window.webContents.on('did-finish-load', () => {
      if (window.isDestroyed()) return;
      if (this.lastSnapshot !== null) window.webContents.send(WIDGET_SNAPSHOT_CHANNEL, this.lastSnapshot);
      if (this.lastSessions !== null) window.webContents.send(WIDGET_SESSIONS_CHANNEL, this.lastSessions);
      if (this.lastPrefs !== null) window.webContents.send(WIDGET_PREFS_CHANNEL, this.lastPrefs);
    });
  }

  private loadContent(window: BrowserWindow): void {
    if (this.deps.rendererBaseUrl !== undefined) {
      void window.loadURL(`${this.deps.rendererBaseUrl}/widget.html`);
    } else {
      void window.loadFile(join(this.deps.rendererDir, 'widget.html'));
    }
  }
}
