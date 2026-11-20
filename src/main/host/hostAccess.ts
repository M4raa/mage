import { createHash, timingSafeEqual } from 'node:crypto';
import type { HostMethod } from './hostProtocol';

// Qué deja hacer cada credencial del host local. Puro.
//
// - `read`: el token de arranque (el del fichero, nuevo en cada arranque). Cualquier proceso del usuario puede leer
//   ese fichero, así que solo deja saludar, leer y pedir el emparejamiento.
// - `tunnel`: el token de arranque MÁS la credencial MAGE_MCP_CALLER de una sesión viva de Mage, que solo recibe el
//   hijo de esa sesión (nunca está en disco). Deja, además, el túnel MCP: las herramientas de delegación y del
//   navegador aplican ahí su propio alcance (la cadena de creadoras, la profundidad, las cuentas). NO deja los
//   métodos de escritura sueltos, que se saltarían ese alcance.
// - `full`: un cliente emparejado (el usuario lo autorizó en la ventana). Todo.
export type HostAccess = 'read' | 'tunnel' | 'full';

type MethodClass = 'read' | 'tunnel' | 'write';

// Criterio de `read`: no cambia nada en Mage ni gasta uso. Un método nuevo no compila sin su fila.
// - `client.setLanguage` solo cambia el idioma de los errores de ESTA conexión.
// - `session.resume` hoy solo busca una sesión VIVA; si algún día lanzara una cerrada, pasa a `write`.
// - `session.rewindPoints` y `session.rewindPlan` calculan sin aplicar (el que aplica es `session.rewind`).
const METHOD_CLASS: Readonly<Record<HostMethod, MethodClass>> = {
  'sessions.list': 'read',
  'session.snapshot': 'read',
  'session.subscribe': 'read',
  'session.unsubscribe': 'read',
  'host.info': 'read',
  'projects.list': 'read',
  'accounts.list': 'read',
  'session.resume': 'read',
  'session.rewindPoints': 'read',
  'session.rewindPlan': 'read',
  'client.setLanguage': 'read',
  'mcp.message': 'tunnel',
  'session.send': 'write',
  'session.interrupt': 'write',
  'session.answerPermission': 'write',
  'session.answerElicitation': 'write',
  'session.create': 'write',
  'session.setOption': 'write',
  'session.rewind': 'write',
  'session.cancelQueued': 'write',
  'session.updateQueued': 'write',
  'host.stop': 'write',
  'accounts.create': 'write',
};

const ALLOWED: Readonly<Record<HostAccess, ReadonlySet<MethodClass>>> = {
  read: new Set<MethodClass>(['read']),
  tunnel: new Set<MethodClass>(['read', 'tunnel']),
  full: new Set<MethodClass>(['read', 'tunnel', 'write']),
};

export function isMethodAllowed(access: HostAccess, method: HostMethod): boolean {
  return ALLOWED[access].has(METHOD_CLASS[method]);
}

// Los métodos que admite el token de arranque solo, para documentarlos y probarlos.
export function readOnlyMethods(): readonly HostMethod[] {
  return (Object.keys(METHOD_CLASS) as HostMethod[]).filter((method) => METHOD_CLASS[method] === 'read');
}

export interface AccessInput {
  readonly clientKind: 'terminal' | 'mcp' | 'widget';
  // Id del cliente emparejado cuyo token presentó, o null.
  readonly pairedClientId: string | null;
  // La credencial MAGE_MCP_CALLER que presentó es de una sesión viva de Mage.
  readonly liveMageCaller: boolean;
}

// La credencial de llamante solo cuenta para un cliente `mcp`: es lo único que la usa (el relevo `mage mcp`).
export function accessFor(input: AccessInput): HostAccess {
  if (input.pairedClientId !== null) return 'full';
  if (input.clientKind === 'mcp' && input.liveMageCaller) return 'tunnel';
  return 'read';
}

// Tokens de cliente: se guarda solo su SHA-256 (hex). Un token de cliente tiene el mismo formato que el de arranque.
export const CLIENT_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function hashClientToken(token: string): string {
  if (token.length === 0) throw new Error('El token de cliente está vacío: no se puede calcular su hash');
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface StoredClientHash {
  readonly id: string;
  readonly tokenHash: string;
}

// El cliente cuyo hash coincide, comparando en tiempo constante. Recorre TODOS (no corta al encontrarlo) para que el
// tiempo no diga en qué posición está. Un hash guardado con otra forma no coincide nunca.
export function findClientByToken<T extends StoredClientHash>(clients: readonly T[], token: string): T | null {
  if (!CLIENT_TOKEN_PATTERN.test(token)) return null;
  const received = Buffer.from(hashClientToken(token), 'hex');
  let found: T | null = null;
  for (const client of clients) {
    const stored = Buffer.from(client.tokenHash, 'hex');
    const equal = stored.length === received.length && timingSafeEqual(stored, received);
    if (equal && found === null) found = client;
  }
  return found;
}
