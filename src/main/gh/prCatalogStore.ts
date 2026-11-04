import { z } from 'zod';
import { parsePrKey, prKeyToString, type PrCatalogEntry, type PrCatalogLinkParams, type PrMigrateParams } from '@shared/pr';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';
import type { GitRemoteRef } from '../git/gitParse';

// Catalogo de PR (F5.5) en userData/pr-catalog.json: que conversaciones tienen vinculada cada PR, por su
// `PrKey` serializada. Cerrar una pestaña no lo toca; borrar la conversacion si (`forgetConversation`).
// El vinculo con PROYECTO no se guarda: se deriva de las conversaciones del proyecto.
//
// Una conversacion tiene como mucho UNA PR principal. Lectura tolerante (un fichero corrupto es un
// catalogo vacio y se avisa) pero un fallo de E/S (EACCES/EBUSY) lanza: caer a vacio y escribir encima
// borraria el catalogo real (mismo criterio que `ConversationIndexStore`, B9).

export const PR_CATALOG_VERSION = 1;

const FILE_SCHEMA = z.object({
  version: z.literal(PR_CATALOG_VERSION),
  entries: z.array(z.object({ key: z.string().min(1), links: z.array(z.object({ conversationId: z.string().min(1), primary: z.boolean() })) })),
});

export interface PrCatalogStoreDeps extends AtomicWriteDeps {
  readonly filePath: string;
  readonly log: (level: 'warn', message: string) => void;
}

export class PrCatalogStore {
  constructor(private readonly deps: PrCatalogStoreDeps) {}

  list(conversationId?: string): readonly PrCatalogEntry[] {
    const entries = this.read();
    if (conversationId === undefined) return entries;
    return entries.filter((entry) => entry.links.some((link) => link.conversationId === conversationId));
  }

  // Vincula una PR a una conversacion (idempotente). `primary: true` quita la marca a las demas PR de esa conversacion.
  link(params: PrCatalogLinkParams): void {
    const { key, conversationId, primary } = params;
    const parsed = parsePrKey(key);
    if (parsed === null) throw new Error(`Clave de PR no valida al vincular: ${JSON.stringify(key)}`);
    if (conversationId.length === 0) throw new Error(`conversationId vacio al vincular ${key}`);
    const normalized = prKeyToString(parsed);
    const entries = this.read().map((entry) => (primary ? unsetPrimary(entry, conversationId) : entry));
    const index = entries.findIndex((entry) => entry.key === normalized);
    const current = index === -1 ? { key: normalized, links: [] } : entries[index]!;
    const links = [...current.links.filter((l) => l.conversationId !== conversationId), { conversationId, primary }];
    this.write(index === -1 ? [...entries, { key: normalized, links }] : entries.map((entry, i) => (i === index ? { ...current, links } : entry)));
  }

  // Quita el vinculo; una entrada sin vinculos se borra.
  unlink(key: string, conversationId: string): void {
    const parsed = parsePrKey(key);
    if (parsed === null) throw new Error(`Clave de PR no valida al desvincular: ${JSON.stringify(key)}`);
    const normalized = prKeyToString(parsed);
    const next = this.read()
      .map((entry) => (entry.key === normalized ? withoutConversation(entry, conversationId) : entry))
      .filter((entry) => entry.links.length > 0);
    this.write(next);
  }

  // Borrar una conversacion quita todos sus vinculos.
  forgetConversation(conversationId: string): void {
    const entries = this.read();
    if (!entries.some((entry) => entry.links.some((link) => link.conversationId === conversationId))) return;
    this.write(entries.map((entry) => withoutConversation(entry, conversationId)).filter((entry) => entry.links.length > 0));
  }

  private read(): readonly PrCatalogEntry[] {
    if (!this.deps.exists(this.deps.filePath)) return [];
    const content = this.readContent();
    const result = FILE_SCHEMA.safeParse(parseJsonOrNull(content));
    if (result.success) return result.data.entries;
    this.deps.log('warn', `${this.deps.filePath} no es un catalogo de PR valido: se usa uno vacio`);
    return [];
  }

  private readContent(): string {
    try {
      return this.deps.readFile(this.deps.filePath);
    } catch (err) {
      throw new Error(`No se pudo leer ${this.deps.filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private write(entries: readonly PrCatalogEntry[]): void {
    writeAtomic(this.deps, this.deps.filePath, JSON.stringify({ version: PR_CATALOG_VERSION, entries }, null, 2));
  }
}

// Solo un JSON MAL FORMADO es «corrupto»; cualquier otro fallo es un bug y sube.
function parseJsonOrNull(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch (err) {
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

function unsetPrimary(entry: PrCatalogEntry, conversationId: string): PrCatalogEntry {
  return { ...entry, links: entry.links.map((link) => (link.conversationId === conversationId ? { ...link, primary: false } : link)) };
}

function withoutConversation(entry: PrCatalogEntry, conversationId: string): PrCatalogEntry {
  return { ...entry, links: entry.links.filter((link) => link.conversationId !== conversationId) };
}

export interface PrMigrationDeps {
  readonly remote: (cwd: string, accountDir: string) => Promise<GitRemoteRef | null>;
  readonly catalog: Pick<PrCatalogStore, 'link'>;
}

const GITHUB_HOST = 'github.com';

// Migra el numero que guardaba una pestaña: PR principal de esa conversacion, con el `host/owner/repo` del remoto
// de su carpeta AHORA. Sin remoto de GitHub no escribe nada y devuelve null. La pestaña conserva su `prNumber`.
export async function migrateTabPr(params: PrMigrateParams, deps: PrMigrationDeps): Promise<string | null> {
  const { cwd, accountDir, conversationId, number } = params;
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Numero de PR no valido al migrar: ${String(number)}`);
  const remote = await deps.remote(cwd, accountDir);
  if (remote === null || remote.host !== GITHUB_HOST) return null;
  const key = parsePrKey(`${remote.host}/${remote.owner}/${remote.repo}#${number}`);
  if (key === null) return null;
  const serialized = prKeyToString(key);
  deps.catalog.link({ key: serialized, conversationId, primary: true });
  return serialized;
}
