import { z } from 'zod';
import { isUuid } from '@shared/sessionInput';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';

// Estado propio del rewind: `userData/rewind-state.json` (decision D-K3).
//
// El plan lo situaba en el indice v2 de conversaciones, pero `conversationIndexStore.ts` queda fuera de lo que
// puede tocar este carril; un fichero aparte tampoco arrastra a ese indice un esquema que no es suyo. Guarda
// tres cosas que Mage debe recordar entre arranques:
//   - `pendingCuts`: el corte de un rewind de Claude que aun no tiene mensaje nuevo (sessionId -> uuid objetivo);
//   - `forks`: de que conversacion nacio cada hijo (id nativo del hijo -> padre);
//   - `copies`: las copias de hilos de Codex y su origen;
//   - `keepAlive`: cuantos keep-alive de la cache se hicieron por conversacion de Claude y cuanto costaron (F4.6, D-K7).
// El esquema es tolerante (`.catch`) en cada mapa; un fichero ilegible o de otra version empieza vacio y no se
// sobrescribe hasta la primera escritura.

const STATE_VERSION = 1;

const forkSchema = z.object({ parent: z.string(), provider: z.string(), atMs: z.number() });
const copySchema = z.object({ origin: z.string(), atMs: z.number() });

const COUNTER = z.number().int().nonnegative();
const keepAliveSchema = z.object({ count: COUNTER, cacheReadTokens: COUNTER, cacheCreationTokens: COUNTER, costMicroUsd: COUNTER });

const stateSchema = z.object({
  version: z.literal(STATE_VERSION),
  pendingCuts: z.record(z.string(), z.string()).catch({}),
  forks: z.record(z.string(), forkSchema).catch({}),
  copies: z.record(z.string(), copySchema).catch({}),
  keepAlive: z.record(z.string(), keepAliveSchema).catch({}),
});

type RewindState = z.infer<typeof stateSchema>;
export type ForkRecord = z.infer<typeof forkSchema>;
export type KeepAliveTotals = z.infer<typeof keepAliveSchema>;

// Lo que un keep-alive dejo medido; null = el `result` no lo dijo (solo suma al contador).
export interface KeepAliveSample {
  readonly cacheReadTokens: number | null;
  readonly cacheCreationTokens: number | null;
  readonly costMicroUsd: number | null;
}

const SAMPLE_FIELDS = ['cacheReadTokens', 'cacheCreationTokens', 'costMicroUsd'] as const;

export interface RewindStateStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
  readonly log: (level: 'warn', message: string, data?: unknown) => void;
}

function emptyState(): RewindState {
  return { version: STATE_VERSION, pendingCuts: {}, forks: {}, copies: {}, keepAlive: {} };
}

function requireId(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} no puede estar vacio: ${JSON.stringify(value)}`);
}

function requireUuid(value: string, label: string): void {
  if (typeof value !== 'string' || !isUuid(value)) throw new Error(`${label} no es un uuid: ${JSON.stringify(value)}`);
}

function requireCounter(value: number | null, label: string): void {
  if (value === null) return;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} no es un entero >= 0: ${value}`);
}

export class RewindStateStore {
  // Se lee una vez y se cachea: main es el unico escritor.
  private state: RewindState | null = null;

  constructor(private readonly deps: RewindStateStoreDeps) {}

  pendingCut(sessionId: string): string | null {
    requireUuid(sessionId, 'sessionId');
    return this.load().pendingCuts[sessionId] ?? null;
  }

  setPendingCut(sessionId: string, targetUuid: string): void {
    requireUuid(sessionId, 'sessionId');
    requireUuid(targetUuid, 'targetUuid');
    const state = this.load();
    if (state.pendingCuts[sessionId] === targetUuid) return;
    state.pendingCuts[sessionId] = targetUuid;
    this.persist(state);
  }

