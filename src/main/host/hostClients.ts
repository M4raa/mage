import { z } from 'zod';
import { HOST_CLIENT_KINDS, type HostClientKind, type HostClientView } from '@shared/hostClients';
import type { SessionLogFn } from '../engine/agentSession';
import { createHostToken } from './hostToken';
import { findClientByToken, hashClientToken } from './hostAccess';

// Clientes emparejados del host local: `<userData>/host-clients.json`. Solo se guarda el SHA-256 de cada token, nunca
// el token (que se entrega una vez, al emparejar). Main es el único que escribe el fichero.

export const HOST_CLIENTS_FILE = 'host-clients.json';
const FILE_VERSION = 1;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const CLIENT_SCHEMA = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(HOST_CLIENT_KINDS),
  tokenHash: z.string().regex(SHA256_HEX),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
});
type ClientRecord = z.infer<typeof CLIENT_SCHEMA>;
const FILE_SCHEMA = z.object({ version: z.literal(FILE_VERSION), clients: z.array(z.unknown()) });

export interface HostClientStoreDeps {
  // Contenido del fichero, o null si no existe.
  readonly readFile: () => string | null;
  // Escritura atómica del fichero entero.
  readonly writeFile: (content: string) => void;
  readonly randomBytes: (size: number) => Buffer;
  readonly newId: () => string;
  // Fecha ISO UTC.
  readonly now: () => string;
  readonly log: SessionLogFn;
}

export interface PairedClient {
  readonly clientId: string;
  // Se entrega UNA vez: en disco solo queda su hash.
  readonly clientToken: string;
}

export class HostClientStore {
  private clients: ClientRecord[] | null = null;
  private readonly revokedListeners = new Map<string, Set<() => void>>();

  constructor(private readonly deps: HostClientStoreDeps) {}

  // Id del cliente con ese token, anotando su último uso; null si no hay ninguno.
  authenticate(clientToken: string): string | null {
    const client = findClientByToken(this.load(), clientToken);
    if (client === null) return null;
    client.lastUsedAt = this.deps.now();
    this.save();
    return client.id;
  }

  add(request: { readonly name: string; readonly kind: HostClientKind }): PairedClient {
    const clientToken = createHostToken({ randomBytes: this.deps.randomBytes });
    const record: ClientRecord = { id: this.deps.newId(), name: request.name, kind: request.kind, tokenHash: hashClientToken(clientToken), createdAt: this.deps.now(), lastUsedAt: null };
    this.load().push(record);
    this.save();
    return { clientId: record.id, clientToken };
  }

  // Sin hashes: es lo que ve la ventana.
  list(): readonly HostClientView[] {
    return this.load().map(({ id, name, kind, createdAt, lastUsedAt }) => ({ id, name, kind, createdAt, lastUsedAt }));
  }

  // Quita el cliente y avisa a sus conexiones abiertas para que se corten. Revocar uno que no existe no es un error
  // (otra ventana pudo revocarlo antes): devuelve false.
  revoke(clientId: string): boolean {
    const clients = this.load();
    const index = clients.findIndex((client) => client.id === clientId);
    if (index === -1) return false;
    clients.splice(index, 1);
    this.save();
    const listeners = [...(this.revokedListeners.get(clientId) ?? [])];
    this.revokedListeners.delete(clientId);
    for (const listener of listeners) listener();
    return true;
  }

  onRevoked(clientId: string, listener: () => void): () => void {
    const listeners = this.revokedListeners.get(clientId) ?? new Set<() => void>();
    listeners.add(listener);
    this.revokedListeners.set(clientId, listeners);
    return () => { listeners.delete(listener); };
  }

  private load(): ClientRecord[] {
    if (this.clients === null) this.clients = parseClients(this.deps.readFile(), this.deps.log);
    return this.clients;
  }

  private save(): void {
    const content = { version: FILE_VERSION, clients: this.load() };
    this.deps.writeFile(`${JSON.stringify(content, null, 2)}\n`);
  }
}

// Lectura tolerante: una entrada inválida se descarta (ese cliente tendrá que volver a emparejarse) y un fichero
// ilegible cuenta como vacío. Las dos cosas se trazan: nunca en silencio. Fallar hacia «sin clientes» es lo seguro.
export function parseClients(text: string | null, log: SessionLogFn): ClientRecord[] {
  if (text === null) return [];
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    log('warn', 'Fichero de clientes del host ilegible: se empieza sin clientes emparejados', { error: err instanceof Error ? err.message : String(err) });
    return [];
  }
  const file = FILE_SCHEMA.safeParse(json);
  if (!file.success) {
    log('warn', 'Fichero de clientes del host con forma inesperada: se empieza sin clientes emparejados', { issues: file.error.issues.length });
    return [];
  }
  const valid = file.data.clients.flatMap((entry) => {
    const parsed = CLIENT_SCHEMA.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  if (valid.length !== file.data.clients.length) log('warn', 'Se descartan clientes del host inválidos', { discarded: file.data.clients.length - valid.length });
  return valid;
}
