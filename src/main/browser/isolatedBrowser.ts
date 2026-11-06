import type { Session, WebContents, WebContentsView } from 'electron';
import type { RawCapture } from './annotatedCapture';
import { hardenContents, hardenSession } from './browserHardening';
import { deriveDeviceScale } from './deviceScale';
import { buildDomReadScript } from './domReadScript';
import { parseDomSnapshot, resolveReadDomOptions, type ReadDomOptions } from './domSnapshot';
import { ElementRegistry, type DomElement } from './elementRegistry';
import { partitionNameFor } from './isolationConfig';
import { normalizeNavigationUrl } from './navigationPolicy';

export interface BrowserDeps {
  createSession(partition: string): Session;
  createView(session: Session): WebContentsView;
  now(): Date;
}

export interface BrowserScreenshot {
  mime: 'image/png';
  base64: string;
  widthPx: number;
  heightPx: number;
  widthDip: number;
  heightDip: number;
  deviceScale: number;
  url: string;
  capturedAt: string;
}

export type ClickTarget = { elementId: number } | { x: number; y: number };

export interface TypeRequest {
  elementId: number;
  text: string;
}

export interface BrowserPageState {
  readonly url: string;
  readonly title: string;
  readonly canGoBack: boolean;
  readonly loading: boolean;
}

// La de la medición I1.
const CDP_PROTOCOL_VERSION = '1.3';

// Un screencast mínimo mantiene pintando la vista con Mage minimizado o tapado (medido, Z): sin ack ni espera.
const KEEP_PAINTING_SCREENCAST = { format: 'jpeg', quality: 1, maxWidth: 64, maxHeight: 64 } as const;

// Eventos del webContents tras los que cambia el estado que enseña la barra del panel.
const STATE_EVENTS = ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading'];

/**
 * Núcleo de F11b.1, sin consumidores todavía: F11b.2 (herramientas MCP `mage_browser_*`) y F11b.3 (interfaz)
 * lo conectarán. Colocar `view` en una ventana es cosa del consumidor.
 */
export class IsolatedBrowser {
  readonly view: WebContentsView;
  private readonly session: Session;
  private readonly elements = new ElementRegistry();
  private readonly stateListeners = new Set<() => void>();
  private closed = false;

  constructor(
    instanceId: string,
    private readonly deps: BrowserDeps,
  ) {
    const partition = partitionNameFor(instanceId);
    this.session = deps.createSession(partition);
    if (this.session.isPersistent()) {
      throw new Error(`La partición del navegador es persistente y debe ser en memoria: ${partition}`);
    }
    hardenSession(this.session);
    this.view = deps.createView(this.session);
    hardenContents(this.view.webContents);
    for (const event of STATE_EVENTS) {
      this.view.webContents.on(event as 'did-navigate', () => this.notifyStateChange());
    }
  }

  private notifyStateChange(): void {
    for (const listener of this.stateListeners) listener();
  }

  private get contents(): WebContents {
    return this.view.webContents;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('El navegador aislado ya está cerrado');
  }

  async navigate(url: string): Promise<string> {
    this.assertOpen();
    const target = normalizeNavigationUrl(url);
    this.elements.clear();
    try {
      await this.contents.loadURL(target);
    } catch (error) {
      throw new Error(`No se pudo cargar ${target}: ${error instanceof Error ? error.message : String(error)}`, {
        cause: error,
      });
    }
    return this.contents.getURL();
  }

  /** Captura cruda (imagen de Electron + tamaño en DIP), sin reducir ni anotar: `composeCapture` lo hace. */
  async captureRaw(): Promise<RawCapture> {
    this.assertOpen();
    // D-S3: también con la vista oculta; sin medir, cp/S-01.
    const image = await this.contents.capturePage(undefined, { stayHidden: true });
    if (image.isEmpty()) {
      throw new Error(`La captura salió vacía (${this.contents.getURL()}): ¿la vista está colocada en una ventana?`);
    }
    const { width: widthDip, height: heightDip } = this.view.getBounds();
    return { image, widthDip, heightDip, url: this.contents.getURL(), capturedAt: this.deps.now().toISOString() };
  }