  // Idempotente: sin entrada no escribe.
  clearPendingCut(sessionId: string): void {
    requireUuid(sessionId, 'sessionId');
    const state = this.load();
    if (!(sessionId in state.pendingCuts)) return;
    delete state.pendingCuts[sessionId];
    this.persist(state);
  }

  recordFork(childId: string, parent: string, provider: string, atMs: number): void {
    requireId(childId, 'childId');
    requireId(parent, 'parent');
    requireId(provider, 'provider');
    if (!Number.isFinite(atMs)) throw new Error(`atMs no es un numero finito: ${atMs}`);
    const state = this.load();
    state.forks[childId] = { parent, provider, atMs };
    this.persist(state);
  }

  forkOf(childId: string): ForkRecord | null {
    requireId(childId, 'childId');
    return this.load().forks[childId] ?? null;
  }

  recordCopy(copyThreadId: string, originThreadId: string, atMs: number): void {
    requireId(copyThreadId, 'copyThreadId');
    requireId(originThreadId, 'originThreadId');
    if (!Number.isFinite(atMs)) throw new Error(`atMs no es un numero finito: ${atMs}`);
    const state = this.load();
    state.copies[copyThreadId] = { origin: originThreadId, atMs };
    this.persist(state);
  }

  copyOrigin(threadId: string): string | null {
    requireId(threadId, 'threadId');
    return this.load().copies[threadId]?.origin ?? null;
  }

  // Suma un keep-alive a la conversacion: +1 al contador y cada medida que no sea null. Enteros >= 0 o lanza.
  recordKeepAlive(sessionId: string, sample: KeepAliveSample): void {
    requireId(sessionId, 'sessionId');
    for (const field of SAMPLE_FIELDS) requireCounter(sample[field], field);
    const state = this.load();
    const entry = state.keepAlive[sessionId] ?? { count: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costMicroUsd: 0 };
    state.keepAlive[sessionId] = {
      count: entry.count + 1,
      cacheReadTokens: entry.cacheReadTokens + (sample.cacheReadTokens ?? 0),
      cacheCreationTokens: entry.cacheCreationTokens + (sample.cacheCreationTokens ?? 0),
      costMicroUsd: entry.costMicroUsd + (sample.costMicroUsd ?? 0),
    };
    this.persist(state);
  }

  // La suma de todas las conversaciones.
  keepAliveTotals(): KeepAliveTotals {
    const total: KeepAliveTotals = { count: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costMicroUsd: 0 };
    return Object.values(this.load().keepAlive).reduce((acc, e) => ({
      count: acc.count + e.count,
      cacheReadTokens: acc.cacheReadTokens + e.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + e.cacheCreationTokens,
      costMicroUsd: acc.costMicroUsd + e.costMicroUsd,
    }), total);
  }

  // Quita el hilo de los cuatro mapas (al borrarlo). Sin rastro, no escribe.
  forgetThread(threadId: string): void {
    requireId(threadId, 'threadId');
    const state = this.load();
    const found = threadId in state.copies || threadId in state.forks || threadId in state.pendingCuts || threadId in state.keepAlive;
    if (!found) return;
    delete state.keepAlive[threadId];
    delete state.copies[threadId];
    delete state.forks[threadId];
    delete state.pendingCuts[threadId];
    this.persist(state);
  }

  private load(): RewindState {
    if (this.state !== null) return this.state;
    this.state = this.read();
    return this.state;
  }

  // Ausente -> vacio. Ilegible o de otra version -> vacio con aviso (el motivo va al log, no se traga).
  private read(): RewindState {
    const { filePath } = this.deps;
    if (!this.deps.exists(filePath)) return emptyState();
    try {
      return stateSchema.parse(JSON.parse(this.deps.readFile(filePath)));
    } catch (err) {
      this.deps.log('warn', 'rewind-state.json ilegible: se empieza vacio', { filePath, error: err instanceof Error ? err.message : String(err) });
      return emptyState();
    }
  }

  private persist(state: RewindState): void {
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify(state));
  }
}
