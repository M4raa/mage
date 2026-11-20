import type { SessionLogFn } from '../engine/agentSession';

// Cierre de las subsesiones (las que una conversación crea con `mage_create_session`). Una delegada terminada se quedaba
// viva horas, y si su proceso moría Mage lo relanzaba: con muchas seguidas se agotaba la memoria del equipo. Por defecto
// (`onDone: 'close'`) main la cierra unos minutos después de entregar su resultado; `keepAlive` la deja como antes.

export type OnDone = 'close' | 'keepAlive';
export const DEFAULT_ON_DONE: OnDone = 'close';
// Plazo entre el final del turno (con su resultado entregado) y el cierre.
export const CLOSE_AFTER_DONE_MS = 5 * 60_000;

export interface CloseAfterDoneInput {
  readonly onDone: OnDone;
  readonly finishedAtMs: number;
  readonly resultDelivered: boolean;
  readonly now: number;
}

// PURA: ¿toca cerrar ya? Solo con `close`, con el resultado entregado a la creadora y cumplido el plazo.
export function closeAfterDone(input: CloseAfterDoneInput): boolean {
  if (input.onDone === 'keepAlive' || !input.resultDelivered) return false;
  return input.now - input.finishedAtMs >= CLOSE_AFTER_DONE_MS;
}

export interface DelegatedCloserDeps {
  readonly now: () => number;
  readonly setTimer: (fn: () => void, ms: number) => () => void;
  // Marca la sesión como cerrada a propósito (antes de pararla) para que cuente como terminada y un envío la reabra.
  readonly retire: (sessionId: string) => void;
  // Para la sesión y avisa a sus clientes (la pestaña que la tenga abierta se entera y queda lista para reabrirla).
  readonly close: (sessionId: string) => void;
  // Una sesión que se cierra sola no gasta peticiones en mantener caliente su caché.
  readonly excludeFromKeepAlive: (sessionId: string) => void;
  readonly log: SessionLogFn;
}

export class DelegatedCloser {
  private readonly policies = new Map<string, OnDone>();
  private readonly timers = new Map<string, () => void>();

  constructor(private readonly deps: DelegatedCloserDeps) {}

  // Una sesión delegada recién lanzada (o reabierta) con su política.
  register(sessionId: string, onDone: OnDone): void {
    this.policies.set(sessionId, onDone);
    if (onDone === 'close') this.deps.excludeFromKeepAlive(sessionId);
  }

  // Acabó un turno. Con `close` y el resultado entregado, empieza a contar; un turno anterior sin cerrar se descuenta.
  turnDone(sessionId: string, resultDelivered: boolean): void {
    const onDone = this.policies.get(sessionId);
    if (onDone === undefined) return;
    this.cancel(sessionId);
    if (onDone !== 'close' || !resultDelivered) return;
    this.arm(sessionId, { onDone, finishedAtMs: this.deps.now() });
  }

  // Un envío a la sesión antes del plazo: lo cancela; se vuelve a contar al acabar el siguiente turno.
  cancel(sessionId: string): void {
    this.timers.get(sessionId)?.();
    this.timers.delete(sessionId);
  }

  // La sesión ya no está viva por ninguna vía.
  forget(sessionId: string): void {
    this.cancel(sessionId);
    this.policies.delete(sessionId);
  }

  // `mage_close_session`: cierra ya, sin esperar al plazo.
  closeNow(sessionId: string): void {
    this.cancel(sessionId);
    this.deps.retire(sessionId);
    this.deps.close(sessionId);
  }

  private arm(sessionId: string, turn: { readonly onDone: OnDone; readonly finishedAtMs: number }): void {
    this.timers.set(sessionId, this.deps.setTimer(() => this.fire(sessionId, turn), CLOSE_AFTER_DONE_MS));
  }

  private fire(sessionId: string, turn: { readonly onDone: OnDone; readonly finishedAtMs: number }): void {
    this.timers.delete(sessionId);
    if (!closeAfterDone({ ...turn, resultDelivered: true, now: this.deps.now() })) return;
    // Se cierra aunque una pestaña la tenga abierta (las subsesiones se abren en pestaña al crearse): la pestaña se entera.
    try {
      this.deps.retire(sessionId);
      this.deps.close(sessionId);
    } catch (error) {
      this.deps.log('warn', 'No se pudo cerrar la subsesión terminada', { sessionId, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