  async screenshot(): Promise<BrowserScreenshot> {
    const { image, widthDip, heightDip, url, capturedAt } = await this.captureRaw();
    const { width: widthPx, height: heightPx } = image.getSize();
    return {
      mime: 'image/png',
      base64: image.toPNG().toString('base64'),
      widthPx,
      heightPx,
      widthDip,
      heightDip,
      deviceScale: deriveDeviceScale(widthPx, widthDip),
      url,
      capturedAt,
    };
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Falso si se cerró o si Electron destruyó el `webContents` por fuera (p. ej. al cerrarse su ventana). */
  get isUsable(): boolean {
    return !this.closed && !this.contents.isDestroyed();
  }

  /** D-S2: Detener suelta el CDP; el siguiente comando del agente lo vuelve a adjuntar si el control lo permite. */
  releaseControl(): void {
    if (this.closed) return;
    if (this.contents.debugger.isAttached()) this.contents.debugger.detach();
  }

  reload(): void {
    this.assertOpen();
    this.elements.clear();
    this.contents.reload();
  }

  state(): BrowserPageState {
    this.assertOpen();
    return {
      url: this.contents.getURL(),
      title: this.contents.getTitle(),
      canGoBack: this.contents.navigationHistory.canGoBack(),
      loading: this.contents.isLoading(),
    };
  }

  /** Avisa de cualquier cambio de URL, título o carga; devuelve la función que quita el oyente. */
  onStateChange(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  setBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this.assertOpen();
    this.view.setBounds(bounds);
  }

  setVisible(visible: boolean): void {
    this.assertOpen();
    this.view.setVisible(visible);
  }

  async readDom(options: ReadDomOptions = {}): Promise<DomElement[]> {
    this.assertOpen();
    const resolved = resolveReadDomOptions(options);
    const raw: unknown = await this.contents.executeJavaScript(buildDomReadScript(resolved));
    return this.elements.replace(parseDomSnapshot(raw, resolved.maxNodes));
  }

  async click(target: ClickTarget): Promise<void> {
    this.assertOpen();
    const { x, y } = this.pointFor(target);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await this.sendCdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
    }
  }

  async type(request: TypeRequest): Promise<void> {
    this.assertOpen();
    if (request.text.length === 0) {
      throw new Error(`Texto vacío para escribir en el elemento ${request.elementId}`);
    }
    await this.click({ elementId: request.elementId });
    await this.sendCdp('Input.insertText', { text: request.text });
  }

  back(): boolean {
    this.assertOpen();
    const history = this.contents.navigationHistory;
    if (!history.canGoBack()) return false;
    this.elements.clear();
    history.goBack();
    return true;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.elements.clear();
    this.stateListeners.clear();
    if (!this.contents.isDestroyed()) {
      if (this.contents.debugger.isAttached()) this.contents.debugger.detach();
      this.contents.close();
    }
    // Electron 44 no tiene API para destruir una Session: se vacía la partición y su nombre, único por
    // instancia, nunca se reutiliza.
    await this.session.clearData();
  }

  private pointFor(target: ClickTarget): { x: number; y: number } {
    if ('elementId' in target) {
      const [x, y, width, height] = this.elements.resolve(target.elementId).rectDip;
      return { x: x + width / 2, y: y + height / 2 };
    }
    if (!Number.isFinite(target.x) || !Number.isFinite(target.y) || target.x < 0 || target.y < 0) {
      throw new Error(`Coordenadas no válidas para el clic: (${target.x}, ${target.y})`);
    }
    return { x: target.x, y: target.y };
  }

  private async sendCdp(method: string, params: Record<string, unknown>): Promise<unknown> {
    // El CDP lo usa SOLO main; ni la página ni el renderer lo ven.
    const debuggerApi = this.contents.debugger;
    if (!debuggerApi.isAttached()) {
      debuggerApi.attach(CDP_PROTOCOL_VERSION);
      await debuggerApi.sendCommand('Page.startScreencast', KEEP_PAINTING_SCREENCAST);
    }
    return debuggerApi.sendCommand(method, params);
  }
}
