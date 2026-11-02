import { createHash } from 'node:crypto';
import { posix, win32 } from 'node:path';
import { localized, UserFacingError } from '@shared/i18n/localizedText';

// Dónde escucha el host local (F2.6, H6 de la devolución 13). Windows: named pipe. Linux y macOS: socket Unix en
// `$XDG_RUNTIME_DIR/mage/<hash>.sock` o, sin esa variable, en `<userData>/run/`. La ruta de un socket Unix tiene
// un tope de ~104 bytes (macOS) a ~108 (Linux): se valida aquí con un error claro en vez de dejar que `listen`
// falle con un `EINVAL` que no dice nada.

const HASH_HEX_CHARS = 12;
const PROTOCOL_SUFFIX = 'v1';
// sun_path mide 104 bytes en macOS y 108 en Linux, y lleva el NUL final: 103 es lo que cabe en los dos.
export const MAX_UNIX_SOCKET_PATH_BYTES = 103;
export const RUN_DIR_NAME = 'run';
export const TOKEN_FILE_NAME = 'host-token';
// Dónde escucha el host, para que un cliente local lo encuentre sin recalcular el hash (no es secreto).
export const ENDPOINT_FILE_NAME = 'host-endpoint';
// Con qué modo arrancó el host (`gui` o `headless`): lo lee la segunda instancia que pierde el lock para decir la
// verdad a quien pidió la interfaz gráfica (§3.4). Tampoco es secreto.
export const MODE_FILE_NAME = 'host-mode';

export interface HostEndpoint {
  readonly kind: 'pipe' | 'unix';
  // Lo que se pasa a `net.Server.listen`.
  readonly address: string;
  // Directorio que hay que crear con 0700 (solo Unix); null en Windows.
  readonly directory: string | null;
}

export interface HostEndpointDeps {
  readonly platform: NodeJS.Platform;
  readonly userDataDir: string;
  readonly xdgRuntimeDir: string | undefined;
}

// Identifica el perfil sin revelar su ruta: dos perfiles (instalada, dev, otro `--user-data-dir`) no comparten host.
export function profileHash(userDataDir: string, platform: NodeJS.Platform): string {
  if (userDataDir.length === 0) throw new Error('El directorio de datos del perfil está vacío');
  // Windows no distingue mayúsculas: el mismo perfil escrito de dos maneras tiene que dar el mismo host.
  const normalized = platform === 'win32' ? userDataDir.toLowerCase() : userDataDir;
  return createHash('sha256').update(normalized).digest('hex').slice(0, HASH_HEX_CHARS);
}

// La plataforma que se inyecta decide también el separador de rutas (así se prueba Linux desde Windows).
const pathFor = (platform: NodeJS.Platform): typeof posix => (platform === 'win32' ? win32 : posix);

export function resolveHostEndpoint(deps: HostEndpointDeps): HostEndpoint {
  const { join } = pathFor(deps.platform);
  const hash = profileHash(deps.userDataDir, deps.platform);
  if (deps.platform === 'win32') return { kind: 'pipe', address: `\\\\.\\pipe\\mage-${hash}-${PROTOCOL_SUFFIX}`, directory: null };
  const base = deps.xdgRuntimeDir !== undefined && deps.xdgRuntimeDir.length > 0
    ? join(deps.xdgRuntimeDir, 'mage')
    : join(deps.userDataDir, RUN_DIR_NAME);
  const address = join(base, `${hash}.sock`);
  const bytes = Buffer.byteLength(address, 'utf8');
  if (bytes > MAX_UNIX_SOCKET_PATH_BYTES) {
    throw new UserFacingError(localized('errors.host.socketPathTooLong', { bytes: String(bytes), max: String(MAX_UNIX_SOCKET_PATH_BYTES), address }));
  }
  return { kind: 'unix', address, directory: base };
}

// Fichero del token: `<userData>/run/host-token`, en un directorio que solo puede abrir el usuario.
export function tokenFilePath(deps: HostEndpointDeps): string {
  return pathFor(deps.platform).join(deps.userDataDir, RUN_DIR_NAME, TOKEN_FILE_NAME);
}

export function modeFilePath(deps: HostEndpointDeps): string {
  return pathFor(deps.platform).join(deps.userDataDir, RUN_DIR_NAME, MODE_FILE_NAME);
}

export function endpointFilePath(deps: HostEndpointDeps): string {
  return pathFor(deps.platform).join(deps.userDataDir, RUN_DIR_NAME, ENDPOINT_FILE_NAME);
}
