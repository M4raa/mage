import type { CloseReceipt, ConversationSnapshot } from '@shared/coordination';
import type { SessionCoordinator } from '../coordination/sessionCoordinator';

// Qué ventanas siguen qué sesiones del host (U17). Una ventana que adopta una sesión se suscribe al coordinador
// y recibe sus eventos por el canal de siempre; esta clase recuerda la suscripción para no duplicarla (una
// recarga de la ventana vuelve a pedirla) y la suelta cuando la ventana se destruye o la sesión termina.
// Soltar una ventana NUNCA para la sesión: la sigue la terminal o el MCP.

// Lo mínimo de un webContents, para no depender de Electron.
export interface AttachTarget {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
  onceDestroyed(fn: () => void): void;
}

export interface WindowAttachmentsDeps {
  readonly coordinator: Pick<SessionCoordinator, 'subscribe' | 'snapshot'>;
  readonly eventChannel: string;
}

// Un webContents de Electron, visto estructuralmente.
export interface SenderLike {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
  once(event: 'destroyed', fn: () => void): unknown;
}

export function toAttachTarget(sender: SenderLike): AttachTarget {
  return {
    id: sender.id,
    isDestroyed: () => sender.isDestroyed(),
    send: (channel, payload) => sender.send(channel, payload),
    onceDestroyed: (fn) => { sender.once('destroyed', fn); },
  };
}

const keyOf = (targetId: number, sessionId: string): string => `${targetId}:${sessionId}`;

export class WindowAttachments {
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly watchedWindows = new Set<number>();

  constructor(private readonly deps: WindowAttachmentsDeps) {}

  attach(target: AttachTarget, sessionId: string): ConversationSnapshot {
    const { coordinator, eventChannel } = this.deps;
    if (this.isAttached(target.id, sessionId)) return coordinator.snapshot(sessionId);
    const subscription = coordinator.subscribe(sessionId, {
      sink: (payload) => { if (!target.isDestroyed()) target.send(eventChannel, payload); },
      onClosed: () => this.forget(target.id, sessionId),
    });
    this.unsubscribers.set(keyOf(target.id, sessionId), subscription.unsubscribe);
    this.watchDestruction(target);
    return subscription.snapshot;
  }

  detach(targetId: number, sessionId: string): boolean {
    const unsubscribe = this.unsubscribers.get(keyOf(targetId, sessionId));
    if (unsubscribe === undefined) return false;
    unsubscribe();
    this.unsubscribers.delete(keyOf(targetId, sessionId));
    return true;
  }

  isAttached(targetId: number, sessionId: string): boolean {
    return this.unsubscribers.has(keyOf(targetId, sessionId));
  }

  // La sesión terminó: el coordinador ya vació sus listeners, solo hay que olvidar la clave.
  private forget(targetId: number, sessionId: string): void {
    this.unsubscribers.delete(keyOf(targetId, sessionId));
  }

  private watchDestruction(target: AttachTarget): void {
    if (this.watchedWindows.has(target.id)) return;
    this.watchedWindows.add(target.id);
    target.onceDestroyed(() => this.detachAll(target.id));
  }

  // Suelta todas las de una ventana destruida. NUNCA para la sesión.
  private detachAll(targetId: number): void {
    const prefix = `${targetId}:`;
    for (const key of [...this.unsubscribers.keys()]) {
      if (!key.startsWith(prefix)) continue;
      this.unsubscribers.get(key)?.();
      this.unsubscribers.delete(key);
    }
    this.watchedWindows.delete(targetId);
  }
}

export interface CloseFromWindowDeps {
  readonly attachments: Pick<WindowAttachments, 'detach'>;
  readonly coordinator: { subscriberCount(sessionId: string): number; close(sessionId: string): CloseReceipt };
}

// Cerrar en la ventana la pestaña de una sesión del host (U17) no la corta si otro cliente (terminal o MCP) la sigue
// usando: solo se suelta la ventana. Sin nadie más, la política de siempre.
export function closeFromWindow({ attachments, coordinator }: CloseFromWindowDeps, webContentsId: number, sessionId: string): CloseReceipt {
  const adopted = attachments.detach(webContentsId, sessionId);
  if (adopted && coordinator.subscriberCount(sessionId) > 0) return { background: false };
  return coordinator.close(sessionId);
}
