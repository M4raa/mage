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
//   - `copies`: las copias de hilos de Codex y su origen.
// El esquema es tolerante (`.catch`) en cada mapa; un fichero ilegible o de otra version empieza vacio y no se
// sobrescribe hasta la primera escritura.

const STATE_VERSION = 1;

const forkSchema = z.object({ parent: z.string(), provider: z.string(), atMs: z.number() });
const copySchema = z.object({ origin: z.string(), atMs: z.number() });

const stateSchema = z.object({
  version: z.literal(STATE_VERSION),
  pendingCuts: z.record(z.string(), z.string()).catch({}),
  forks: z.record(z.string(), forkSchema).catch({}),
  copies: z.record(z.string(), copySchema).catch({}),
});

type RewindState = z.infer<typeof stateSchema>;
export type ForkRecord = z.infer<typeof forkSchema>;

export interface RewindStateStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
  readonly log: (level: 'warn', message: string, data?: unknown) => void;
}

function emptyState(): RewindState {
  return { version: STATE_VERSION, pendingCuts: {}, forks: {}, copies: {} };
}

function requireId(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} no puede estar vacio: ${JSON.stringify(value)}`);
}

function requireUuid(value: string, label: string): void {
  if (typeof value !== 'string' || !isUuid(value)) throw new Error(`${label} no es un uuid: ${JSON.stringify(value)}`);
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

  // Quita el hilo de los tres mapas (al borrarlo). Sin rastro, no escribe.
  forgetThread(threadId: string): void {
    requireId(threadId, 'threadId');
    const state = this.load();
    const found = threadId in state.copies || threadId in state.forks || threadId in state.pendingCuts;
    if (!found) return;
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
