import { createHash } from 'node:crypto';
import { MagePolicyError } from './errors';

// Cota de memoria por proceso de conexión, configurable; no sustituye persistencia de F7.
export const DEFAULT_IDEMPOTENCY_CAPACITY = 1024;
export interface IdempotencyRequest { readonly namespace: string; readonly requestId: string; readonly fingerprint: string }
export interface IdempotencyStore {
  execute<T>(request: IdempotencyRequest, effect: () => Promise<T>): Promise<T>;
}
interface Entry { readonly fingerprint: string; readonly promise: Promise<unknown>; settled: boolean }

// Orden estable también para objetos anidados. Solo recibe contenido ya validado y ámbito confiable.
export function canonicalFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalValue(item)]));
}
// Horizonte acotado: expulsar una entrada elimina su garantía. F7 deberá inyectar un almacén
// duradero compartido entre reconexiones; nunca se expulsa una operación todavía en vuelo.
export class MemoryIdempotencyStore implements IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly capacity = DEFAULT_IDEMPOTENCY_CAPACITY) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`idempotency_capacity: valor recibido ${capacity}`);
  }
  execute<T>(request: IdempotencyRequest, effect: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([request.namespace, request.requestId]);
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      if (existing.fingerprint !== request.fingerprint) throw new MagePolicyError(`idempotency_conflict: requestId ${request.requestId}`);
      return existing.promise as Promise<T>;
    }
    this.makeRoom();
    // La microtarea empieza DESPUÉS de insertar el Promise, incluso si el efecto lanza síncronamente.
    const promise = Promise.resolve().then(effect);
    const entry: Entry = { fingerprint: request.fingerprint, promise, settled: false };
    this.entries.set(key, entry);
    void promise.then(() => { entry.settled = true; }, () => { entry.settled = true; });
    return promise;
  }
  private makeRoom(): void {
    if (this.entries.size < this.capacity) return;
    for (const [key, entry] of this.entries) {
      if (!entry.settled) continue;
      this.entries.delete(key);
      return;
    }
    throw new MagePolicyError(`idempotency_capacity: capacidad ${this.capacity}`);
  }
}
