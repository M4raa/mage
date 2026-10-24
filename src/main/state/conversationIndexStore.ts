import { z } from 'zod';
import {
  CONVERSATION_INDEX_VERSION,
  MAX_ARTIFACTS,
  type ArtifactRecord,
  type ConversationPrefs,
} from '@shared/conversationIndex';
import type { ConversationId, NativeSessionRef } from '@shared/coordination';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';

// Persistencia del indice propio de Mage por conversacion (2.1) y del registro de artifacts (2.4), en
// userData/conversation-index.json. Los TIPOS y las constantes viven en @shared/conversationIndex
// porque cruzan el IPC; aqui solo el fichero y sus esquemas.
//
// Por que un solo fichero para los dos: comparten lo mismo — son conocimiento PROPIO de Mage sobre algo
// que el CLI no guarda, se escriben poco, se leen al abrir, y su ciclo de vida es el de la instalacion.
// El catalogo de comandos, en cambio, es CACHE que se reescribe en cada fin de turno y es dos ordenes
// de magnitud mas grande: mezclarlo aqui obligaria a reescribir el dato bueno constantemente.
//
// Por que no vive en `PersistedTab`: tiene que sobrevivir al CIERRE de la pestaña (se lee al reabrir la
// conversacion desde el historial, cuando ya no hay pestaña ninguna).
//
// v2 (F2.1): la clave de cada conversacion es su `ConversationId` (estable); la entrada guarda ademas su
// sesion nativa (`nativeRef`) y la ultima secuencia de eventos (`lastSeq`). Las claves de v1 eran el
// sessionId del CLI y se conservan tal cual como ConversationId; su `nativeRef` se completa al abrirlas.
export interface ConversationEntry extends ConversationPrefs {
  readonly nativeRef?: NativeSessionRef;
  readonly lastSeq?: number;
}

export interface ConversationIndexFile {
  readonly version: number;
  readonly conversations: Readonly<Record<ConversationId, ConversationEntry>>;
  readonly artifacts: Readonly<Record<string, ArtifactRecord>>; // clave: URL del artifact
}

// Version anterior que se sabe migrar: misma forma, sin `nativeRef` ni `lastSeq`.
const LEGACY_INDEX_VERSION = 1;
// Respaldo del fichero v1 antes de la primera escritura en v2: Mage 0.1.2 lee un v2 como indice vacio
// (comprueba la version), asi que volver atras pierde las preferencias si no hay copia.
const LEGACY_BACKUP_SUFFIX = '.v1.bak';

const PREF_KEYS = ['model', 'effort', 'permissionMode', 'provider', 'alwaysAllowTools'] as const;

const PREFS_SCHEMA = z.object({
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']).optional().catch(undefined),
  provider: z.string().min(1).optional().catch(undefined),
  // "Permitir siempre <tool> aqui" (2.3b).
  alwaysAllowTools: z.array(z.string().min(1)).optional(),
});

const NATIVE_REF_SCHEMA = z.object({ provider: z.string().min(1), accountDir: z.string().min(1), nativeId: z.string().min(1) });

const ENTRY_SCHEMA = PREFS_SCHEMA.extend({
  nativeRef: NATIVE_REF_SCHEMA.optional().catch(undefined),
  lastSeq: z.number().int().nonnegative().optional().catch(undefined),
});

const ARTIFACT_SCHEMA = z.object({
  accountDir: z.string(),
  title: z.string(),
  favicon: z.string(),
  publishedAtMs: z.number().int().nonnegative(),
});

const INDEX_FILE_SCHEMA = z.object({
  version: z.number(),
  conversations: z.record(z.string(), ENTRY_SCHEMA),
  artifacts: z.record(z.string(), ARTIFACT_SCHEMA),
});

const EMPTY_INDEX: ConversationIndexFile = { version: CONVERSATION_INDEX_VERSION, conversations: {}, artifacts: {} };

export interface ConversationIndexStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
}

export class ConversationIndexStore {
  // Contenido v1 leido de disco y aun sin respaldar: se copia antes de la primera escritura en v2.
  private legacyContent: string | null = null;

  constructor(private readonly deps: ConversationIndexStoreDeps) {}

