import { join } from 'node:path';
import type { ConversationSummary } from '@shared/conversations';
import type { ConversationPrivacy } from '@shared/state';
import { deriveConversationMeta, type ConversationMeta } from './conversationMeta';

// Lista las conversaciones EN DISCO de una cuenta para el sidebar-historial (M2.6): las compartidas
// (pozo comun, `<cuenta>/projects`) y las privadas (`<cuenta>/mage-private/projects`). Solo FS con DI
// -> testable. Lectura TOLERANTE por fichero (un .jsonl corrupto/desaparecido no aborta la lista; es
// una vista de historial, no un dato critico). No lee el contenido completo: un prefijo basta para
// cwd/titulo.

const PRIVATE_PROFILE_DIR = 'mage-private';
const JSONL_EXT = '.jsonl';
const PREFIX_BYTES = 64 * 1024; // prefijo por fichero para derivar cwd/titulo (cwd y 1er prompt van arriba)
// Cola por fichero: el CLI re-añade `custom-title`/`ai-title` al final, y el que vale es el ULTIMO
// (medido: en 60 de 267 transcripciones el `custom-title` estaba mas alla de la cabeza).
const SUFFIX_BYTES = 64 * 1024;
const MAX_CONVERSATIONS = 300; // tope del payload: las mas recientes (evita listas gigantes)

export interface ConversationsDeps {
  readonly exists: (path: string) => boolean;
  readonly listDir: (path: string) => string[];
  readonly isDirectory: (path: string) => boolean;
  // UN solo stat para mtime y tamaño: eran dos llamadas al FS por cada conversacion del historial.
  readonly statFile: (path: string) => { readonly mtimeMs: number; readonly sizeBytes: number };
  readonly readPrefix: (path: string, maxBytes: number) => string;
  // Los ULTIMOS `maxBytes` del fichero (todo el fichero si es mas pequeño).
  readonly readSuffix: (path: string, maxBytes: number) => string;
  // `projects/` del runtime propio de Mage (P-032, ficha D3), que no es de ninguna cuenta. Sus
  // conversaciones salen en el historial de TODAS, como las compartidas.
  readonly runtimeProjectsDir?: () => string;
}

// Lo derivado de un fichero, valido mientras no cambien su mtime ni su tamaño.
interface CachedMeta {
  readonly mtimeMs: number;
  readonly sizeBytes: number;
  readonly meta: ConversationMeta;
}

interface Root {
  readonly projectsDir: string;
  readonly configDir: string; // dir efectivo (cuenta o perfil privado)
  readonly privacy: ConversationPrivacy;
}

export class ConversationsService {
  // Cache por ruta: el sondeo del historial (cada 30 s) releia 64+64 KB de CADA transcripcion en el
  // hilo de main (160–190 ms con ~300 ficheros, medido). Con ella, un fichero que no cambio cuesta un
  // `stat` (~10 ms la lista entera, medido). ponytail: no se purgan las rutas borradas; son unos
  // cientos de bytes por conversacion y solo crece con transcripciones nuevas.
  private readonly metaCache = new Map<string, CachedMeta>();

  constructor(private readonly deps: ConversationsDeps) {}

  // Devuelve las conversaciones de la cuenta (compartidas + privadas), mas recientes primero, acotadas.
  listConversations(accountDir: string): ConversationSummary[] {
    const dir = accountDir.trim();
    if (dir.length === 0) {
      throw new Error(`accountDir vacio al listar conversaciones: ${JSON.stringify(accountDir)}`);
    }
    const roots: readonly Root[] = [
      { projectsDir: join(dir, 'projects'), configDir: dir, privacy: 'shared' },
      { projectsDir: join(dir, PRIVATE_PROFILE_DIR, 'projects'), configDir: join(dir, PRIVATE_PROFILE_DIR), privacy: 'private' },
      // `configDir` es la CUENTA que lista, no la raiz del runtime: la pestaña reabierta sigue bajo esa
      // cuenta y main encuentra el fichero por su id (`conversationTranscriptPath`).
      ...(this.deps.runtimeProjectsDir === undefined ? [] : [{ projectsDir: this.deps.runtimeProjectsDir(), configDir: dir, privacy: 'shared' as const }]),
    ];
    const all = roots.flatMap((root) => this.listRoot(root));
    all.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    return all.slice(0, MAX_CONVERSATIONS);
  }

  private listRoot(root: Root): ConversationSummary[] {
    if (!this.deps.exists(root.projectsDir)) return [];
    const result: ConversationSummary[] = [];
    for (const folder of this.deps.listDir(root.projectsDir)) {
      const folderPath = join(root.projectsDir, folder);
      if (!this.deps.isDirectory(folderPath)) continue;
      for (const file of this.deps.listDir(folderPath)) {
        if (!file.endsWith(JSONL_EXT)) continue; // subcarpeta <sessionId>/ (subagentes) -> se ignora
        const summary = this.describeFile(join(folderPath, file), file, root);
        if (summary !== null) result.push(summary);
      }
    }
    return result;
  }

  // Describe un .jsonl; null si el fichero desaparece/es ilegible entre el listado y la lectura, o si
  // no tiene ningun mensaje real del usuario.
  private describeFile(path: string, file: string, root: Root): ConversationSummary | null {
    const sessionId = file.slice(0, -JSONL_EXT.length);
    try {
      // UN solo `stat` para las dos cosas que se leen del fichero: cuando se modifico y cuanto pesa.
      const stat = this.deps.statFile(path);
      const meta = this.readMeta(path, stat);
      // D4: sin ningun mensaje real del usuario, la conversacion no existe para el historial. Solo se
      // decide si cabeza y cola cubren el fichero ENTERO: en uno mayor, el primer mensaje podria estar
      // en medio y esconderlo borraria del historial una conversacion de verdad.
      if (!meta.hasUserMessage && stat.sizeBytes <= PREFIX_BYTES + SUFFIX_BYTES) return null;
      return {
        sessionId,
        configDir: root.configDir,
        cwd: meta.cwd,
        title: meta.title.length > 0 ? meta.title : sessionId,
        privacy: root.privacy,
        updatedAtMs: stat.mtimeMs,
        sizeBytes: stat.sizeBytes,
        isScheduled: meta.isScheduled,
      };
    } catch {
      return null;
    }
  }

  // Meta del fichero: de la cache si mtime y tamaño no cambiaron; si no, se lee cabeza (y cola).
  private readMeta(path: string, stat: { readonly mtimeMs: number; readonly sizeBytes: number }): ConversationMeta {
    const cached = this.metaCache.get(path);
    if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.sizeBytes === stat.sizeBytes) return cached.meta;
    const head = this.deps.readPrefix(path, PREFIX_BYTES).split(/\r?\n/);
    // Un fichero que cabe entero en la cabeza no necesita cola (y leerla seria leerlo dos veces).
    const tail = stat.sizeBytes > PREFIX_BYTES ? this.deps.readSuffix(path, SUFFIX_BYTES).split(/\r?\n/) : [];
    const meta = deriveConversationMeta(head, tail);
    this.metaCache.set(path, { mtimeMs: stat.mtimeMs, sizeBytes: stat.sizeBytes, meta });
    return meta;
  }
}
