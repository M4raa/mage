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

export class ViewPlacement {
  private readonly hosts = new Map<PlacementHandle, PlacementWindow>();

  constructor(private readonly parking: () => PlacementWindow) {}

  show(handle: PlacementHandle, window: PlacementWindow, bounds: BrowserBounds): void {
    const previous = this.hosts.get(handle);
    if (previous !== window) {
      if (previous !== undefined && !previous.isDestroyed()) previous.contentView.removeChildView(handle.view);
      this.attach(handle, window);
    }
    handle.setBounds(bounds);
    handle.setVisible(true);
  }

  hide(handle: PlacementHandle): void {
    if (!this.hosts.has(handle)) return;
    this.park(handle);
  }

  ensureHosted(handle: PlacementHandle): void {
    if (this.hosts.has(handle)) return;
    this.park(handle);
  }

  forget(handle: PlacementHandle): void {
    const host = this.hosts.get(handle);
    if (host === undefined) return;
    if (!host.isDestroyed()) host.contentView.removeChildView(handle.view);
    this.hosts.delete(handle);
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
    // Si la ventana se cierra, la vista se va con ella: se olvida solo si sigue siendo su anfitriona.
    window.once('closed', () => {
      if (this.hosts.get(handle) === window) this.hosts.delete(handle);
    });
  }
}