  // Preferencias de una conversacion, o null si no hay ninguna guardada (que es lo que devuelve una
  // instalacion sin fichero: entonces la pestaña se abre con los defaults de siempre). `id` es su
  // ConversationId o el id de su sesion nativa (el renderer conoce el nativo).
  loadPrefs(id: string): ConversationPrefs | null {
    const index = this.read();
    const entry = index.conversations[keyFor(index, id)];
    return entry === undefined ? null : prefsOf(entry);
  }

  // Fusion PARCIAL: lo que no venga en `prefs` se conserva. Un campo con cadena vacia se BORRA (paridad
  // con `setActiveEffort`, que trata '' como "sin esfuerzo"), porque guardar '' haria que la
  // conversacion arrancara con un `--effort ` vacio.
  savePrefs(id: string, prefs: ConversationPrefs): void {
    if (id.length === 0) {
      throw new Error(`sessionId vacio al guardar las preferencias de la conversacion: ${JSON.stringify(id)}`);
    }
    const index = this.read();
    const key = keyFor(index, id);
    const merged = mergePrefs(index.conversations[key], prefs);
    this.write({ ...index, conversations: { ...index.conversations, [key]: merged } });
  }

  // Olvida una conversacion (la borra `ConversationsDelete`). No-op si no estaba.
  forgetConversation(id: string): void {
    const index = this.read();
    const key = keyFor(index, id);
    if (index.conversations[key] === undefined) return;
    const conversations = { ...index.conversations };
    delete conversations[key];
    this.write({ ...index, conversations });
  }

  // ConversationId de una sesion nativa (F2.1): la entrada que ya la tenga, la de v1 cuya clave es su id
  // nativo (y entonces se completa su `nativeRef`), o una nueva con el id nativo como clave. Solo escribe si
  // algo cambia: abrir la misma conversacion dos veces no toca el disco.
  resolveConversation(ref: NativeSessionRef): { readonly conversationId: ConversationId; readonly lastSeq: number } {
    if (ref.nativeId.length === 0) throw new Error(`nativeId vacio al resolver la conversacion: ${JSON.stringify(ref)}`);
    const index = this.read();
    const key = keyFor(index, ref.nativeId);
    const entry = index.conversations[key];
    if (entry === undefined || !sameRef(entry.nativeRef, ref)) {
      this.write({ ...index, conversations: { ...index.conversations, [key]: { ...entry, nativeRef: ref } } });
    }
    return { conversationId: key, lastSeq: entry?.lastSeq ?? 0 };
  }

  // Ultima secuencia de eventos de una conversacion conocida; nunca retrocede.
  recordLastSeq(conversationId: ConversationId, seq: number): void {
    const index = this.read();
    const entry = index.conversations[conversationId];
    if (entry === undefined || seq <= (entry.lastSeq ?? 0)) return;
    this.write({ ...index, conversations: { ...index.conversations, [conversationId]: { ...entry, lastSeq: seq } } });
  }

  nativeRefOf(conversationId: ConversationId): NativeSessionRef | null {
    return this.read().conversations[conversationId]?.nativeRef ?? null;
  }

  recordArtifact(url: string, record: ArtifactRecord): void {
    if (url.length === 0) throw new Error(`URL vacia al registrar un artifact: ${JSON.stringify(url)}`);
    const index = this.read();
    const artifacts = evictOldest({ ...index.artifacts, [url]: record }, MAX_ARTIFACTS);
    this.write({ ...index, artifacts });
  }

  loadArtifact(url: string): ArtifactRecord | null {
    return this.read().artifacts[url] ?? null;
  }

