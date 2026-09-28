import { z } from 'zod';
import {
  CONVERSATION_INDEX_VERSION,
  MAX_ARTIFACTS,
  type ArtifactRecord,
  type ConversationPrefs,
} from '@shared/conversationIndex';
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
export interface ConversationIndexFile {
  readonly version: number;
  readonly conversations: Readonly<Record<string, ConversationPrefs>>; // clave: sessionId del CLI
  readonly artifacts: Readonly<Record<string, ArtifactRecord>>; // clave: URL del artifact
}

const PREFS_SCHEMA = z.object({
  model: z.string().min(1).optional(),
  effort: z.string().min(1).optional(),
  permissionMode: z.enum(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']).optional().catch(undefined),
  // "Permitir siempre <tool> aqui" (2.3b).
  alwaysAllowTools: z.array(z.string().min(1)).optional(),
});

const ARTIFACT_SCHEMA = z.object({
  accountDir: z.string(),
  title: z.string(),
  favicon: z.string(),
  publishedAtMs: z.number().int().nonnegative(),
});

const INDEX_FILE_SCHEMA = z.object({
  version: z.number(),
  conversations: z.record(z.string(), PREFS_SCHEMA),
  artifacts: z.record(z.string(), ARTIFACT_SCHEMA),
});

const EMPTY_INDEX: ConversationIndexFile = { version: CONVERSATION_INDEX_VERSION, conversations: {}, artifacts: {} };

export interface ConversationIndexStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
}

export class ConversationIndexStore {
  constructor(private readonly deps: ConversationIndexStoreDeps) {}

  // Preferencias de una conversacion, o null si no hay ninguna guardada (que es lo que devuelve una
  // instalacion sin fichero: entonces la pestaña se abre con los defaults de siempre).
  loadPrefs(sessionId: string): ConversationPrefs | null {
    return this.read().conversations[sessionId] ?? null;
  }

  // Fusion PARCIAL: lo que no venga en `prefs` se conserva. Un campo con cadena vacia se BORRA (paridad
  // con `setActiveEffort`, que trata '' como "sin esfuerzo"), porque guardar '' haria que la
  // conversacion arrancara con un `--effort ` vacio.
  savePrefs(sessionId: string, prefs: ConversationPrefs): void {
    if (sessionId.length === 0) {
      throw new Error(`sessionId vacio al guardar las preferencias de la conversacion: ${JSON.stringify(sessionId)}`);
    }
    const index = this.read();
    const merged = mergePrefs(index.conversations[sessionId], prefs);
    this.write({ ...index, conversations: { ...index.conversations, [sessionId]: merged } });
  }

  // Olvida una conversacion (la borra `ConversationsDelete`). No-op si no estaba.
  forgetConversation(sessionId: string): void {
    const index = this.read();
    if (index.conversations[sessionId] === undefined) return;
    const conversations = { ...index.conversations };
    delete conversations[sessionId];
    this.write({ ...index, conversations });
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

  // Lectura TOLERANTE: fichero ausente, corrupto o de otra version -> indice vacio (comportamiento de
  // antes del indice). Nunca lanza: perder estas preferencias no puede impedir abrir una conversacion.
  private read(): ConversationIndexFile {
    if (!this.deps.exists(this.deps.filePath)) return EMPTY_INDEX;
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.deps.readFile(this.deps.filePath));
    } catch (err) {
      // Solo un JSON MAL FORMADO justifica caer a defaults (B9). Un EACCES/EBUSY —antivirus o
      // agente de backup reteniendo el fichero, cosa habitual en Windows— era indistinguible del
      // JSON corrupto: se cargaban defaults y el siguiente `save()` SOBRESCRIBIA los datos reales
      // del usuario. Un fallo de lectura tiene que doler, no borrar.
      if (!(err instanceof SyntaxError)) {
        throw new Error(`No se pudo leer ${this.deps.filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return EMPTY_INDEX;
    }
    const result = INDEX_FILE_SCHEMA.safeParse(parsed);
    if (!result.success || result.data.version !== CONVERSATION_INDEX_VERSION) return EMPTY_INDEX;
    return result.data;
  }

  // Se valida al CARGAR, no al escribir (P10). Antes habia un segundo `safeParse` del documento
  // ENTERO aqui, asi que cada `recordArtifact` validaba dos veces un objeto que crece: una O(n²)
  // real, y el motivo de que este fuera el test mas lento de toda la suite (746 ms de 2,9 s).
  // `next` lo acaba de construir esta misma clase con tipos: revalidarlo no aportaba nada que el
  // compilador no supiera ya, y la lectura tolerante sigue siendo la red por si el fichero se
  // corrompe por fuera.
  private write(next: ConversationIndexFile): void {
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify(next, null, 2));
  }
}

// Fusion campo a campo: `undefined` conserva lo que hubiera; cadena vacia borra.
function mergePrefs(current: ConversationPrefs | undefined, incoming: ConversationPrefs): ConversationPrefs {
  const merged: Record<string, unknown> = { ...current };
  for (const key of ['model', 'effort', 'permissionMode'] as const) {
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
  return merged as ConversationPrefs;
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
