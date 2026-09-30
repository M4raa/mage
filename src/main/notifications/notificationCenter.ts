import type { NotificationTarget, NotifyParams } from '@shared/ipc';

// Notificaciones del SO con clic (P-028 40). Sin Electron dentro: las dependencias entran por el
// constructor para poder probarlo con un `Notification` falso.
//
// Dos cosas que hacian que el clic no llegara nunca:
//   1. La `Notification` se creaba y se soltaba: sin referencia viva, el recolector se la lleva y su
//      evento `click` no se emite. Aqui se guarda hasta `click` o `close`.
//   2. Solo se miraba el foco de la ventana PRINCIPAL. Ahora el de la ventana que la pidio.

export interface ShownNotification {
  on(event: 'click' | 'close', listener: () => void): void;
  show(): void;
}

export interface NotificationCenterDeps {
  readonly isSupported: () => boolean;
  readonly create: (options: { readonly title: string; readonly body: string }) => ShownNotification;
  readonly isWindowFocused: (windowId: string) => boolean;
  // Trae al frente esa ventana o, si ya no existe, la principal. Devuelve la que quedo al frente.
  readonly focusWindow: (windowId: string) => string;
  readonly sendClicked: (windowId: string, target: NotificationTarget) => void;
}

export class NotificationCenter {
  private readonly live = new Set<ShownNotification>();

  constructor(private readonly deps: NotificationCenterDeps) {}

  // Muestra la notificacion salvo que su ventana tenga el foco (seria ruido). true si se mostro.
  show(params: NotifyParams, windowId: string): boolean {
    if (!this.deps.isSupported() || this.deps.isWindowFocused(windowId)) return false;
    const notification = this.deps.create({ title: params.title, body: params.body });
    this.live.add(notification);
    notification.on('click', () => this.onClick(notification, params.target, windowId));
    notification.on('close', () => this.live.delete(notification));
    notification.show();
    return true;
  }

  // Cuantas siguen vivas esperando un clic (para tests y diagnostico).
  get pendingCount(): number {
    return this.live.size;
  }

  private onClick(notification: ShownNotification, target: NotificationTarget | undefined, windowId: string): void {
    this.live.delete(notification);
    const focused = this.deps.focusWindow(windowId);
    // ponytail: si la ventana hubo que RECREARLA, su renderer aun no escucha y el destino se pierde
    // (queda solo el foco); un buffer por ventana lo arreglaria si llega a importar.
    if (target !== undefined) this.deps.sendClicked(focused, target);
  }
}
