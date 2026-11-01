import net from 'node:net';
import { dirname } from 'node:path';
import type { Stats } from 'node:fs';
import { localized, localizedFromError, localizedWithParts, UserFacingError } from '@shared/i18n/localizedText';
import { HostConnection, type HostConnectionDeps } from './hostConnection';
import type { HostEndpoint } from './hostEndpoint';
import { TOKEN_FILE_MODE } from './hostToken';

// Servidor del host local (F2.6): el pegamento entre `net` y las conexiones. Transporte privado: named pipe en
// Windows, socket Unix en 0600 dentro de un directorio 0700 en Linux y macOS. La autenticación de verdad es el
// token (rotado en cada arranque, en un fichero que solo lee el usuario); el transporte solo reduce quién llega.
//
// LÍMITE DECLARADO (Windows, H6 de la devolución 13): Node no deja fijar el DACL de un named pipe. El de libuv es
// el predeterminado del proceso (SYSTEM, administradores y el usuario con control total; lectura para el resto),
// así que otro usuario local podría ABRIR el pipe. No puede hacer nada sin el token, que es obligatorio en el
// primer mensaje. No se ha probado con un segundo usuario de Windows (esta máquina solo tiene uno); no se añade
// ninguna dependencia nativa para cerrarlo.

export type HostMode = 'gui' | 'headless';

export const PRIVATE_DIR_MODE = 0o700;
export const SOCKET_MODE = 0o600;
const PERMISSION_BITS = 0o777;

// Lo que necesita del sistema de ficheros (`node:fs` en producción).
export interface HostFs {
  mkdirSync(path: string, options: { recursive: true; mode: number }): void;
  chmodSync(path: string, mode: number): void;
  statSync(path: string): Pick<Stats, 'mode' | 'uid' | 'isDirectory'>;
  writeFileSync(path: string, data: string, options: { mode: number }): void;
  rmSync(path: string, options: { force: true }): void;
}

export interface HostServerDeps {
  readonly endpoint: HostEndpoint;
  readonly platform: NodeJS.Platform;
  readonly tokenFile: string;
  // Fichero con la dirección del host (la ruta del socket o el nombre del pipe) para los clientes locales.
  readonly endpointFile: string;
  // Con qué modo arrancó este host y dónde se deja dicho.
  readonly modeFile: string;
  readonly mode: HostMode;
  readonly token: string;
  readonly fs: HostFs;
  // `process.getuid`: ausente en Windows.
  readonly getuid: (() => number) | undefined;
  readonly connection: Omit<HostConnectionDeps, 'token'>;
}

export interface HostServerHandle {
  readonly endpoint: HostEndpoint;
  close(): Promise<void>;
  // Solo los ficheros (token, dirección y socket), síncrono: para `before-quit`, que no espera.
  closeFilesSync(): void;
}

export async function startHostServer(deps: HostServerDeps): Promise<HostServerHandle> {
  prepareDirectories(deps);
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => attach(socket, sockets, deps));
  try {
    writeFiles(deps);
    await listen(server, deps.endpoint);
    if (deps.endpoint.kind === 'unix') deps.fs.chmodSync(deps.endpoint.address, SOCKET_MODE);
  } catch (err) {
    // Un host que no escucha no deja token, dirección ni modo en disco (H2 de la devolución 16).
    server.close();
    removeFilesKeepingCause(deps, err);
    throw err;
  }
  return { endpoint: deps.endpoint, close: () => closeServer(server, sockets, deps), closeFilesSync: () => removeFiles(deps) };
}

// Directorios privados y socket viejo fuera. La instancia única del perfil garantiza que un socket que ya exista
// es de una ejecución anterior que cayó sin limpiar.
function prepareDirectories(deps: HostServerDeps): void {
  const { endpoint, fs } = deps;
  const directories = [dirname(deps.tokenFile), dirname(deps.endpointFile), dirname(deps.modeFile), ...(endpoint.directory === null ? [] : [endpoint.directory])];
  for (const directory of new Set(directories)) ensurePrivateDirectory(directory, deps);
  if (endpoint.kind === 'unix') fs.rmSync(endpoint.address, { force: true });
}

