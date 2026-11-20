// Dónde vive la WebContentsView de cada navegador (D-S3): en la ventana cuyo panel la enseña, en el hueco del panel;
// aparcada en una ventana propia si no se ve. Sin Electron: la ventana entra por interfaz.
import type { BrowserBounds } from '@shared/browser';
import type { BrowserHandle } from './browserRegistry';

export interface PlacementWindow {
  readonly contentView: { addChildView(view: BrowserHandle['view']): void; removeChildView(view: BrowserHandle['view']): void };
  isDestroyed(): boolean;
  once(event: 'closed', listener: () => void): void;
}

export type PlacementHandle = Pick<BrowserHandle, 'view' | 'setBounds' | 'setVisible'>;

// Tamaño de una vista que el agente abre sin panel: aparcada, pero con el de una ventana normal para que la página maquete.
export const HIDDEN_DEFAULT_BOUNDS: BrowserBounds = { x: 0, y: 0, width: 1280, height: 800 };

// Ventana de aparcamiento de las vistas sin panel (Z01): una sola, perezosa; si alguien la destruye, la siguiente llamada crea otra.
export function createParkingHost(createWindow: () => PlacementWindow): () => PlacementWindow {
  let current: PlacementWindow | null = null;
  return () => {
    if (current === null || current.isDestroyed()) current = createWindow();
    return current;
  };
}

// `hosts` es el ÚNICO sitio que dice dónde está la vista (panel, aparcamiento o ventana propia). `detached` no la
// coloca: solo dice qué ventana propia tiene derecho a hacerlo mientras el navegador está fuera.
export class ViewPlacement<D extends PlacementWindow = PlacementWindow> {
  private readonly hosts = new Map<PlacementHandle, PlacementWindow>();
  private readonly detached = new Map<PlacementHandle, D>();
  // Ventanas propias que ya devolvieron su vista: un hueco tardío de una que se está cerrando no se la vuelve a llevar.
  private readonly retired = new WeakSet<PlacementWindow>();

  constructor(private readonly parking: () => PlacementWindow) {}

  show(handle: PlacementHandle, window: PlacementWindow, bounds: BrowserBounds): void {
    if (!this.accepts(handle, window)) return;
    const previous = this.hosts.get(handle);
    if (previous !== window) {
      if (previous !== undefined && !previous.isDestroyed()) previous.contentView.removeChildView(handle.view);
      this.attach(handle, window);
    }
    handle.setBounds(bounds);
    handle.setVisible(true);
  }

  // Solo la ventana que la aloja la suelta: el hueco que se va de un panel no se lleva la vista de otra ventana.
  hide(handle: PlacementHandle, window: PlacementWindow): void {
    if (this.hosts.get(handle) !== window) return;
    this.park(handle);
  }

  // La vista pasa a ser de su ventana propia: llega a ella con el primer hueco que esa ventana informe (`show`), y hasta
  // entonces sigue donde estaba. Una ventana por navegador.
  detach(handle: PlacementHandle, window: D): void {
    if (this.detached.has(handle)) throw new Error('El navegador ya tiene una ventana propia');
    this.detached.set(handle, window);
  }

  // Vuelve del todo a Mage: aparcada (viva y pintando) hasta que un panel la pida. false si no estaba fuera.
  reattach(handle: PlacementHandle): boolean {
    const window = this.detached.get(handle);
    if (window === undefined) return false;
    this.detached.delete(handle);
    this.retired.add(window);
    const host = this.hosts.get(handle);
    if (host === undefined || host === window) this.park(handle);
    return true;
  }

  detachedWindowOf(handle: PlacementHandle): D | null {
    return this.detached.get(handle) ?? null;
  }

  ensureHosted(handle: PlacementHandle): void {
    if (this.hosts.has(handle)) return;
    this.park(handle);
  }

  forget(handle: PlacementHandle): void {
    this.detached.delete(handle);
    const host = this.hosts.get(handle);
    if (host === undefined) return;
    if (!host.isDestroyed()) host.contentView.removeChildView(handle.view);
    this.hosts.delete(handle);
  }

  // Fuera, solo su ventana propia la coloca (los paneles no la mueven); una ventana propia retirada, nunca.
  private accepts(handle: PlacementHandle, window: PlacementWindow): boolean {
    if (this.retired.has(window)) return false;
    const own = this.detached.get(handle);
    return own === undefined || own === window;
  }

  // Nunca `setVisible(false)`: una vista oculta no pinta, y sin pintar no hay clic, escritura ni captura (medido, Z).
  private park(handle: PlacementHandle): void {
    const parking = this.parking();
    const previous = this.hosts.get(handle);
    if (previous !== parking) {
      if (previous !== undefined && !previous.isDestroyed()) previous.contentView.removeChildView(handle.view);
      this.attach(handle, parking);
    }
    handle.setBounds(HIDDEN_DEFAULT_BOUNDS);
    handle.setVisible(true);
  }

  private attach(handle: PlacementHandle, window: PlacementWindow): void {
    window.contentView.addChildView(handle.view);
    this.hosts.set(handle, window);
    // Si la ventana se cierra, la vista queda sin anfitriona (su webContents sigue vivo: medido con Electron 44.4.5 en
    // Windows) y el siguiente `show` la coloca. Se olvida solo si sigue siendo su anfitriona.
    window.once('closed', () => {
      if (this.hosts.get(handle) === window) this.hosts.delete(handle);
    });
  }
}
