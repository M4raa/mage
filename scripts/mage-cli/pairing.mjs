// Emparejamiento de la terminal con Mage (host 1.8). El token de arranque solo deja leer: para crear, enviar o parar,
// la terminal necesita su propio token, que da Mage una vez, cuando el usuario la autoriza en la ventana. Se guarda en
// `<datos de Mage>/run/client-token` (solo lo lee el usuario) y se presenta en cada `hello`. Sin dependencias: solo
// `node:*`; la E/S llega por parámetro.
import { posix, win32 } from 'node:path';

export const CLIENT_TOKEN_FILE = 'client-token';
export const CLIENT_TOKEN_MODE = 0o600;
// Mismos códigos que `HostErrorCode` del servidor (lo vigila `pairing.test.mjs`).
export const NOT_PAIRED_CODE = -32013;
export const PAIRING_REFUSED_CODE = -32014;
export const TERMINAL_CLIENT_NAME = 'mage';
const CLIENT_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function clientTokenPath(userDataDir, platform) {
  const { join } = platform === 'win32' ? win32 : posix;
  return join(userDataDir, 'run', CLIENT_TOKEN_FILE);
}

// El token guardado, o undefined si no hay (o no tiene la forma de un token: se vuelve a emparejar y se sobrescribe).
// Nunca pone el contenido en un mensaje.
export function readClientToken(file, readFile) {
  let text;
  try {
    text = readFile(file);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return undefined;
    throw cause;
  }
  const token = text.trim();
  return CLIENT_TOKEN_PATTERN.test(token) ? token : undefined;
}

// En Unix el modo se fija también tras escribir: `writeFile` no cambia el de un fichero que ya existía.
export function saveClientToken(file, token, { writeFile, chmod, platform }) {
  writeFile(file, token, { mode: CLIENT_TOKEN_MODE });
  if (platform !== 'win32') chmod(file, CLIENT_TOKEN_MODE);
}

// Un host anterior a 1.8 no dice `access`: no conoce el emparejamiento y deja hacer todo.
function needsPairing(hello) {
  return hello.access !== undefined && hello.access !== 'full';
}

function notPairedError(messages) {
  return Object.assign(new Error(messages.notPairedLocal()), { code: NOT_PAIRED_CODE });
}

// Con el enlace ya presentado: si no tiene acceso completo, pide emparejar (si se permite) y guarda el token. Un
// rechazo, el plazo vencido o un Mage sin ventana llegan como error del host con su mensaje.
export async function ensurePaired({ link, allowPairing, saveToken, say, messages }) {
  if (!needsPairing(link.hello)) return link;
  if (!allowPairing) throw notPairedError(messages);
  say(messages.pairingAsk());
  const { clientToken } = await link.rpc.call('host.pair', { clientName: TERMINAL_CLIENT_NAME, clientKind: 'terminal' });
  if (typeof clientToken !== 'string' || !CLIENT_TOKEN_PATTERN.test(clientToken)) throw new Error('El host devolvió un token de cliente con una forma inesperada');
  saveToken(clientToken);
  say(messages.pairingDone());
  return link;
}

export function isNotPairedError(error) {
  return error?.code === NOT_PAIRED_CODE || error?.code === PAIRING_REFUSED_CODE;
}