// Token nuevo, dirección y modo, solo legibles por el usuario.
function writeFiles(deps: HostServerDeps): void {
  const { endpoint, fs } = deps;
  for (const [file, content] of [[deps.tokenFile, deps.token], [deps.endpointFile, endpoint.address], [deps.modeFile, deps.mode]] as const) {
    fs.writeFileSync(file, content, { mode: TOKEN_FILE_MODE });
    if (deps.platform !== 'win32') fs.chmodSync(file, TOKEN_FILE_MODE);
  }
}

// En Windows el directorio hereda la ACL del perfil del usuario (userData); en Unix se exige 0700 y que sea del
// usuario actual, y se corrige el modo si lo permite (un directorio propio con modo ancho).
function ensurePrivateDirectory(directory: string, deps: HostServerDeps): void {
  deps.fs.mkdirSync(directory, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (deps.platform === 'win32') return;
  deps.fs.chmodSync(directory, PRIVATE_DIR_MODE);
  const stat = deps.fs.statSync(directory);
  const mode = stat.mode & PERMISSION_BITS;
  const uid = deps.getuid?.();
  if (!stat.isDirectory() || mode !== PRIVATE_DIR_MODE || (uid !== undefined && stat.uid !== uid)) {
    throw new UserFacingError(localized('errors.host.directoryNotPrivate', { mode: mode.toString(8), owner: String(stat.uid), user: String(uid), directory }));
  }
}

function attach(socket: net.Socket, sockets: Set<net.Socket>, deps: HostServerDeps): void {
  sockets.add(socket);
  const connection = new HostConnection(
    { write: (data) => { socket.write(data); }, end: () => { socket.end(); }, bufferedBytes: () => socket.writableLength },
    { ...deps.connection, token: deps.token },
  );
  socket.on('data', (chunk: Buffer) => connection.receive(chunk));
  socket.on('error', (err) => {
    deps.connection.log('warn', 'Error en una conexión del host', { error: err.message });
    connection.closed();
  });
  socket.on('close', () => {
    sockets.delete(socket);
    connection.closed();
  });
}

function listen(server: net.Server, endpoint: HostEndpoint): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Explícito aunque sea el valor por defecto: el pipe no se abre a todos los usuarios.
    server.listen({ path: endpoint.address, readableAll: false, writableAll: false }, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

// Los ficheros salen del disco ANTES de cerrar y de forma síncrona: si el proceso acaba sin esperar al callback
// del cierre, ni el token ni el socket sobreviven.
function closeServer(server: net.Server, sockets: Set<net.Socket>, deps: HostServerDeps): Promise<void> {
  removeFiles(deps);
  return new Promise((resolve, reject) => {
    for (const socket of sockets) socket.destroy();
    server.close((err) => (err === undefined ? resolve() : reject(err)));
  });
}

// Limpieza tras un arranque fallido: si además falla la limpieza, el error lleva las dos causas.
function removeFilesKeepingCause(deps: HostServerDeps, cause: unknown): void {
  try {
    removeFiles(deps);
  } catch (cleanupErr) {
    const text = localizedWithParts('errors.host.startFailedCleanup', {}, { reason: localizedFromError(cause), detail: localizedFromError(cleanupErr) });
    throw new UserFacingError(text);
  }
}

function removeFiles(deps: HostServerDeps): void {
  if (deps.endpoint.kind === 'unix') deps.fs.rmSync(deps.endpoint.address, { force: true });
  deps.fs.rmSync(deps.tokenFile, { force: true });
  deps.fs.rmSync(deps.endpointFile, { force: true });
  deps.fs.rmSync(deps.modeFile, { force: true });
}
