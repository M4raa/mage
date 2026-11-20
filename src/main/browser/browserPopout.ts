// Ventana propia del navegador de Mage: sacar la MISMA vista (misma página e historial, sin recargar) a una ventana de
// Mage dedicada y traerla de vuelta. Dónde está la vista lo decide `ViewPlacement`; aquí solo se abre, se cierra y se
// avisa del cambio. Sin Electron: la ventana entra por interfaz.
import { BrowserControlError, type BrowserHandle, type BrowserRegistry } from './browserRegistry';
import type { PlacementHandle, PlacementWindow, ViewPlacement } from './viewPlacement';

export interface PopoutWindow extends PlacementWindow {
  on(event: 'close', listener: () => void): unknown;
  on(event: 'closed', listener: () => void): unknown;
  close(): void;
  focus(): void;
}

export interface BrowserPopoutsDeps {
  readonly registry: Pick<BrowserRegistry, 'get' | 'notifyChange'>;
  readonly placement: ViewPlacement<PopoutWindow>;
  // La ventana nueva, ya cargando el renderer en su modo «solo navegador» de esa sesión.
  readonly createWindow: (sessionId: string, title: string) => PopoutWindow;
}

export class BrowserPopouts {
  constructor(private readonly deps: BrowserPopoutsDeps) {}

  // Una ventana por navegador: si ya está fuera, se trae al frente la que hay.
  popOut(sessionId: string, title: string): void {
    const handle = this.requireHandle(sessionId);
    const current = this.deps.placement.detachedWindowOf(handle);
    if (current !== null) {
      current.focus();
      return;
    }
    const window = this.deps.createWindow(sessionId, title);
    this.deps.placement.detach(handle, window);
    const bringBack = (): void => this.bringBack(handle, window);
    // `close` llega antes de destruirse la ventana: la vista sale entera. `closed`, por si alguien la destruye sin
    // `close` (`destroy()`); cerrarla tampoco destruye la vista (medido), así que también se rescata ahí.
    window.on('close', bringBack);
    window.on('closed', bringBack);
    this.deps.registry.notifyChange();
  }

  // «Traer aquí»: la vista vuelve a Mage y la ventana se cierra.
  popIn(sessionId: string): void {
    const handle = this.requireHandle(sessionId);
    const window = this.deps.placement.detachedWindowOf(handle);
    if (window === null) return;
    this.bringBack(handle, window);
    if (!window.isDestroyed()) window.close();
  }

  // El navegador se cierra (✕ o su sesión): su ventana propia se va con él.
  forget(handle: PlacementHandle): void {
    const window = this.deps.placement.detachedWindowOf(handle);
    this.deps.placement.forget(handle);
    if (window !== null && !window.isDestroyed()) window.close();
  }

  private bringBack(handle: PlacementHandle, window: PopoutWindow): void {
    if (this.deps.placement.detachedWindowOf(handle) !== window) return;
    this.deps.placement.reattach(handle);
    this.deps.registry.notifyChange();
  }

  private requireHandle(sessionId: string): BrowserHandle {
    const handle = this.deps.registry.get(sessionId);
    if (handle === null) throw new BrowserControlError('browser_not_open', `No hay navegador abierto en la sesión ${sessionId}`);
    return handle;
  }
}