  // Lectura TOLERANTE: fichero ausente, corrupto o de una version desconocida -> indice vacio
  // (comportamiento de antes del indice). La v1 se migra en memoria. Nunca lanza por el contenido:
  // perder estas preferencias no puede impedir abrir una conversacion.
  private read(): ConversationIndexFile {
    if (!this.deps.exists(this.deps.filePath)) return EMPTY_INDEX;
    const content = this.readContent();
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      if (err instanceof SyntaxError) return EMPTY_INDEX; // solo un JSON MAL FORMADO cae a defaults (B9)
      throw err;
    }
    const result = INDEX_FILE_SCHEMA.safeParse(parsed);
    if (!result.success) return EMPTY_INDEX;
    if (result.data.version === LEGACY_INDEX_VERSION) {
      this.legacyContent = content;
      return { ...result.data, version: CONVERSATION_INDEX_VERSION };
    }
    return result.data.version === CONVERSATION_INDEX_VERSION ? result.data : EMPTY_INDEX;
  }

  // Un EACCES/EBUSY —antivirus o agente de backup reteniendo el fichero, cosa habitual en Windows— era
  // indistinguible del JSON corrupto: se cargaban defaults y el siguiente `save()` SOBRESCRIBIA los datos
  // reales del usuario (B9). Un fallo de lectura tiene que doler, no borrar.
  private readContent(): string {
    try {
      return this.deps.readFile(this.deps.filePath);
    } catch (err) {
      throw new Error(`No se pudo leer ${this.deps.filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Se valida al CARGAR, no al escribir (P10): un segundo `safeParse` del documento entero aqui hacia
  // O(n²) cada `recordArtifact`. `next` lo acaba de construir esta clase con tipos, y la lectura tolerante
  // sigue siendo la red si el fichero se corrompe por fuera. Antes de la primera escritura sobre un v1, su
  // copia: Mage 0.1.2 no sabe leer el v2.
  private write(next: ConversationIndexFile): void {
    this.backupLegacy();
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify(next, null, 2));
  }

  private backupLegacy(): void {
    if (this.legacyContent === null) return;
    const backup = `${this.deps.filePath}${LEGACY_BACKUP_SUFFIX}`;
    if (!this.deps.exists(backup)) writeAtomic(this.deps, backup, this.legacyContent);
    this.legacyContent = null;
  }
}

// Clave de la entrada de `id`: la suya si es un ConversationId (O(1), el caso comun), la de la entrada
// cuya sesion nativa es `id`, o `id` si no hay ninguna (conversacion nueva o anterior a F2.1).
function keyFor(index: ConversationIndexFile, id: string): ConversationId {
  if (index.conversations[id] !== undefined) return id;
  const owner = Object.entries(index.conversations).find(([, entry]) => entry.nativeRef?.nativeId === id);
  return owner === undefined ? id : owner[0];
}

function sameRef(a: NativeSessionRef | undefined, b: NativeSessionRef): boolean {
  return a !== undefined && a.provider === b.provider && a.accountDir === b.accountDir && a.nativeId === b.nativeId;
}

// Solo las preferencias (sin identidad ni secuencia); null si la entrada no tiene ninguna.
function prefsOf(entry: ConversationEntry): ConversationPrefs | null {
  const present = PREF_KEYS.filter((key) => entry[key] !== undefined);
  if (present.length === 0) return null;
  return Object.fromEntries(present.map((key) => [key, entry[key]])) as ConversationPrefs;
}

// Fusion campo a campo: `undefined` conserva lo que hubiera; cadena vacia borra.
function mergePrefs(current: ConversationEntry | undefined, incoming: ConversationPrefs): ConversationEntry {
  const merged: Record<string, unknown> = { ...current };
  for (const key of ['model', 'effort', 'permissionMode', 'provider'] as const) {
    const value = incoming[key];
    if (value === undefined) continue;
    if (value.length === 0) delete merged[key];
    else merged[key] = value;
  }
  // Las reglas de permiso son una LISTA, no una cadena: se reemplaza entera cuando viene (el renderer
  // manda siempre el estado completo de la conversacion) y se BORRA la clave si llega vacia, para no
  // dejar un `[]` de ruido en el fichero. Ausente = no se toca, igual que los tres campos de arriba.
  if (incoming.alwaysAllowTools !== undefined) {
    if (incoming.alwaysAllowTools.length === 0) delete merged.alwaysAllowTools;
    else merged.alwaysAllowTools = [...incoming.alwaysAllowTools];
  }
  return merged as ConversationEntry;
}

// Desaloja los artifacts mas antiguos hasta caber en `max`. Ordenar por `publishedAtMs` (y no confiar
// en el orden de insercion del objeto) es lo que hace que el desalojo sea el esperado tras releer el
// fichero de disco.
function evictOldest(artifacts: Record<string, ArtifactRecord>, max: number): Record<string, ArtifactRecord> {
  const entries = Object.entries(artifacts);
  if (entries.length <= max) return artifacts;
  entries.sort((a, b) => b[1].publishedAtMs - a[1].publishedAtMs);
  return Object.fromEntries(entries.slice(0, max));
}
