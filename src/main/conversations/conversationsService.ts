import { join } from 'node:path';
import type { ConversationSummary } from '@shared/conversations';
import type { ConversationPrivacy } from '@shared/state';
import { deriveConversationMeta } from './conversationMeta';

// Lista las conversaciones EN DISCO de una cuenta para el sidebar-historial (M2.6): las compartidas
// (pozo comun, `<cuenta>/projects`) y las privadas (`<cuenta>/mage-private/projects`). Solo FS con DI
// -> testable. Lectura TOLERANTE por fichero (un .jsonl corrupto/desaparecido no aborta la lista; es
// una vista de historial, no un dato critico). No lee el contenido completo: un prefijo basta para
// cwd/titulo.

const PRIVATE_PROFILE_DIR = 'mage-private';
const JSONL_EXT = '.jsonl';
const PREFIX_BYTES = 64 * 1024; // prefijo por fichero para derivar cwd/titulo (cwd y 1er prompt van arriba)
const MAX_CONVERSATIONS = 300; // tope del payload: las mas recientes (evita listas gigantes)

export interface ConversationsDeps {
  readonly exists: (path: string) => boolean;
  readonly listDir: (path: string) => string[];
  readonly isDirectory: (path: string) => boolean;
  // UN solo stat para mtime y tamaño: eran dos llamadas al FS por cada conversacion del historial.
  readonly statFile: (path: string) => { readonly mtimeMs: number; readonly sizeBytes: number };
  readonly readPrefix: (path: string, maxBytes: number) => string;
}

interface Root {
  readonly projectsDir: string;
  readonly configDir: string; // dir efectivo (cuenta o perfil privado)
  readonly privacy: ConversationPrivacy;
}

export class ConversationsService {
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

  // Describe un .jsonl; null si el fichero desaparece/es ilegible entre el listado y la lectura.
  private describeFile(path: string, file: string, root: Root): ConversationSummary | null {
    const sessionId = file.slice(0, -JSONL_EXT.length);
    try {
      // UN solo `stat` para las dos cosas que se leen del fichero: cuando se modifico y cuanto pesa.
      const stat = this.deps.statFile(path);
      const meta = deriveConversationMeta(this.deps.readPrefix(path, PREFIX_BYTES).split(/\r?\n/));
      return {
        sessionId,
        configDir: root.configDir,
        cwd: meta.cwd,
        title: meta.title.length > 0 ? meta.title : sessionId,
        privacy: root.privacy,
        updatedAtMs: stat.mtimeMs,
        sizeBytes: stat.sizeBytes,
      };
    } catch {
      return null;
    }
  }
}
