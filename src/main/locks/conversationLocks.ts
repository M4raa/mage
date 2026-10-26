import { join } from 'node:path';
import { z } from 'zod';
import type { ConversationLockRef, ConversationLockStatus } from '@shared/conversationLock';

// Bloqueo de conversación entre instancias (#55, F2.8; §4 de INFORME-019 con H4 de la devolución 13). Un fichero por
// conversación en un directorio de Mage COMPARTIDO por todos sus perfiles y fuera de ellos (nunca en el config dir de
// la cuenta, que es del CLI). Creación exclusiva: de dos instancias que abren la misma conversación, solo una crea el
// fichero; la otra la ve en solo lectura. La dueña late cada 30 s; un lock con el pid muerto o sin latido en 90 s es
// huérfano y solo entonces se ofrece «Tomar el control». Puro: ficheros, reloj y procesos se inyectan.

export const HEARTBEAT_MS = 30_000;
export const ORPHAN_MS = 90_000;

// Quién sujeta la conversación DENTRO de esta instancia: pestañas (`tab:<ventana>:<pestaña>`) y sesiones en segundo
// plano con turno (`session:<id>`). El fichero se borra cuando no queda ninguno.
export type LockHolder = string;

export interface LockIdentity {
  // Distinto en cada arranque: dos ejecuciones del mismo perfil no se confunden.
  readonly instanceId: string;
  // Nombre legible del perfil para «Abierta en otra instancia de Mage (<perfil>)».
  readonly profile: string;
  readonly profileHash: string;
  readonly pid: number;
}

export interface LockFs {
  readonly ensureDir: (dir: string) => void;
  // Crea el fichero solo si no existe; false si ya existía (lo tiene otro).
  readonly createExclusive: (path: string, content: string) => boolean;
  // Contenido, o null si no existe.
  readonly read: (path: string) => string | null;
  // Sustitución atómica (temporal + rename): un lector nunca ve el fichero a medias.
  readonly replace: (path: string, content: string) => void;
  readonly remove: (path: string) => void;
  // Última modificación, o null si no existe.
  readonly mtimeMs: (path: string) => number | null;
}

export interface ConversationLocksDeps {
  readonly dir: string;
  readonly identity: LockIdentity;
  // Nombre del fichero de una conversación: hash de (proveedor, cuenta canonizada, id nativo).
  readonly fileNameOf: (ref: ConversationLockRef) => string;
  readonly now: () => number;
  readonly isPidAlive: (pid: number) => boolean;
  readonly fs: LockFs;
}

const RECORD_SCHEMA = z.object({
  instanceId: z.string().min(1),
  profile: z.string(),
  profileHash: z.string(),
  pid: z.number().int().positive(),
  startedAt: z.number(),
  heartbeatAt: z.number(),
});
type LockRecord = z.infer<typeof RECORD_SCHEMA>;

const UNKNOWN_PROFILE = 'perfil desconocido';
// Si el fichero desaparece entre «no pude crearlo» y «leerlo» (la otra lo soltó justo entonces), se reintenta.
const CREATE_ATTEMPTS = 2;

export interface HeartbeatFailure {
  readonly ref: ConversationLockRef;
  readonly error: Error;
}

export interface HeartbeatResult {
  readonly lost: readonly ConversationLockRef[];
  readonly failed: readonly HeartbeatFailure[];
}

interface Owned {
  readonly ref: ConversationLockRef;
  readonly path: string;
  readonly holders: Set<LockHolder>;
  readonly startedAt: number;
}

export class ConversationLocks {
  private readonly owned = new Map<string, Owned>();

  constructor(private readonly deps: ConversationLocksDeps) {}

