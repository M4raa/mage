import { z } from 'zod';
import type { HostPairAnswer, HostPairRequestView } from '@shared/hostClients';
import type { HostPairRequest } from './hostProtocol';
import { PairingRefusedError } from './hostErrors';

// Las peticiones de emparejamiento esperando respuesta en la ventana de Mage. Sin E/S: la ventana llega por `deps`
// (`canAsk` y `publish`), así que se prueba con dobles. Una petición acaba de UNA forma: autorizada, rechazada, sin
// respuesta en `PAIR_TIMEOUT_MS` o sin ventana a la que preguntar.

export const PAIR_TIMEOUT_MS = 2 * 60_000;
const MAX_REQUEST_ID_CHARS = 128;

const PAIR_ANSWER_SCHEMA = z.object({ requestId: z.string().min(1).max(MAX_REQUEST_ID_CHARS), approve: z.boolean() }).strict();

// La respuesta del diálogo llega del renderer: se valida antes de tocar nada.
export function parseHostPairAnswer(value: unknown): HostPairAnswer {
  const parsed = PAIR_ANSWER_SCHEMA.safeParse(value);
  if (!parsed.success) throw new Error(`Respuesta de emparejamiento inválida: ${JSON.stringify(value)}`);
  return parsed.data;
}

export interface HostPairingDeps {
  // Hay una ventana que pueda enseñar el diálogo (false en el modo sin interfaz). Puede traerla al frente.
  readonly canAsk: () => boolean;
  // La lista entera de pendientes, cada vez que cambia.
  readonly publish: (pending: readonly HostPairRequestView[]) => void;
  readonly setTimer: (fn: () => void, ms: number) => () => void;
  readonly newId: () => string;
}

interface Pending {
  readonly view: HostPairRequestView;
  readonly settle: (error: PairingRefusedError | null) => void;
}

export class HostPairing {
  private readonly pendingById = new Map<string, Pending>();

  constructor(private readonly deps: HostPairingDeps) {}

  // Se resuelve si el usuario autoriza; si no, rechaza con `PairingRefusedError` y su motivo.
  ask(request: HostPairRequest): Promise<void> {
    if (!this.deps.canAsk()) return Promise.reject(new PairingRefusedError('noWindow'));
    return new Promise<void>((resolve, reject) => {
      const view: HostPairRequestView = { requestId: this.deps.newId(), clientName: request.clientName, clientKind: request.clientKind };
      const cancelTimer = this.deps.setTimer(() => this.finish(view.requestId, new PairingRefusedError('timeout')), PAIR_TIMEOUT_MS);
      const settle = (error: PairingRefusedError | null): void => {
        cancelTimer();
        if (error === null) resolve();
        else reject(error);
      };
      this.pendingById.set(view.requestId, { view, settle });
      this.publishPending();
    });
  }

  // La respuesta de la ventana. Una petición que ya acabó (plazo vencido, otra ventana contestó) se ignora: false.
  answer(requestId: string, approve: boolean): boolean {
    return this.finish(requestId, approve ? null : new PairingRefusedError('rejected'));
  }

  pending(): readonly HostPairRequestView[] {
    return [...this.pendingById.values()].map((entry) => entry.view);
  }

  private finish(requestId: string, error: PairingRefusedError | null): boolean {
    const entry = this.pendingById.get(requestId);
    if (entry === undefined) return false;
    this.pendingById.delete(requestId);
    entry.settle(error);
    this.publishPending();
    return true;
  }

  private publishPending(): void {
    this.deps.publish(this.pending());
  }
}