  // La conversación para `holder`: si ya es de esta instancia, se suma; si no, se intenta crear el fichero.
  acquire(ref: ConversationLockRef, holder: LockHolder): ConversationLockStatus {
    const path = this.pathOf(ref);
    const mine = this.owned.get(path);
    if (mine !== undefined) {
      mine.holders.add(holder);
      return { owner: true };
    }
    this.deps.fs.ensureDir(this.deps.dir);
    for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
      if (this.deps.fs.createExclusive(path, this.recordJson(this.deps.now()))) return this.own(ref, path, holder);
      const other = this.describeOther(path);
      if (other !== null) return other;
    }
    throw new Error(`No se pudo crear ni leer el bloqueo de la conversación ${ref.nativeId}: ${path}`);
  }

  // «Tomar el control»: solo si el lock de la otra instancia es huérfano (pid muerto o sin latido en 90 s).
  // ponytail: dos instancias que toman el MISMO huérfano en el mismo milisegundo podrían quedar las dos dueñas
  // (borrar + crear no es atómico). Si llega a pasar: renombrar a una lápida y comprobarla antes de crear.
  takeOver(ref: ConversationLockRef, holder: LockHolder): ConversationLockStatus {
    const status = this.acquire(ref, holder);
    if (status.owner || !status.orphan) return status;
    const path = this.pathOf(ref);
    this.deps.fs.remove(path);
    if (this.deps.fs.createExclusive(path, this.recordJson(this.deps.now()))) return this.own(ref, path, holder);
    return this.describeOther(path) ?? status;
  }

  // Suelta a `holder`; sin nadie más, el fichero se borra (solo si sigue siendo de esta instancia).
  release(ref: ConversationLockRef, holder: LockHolder): void {
    this.releaseWhere((candidate, owned) => candidate === holder && owned.path === this.pathOf(ref));
  }

  // Suelta a todos los que cumplan `matches` (una ventana que se cierra, una sesión que para).
  releaseWhere(matches: (holder: LockHolder, owned: { readonly path: string }) => boolean): void {
    for (const owned of [...this.owned.values()]) {
      for (const holder of [...owned.holders]) if (matches(holder, owned)) owned.holders.delete(holder);
      if (owned.holders.size === 0) this.drop(owned);
    }
  }

  // Al salir: todas las de esta instancia.
  releaseAll(): void {
    for (const owned of [...this.owned.values()]) this.drop(owned);
  }

  // Estado sin sujetar nada (la guarda de `createSession`): null si nadie la tiene.
  peek(ref: ConversationLockRef): ConversationLockStatus | null {
    const path = this.pathOf(ref);
    if (this.owned.has(path)) return { owner: true };
    return this.describeOther(path);
  }

  // El latido: renueva las de esta instancia, cada una por separado. Devuelve las que PERDIÓ (otra instancia tomó el
  // control mientras esta no latía, p. ej. con el equipo suspendido: ya no se escriben ni se borran) y las que no se
  // pudieron renovar por un error de E/S, que SIGUEN siendo de esta instancia (H1 de la devolución 17): un fallo en una
  // no impide renovar las demás.
  heartbeat(): HeartbeatResult {
    const lost: ConversationLockRef[] = [];
    const failed: HeartbeatFailure[] = [];
    for (const owned of [...this.owned.values()]) {
      try {
        if (this.renew(owned)) continue;
        this.owned.delete(owned.path);
        lost.push(owned.ref);
      } catch (err) {
        failed.push({ ref: owned.ref, error: err instanceof Error ? err : new Error(`Fallo no tipado: ${String(err)}`) });
      }
    }
    return { lost, failed };
  }

  // true = renovada; false = ya no es de esta instancia.
  private renew(owned: Owned): boolean {
    if (!this.isStillMine(owned.path)) return false;
    this.deps.fs.replace(owned.path, this.recordJson(owned.startedAt));
    return true;
  }

  private own(ref: ConversationLockRef, path: string, holder: LockHolder): ConversationLockStatus {
    this.owned.set(path, { ref, path, holders: new Set([holder]), startedAt: this.deps.now() });
    return { owner: true };
  }

  private drop(owned: Owned): void {
    this.owned.delete(owned.path);
    if (this.isStillMine(owned.path)) this.deps.fs.remove(owned.path);
  }

  private isStillMine(path: string): boolean {
    return parseRecord(this.deps.fs.read(path))?.instanceId === this.deps.identity.instanceId;
  }

  // Quién la tiene, o null si el fichero ya no existe. Un fichero ilegible (otra instancia escribiéndolo, o roto) no es
  // huérfano hasta que pasa el plazo del latido sin cambiar.
  private describeOther(path: string): ConversationLockStatus | null {
    const text = this.deps.fs.read(path);
    if (text === null) return null;
    const record = parseRecord(text);
    if (record === null) {
      const mtime = this.deps.fs.mtimeMs(path);
      return { owner: false, profile: UNKNOWN_PROFILE, orphan: mtime !== null && this.deps.now() - mtime > ORPHAN_MS };
    }
    const orphan = !this.deps.isPidAlive(record.pid) || this.deps.now() - record.heartbeatAt > ORPHAN_MS;
    return { owner: false, profile: record.profile.length > 0 ? record.profile : UNKNOWN_PROFILE, orphan };
  }

  private pathOf(ref: ConversationLockRef): string {
    return join(this.deps.dir, this.deps.fileNameOf(ref));
  }

  private recordJson(startedAt: number): string {
    const { instanceId, profile, profileHash, pid } = this.deps.identity;
    const record: LockRecord = { instanceId, profile, profileHash, pid, startedAt, heartbeatAt: this.deps.now() };
    return JSON.stringify(record);
  }
}

function parseRecord(text: string | null): LockRecord | null {
  if (text === null || text.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    // Un JSON a medias o roto es justo el caso «ilegible» que trata quien llama (por el mtime).
    if (err instanceof SyntaxError) return null;
    throw err;
  }
  const result = RECORD_SCHEMA.safeParse(parsed);
  return result.success ? result.data : null;
}
