// Enlace verificado del cliente de terminal con el host de Mage (F7.1): antes de enviar el `hello` o el token, el
// cliente comprueba que quien escucha en el pipe o el socket ES el host, con un reto HMAC-SHA256 del token
// (`host.challenge`). Sin dependencias: solo `node:*`, porque lo ejecutará el Electron de la app en modo Node
// (`ELECTRON_RUN_AS_NODE`) y el asar no lleva `node_modules`. Toda la E/S llega por `deps` (inyección).
// Las constantes duplicadas del servidor (protocolo, contexto y tamaño del nonce) las vigila `hostLink.test.mjs`.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { posix, win32 } from 'node:path';

export const HOST_PROTOCOL = '1.6';
export const CHALLENGE_CONTEXT = 'mage-host-challenge-v1:';
export const CHALLENGE_NONCE_BYTES = 32;
export const NOT_MAGE_SERVER = 'El servidor del pipe no es el de Mage';

const PROOF_PATTERN = /^[0-9a-f]{64}$/;
// Bits de grupo y de otros: un socket o directorio privado no tiene ninguno.
const GROUP_AND_OTHERS_MASK = 0o077;
const PERMISSION_BITS_MASK = 0o777;

// Igual que `challengeProof` del servidor.
export function computeProof(token, nonce) {
  if (token.length === 0) throw new Error('El token del host está vacío: no se puede responder al reto');
  return createHmac('sha256', token).update(`${CHALLENGE_CONTEXT}${nonce}`, 'utf8').digest('hex');
}

export function hostFilePaths(userDataDir, platform) {
  const { join } = platform === 'win32' ? win32 : posix;
  return {
    endpointFile: join(userDataDir, 'run', 'host-endpoint'),
    tokenFile: join(userDataDir, 'run', 'host-token'),
  };
}

function readTrimmed(file, readFile) {
  let text;
  try {
    text = readFile(file);
  } catch (cause) {
    if (cause?.code === 'ENOENT') throw new Error(`No hay un Mage escuchando con este perfil: falta ${file}`, { cause });
    throw cause;
  }
  const value = text.trim();
  if (value.length === 0) throw new Error(`Fichero del host vacío: ${file}`);
  return value;
}

// Nunca pone el contenido del token en un mensaje.
export function readHostFiles(userDataDir, deps) {
  const { endpointFile, tokenFile } = hostFilePaths(userDataDir, deps.platform);
  return {
    address: readTrimmed(endpointFile, deps.readFile),
    token: readTrimmed(tokenFile, deps.readFile),
  };
}

function assertPrivate(stat, { what, path, isExpectedType, getuid }) {
  const owner = getuid();
  if (isExpectedType(stat) && stat.uid === owner && (stat.mode & GROUP_AND_OTHERS_MASK) === 0) return;
  const mode = (stat.mode & PERMISSION_BITS_MASK).toString(8);
  throw new Error(`El ${what} del host no es privado (${path}: modo ${mode}, dueño ${stat.uid}, se esperaba solo el usuario ${owner}): no se envía el token`);
}

// En Unix, el directorio y el socket tienen que ser del usuario y sin acceso para grupo ni otros. En Windows la
// defensa es el reto.
export function verifyUnixEndpoint(address, deps) {
  if (deps.platform === 'win32') return;
  const { getuid } = deps;
  const directory = posix.dirname(address);
  assertPrivate(deps.lstat(directory), { what: 'directorio', path: directory, isExpectedType: (s) => s.isDirectory(), getuid });
  assertPrivate(deps.lstat(address), { what: 'socket', path: address, isExpectedType: (s) => s.isSocket(), getuid });
}

// Cliente JSON-RPC sobre NDJSON. `socket`: write(text), destroy(), on('data'|'close'|'error', fn).
export function createRpc(socket) {
  const pending = new Map();
  const listeners = [];
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let nextId = 0;

  const rejectAll = (error) => {
    const settles = [...pending.values()];
    pending.clear();
    for (const settle of settles) settle.reject(error);
  };

  const handleMessage = (message) => {
    if (typeof message.method === 'string') {
      for (const listener of listeners) listener(message.method, message.params);
      return;
    }
    if (message.id === null && message.error !== undefined) {
      rejectAll(Object.assign(new Error(message.error.message), { code: message.error.code }));
      return;
    }
    const settle = pending.get(message.id);
    if (settle === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) settle.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
    else settle.resolve(message.result);
  };

  const handleLine = (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch (cause) {
      socket.destroy();
      rejectAll(new Error('Respuesta del host ilegible', { cause }));
      return false;
    }
    handleMessage(message);
    return true;
  };

  socket.on('data', (chunk) => {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length === 0) continue;
      if (!handleLine(line)) return;
    }
  });
  const onEnd = () => rejectAll(new Error('El host cerró la conexión'));
  socket.on('close', onEnd);
  socket.on('error', onEnd);

  return {
    call(method, params) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        const request = params === undefined ? { jsonrpc: '2.0', id, method } : { jsonrpc: '2.0', id, method, params };
        socket.write(`${JSON.stringify(request)}\n`);
      });
    },
    // Notificación JSON-RPC: sin `id`, el host no contesta.
    notify(method, params) {
      socket.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
    },
    onNotification(listener) {
      listeners.push(listener);
    },
    close() {
      if (typeof socket.end === 'function') socket.end();
      else socket.destroy();
    },
  };
}

function proofMatches(result, token, nonce) {
  const proof = result?.proof;
  if (typeof proof !== 'string' || !PROOF_PATTERN.test(proof)) return false;
  const received = Buffer.from(proof, 'hex');
  const expected = Buffer.from(computeProof(token, nonce), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

// Reto al host ANTES de enviarle nada secreto: si no devuelve la prueba del token, no es el de Mage.
export async function verifyServer(rpc, token, randomBytes) {
  const nonce = randomBytes(CHALLENGE_NONCE_BYTES).toString('hex');
  let result;
  try {
    result = await rpc.call('host.challenge', { nonce });
  } catch (cause) {
    throw new Error(NOT_MAGE_SERVER, { cause });
  }
  if (!proofMatches(result, token, nonce)) throw new Error(NOT_MAGE_SERVER);
}

const CALLER_PATTERN = /^[0-9a-f]{64}$/;

// `client.caller` (la credencial MAGE_MCP_CALLER) solo viaja si tiene la forma esperada; nunca se escribe en un mensaje.
function helloClient(client, clientVersion) {
  const caller = typeof client.caller === 'string' && CALLER_PATTERN.test(client.caller) ? { caller: client.caller } : {};
  return { client: { kind: client.kind, version: clientVersion }, ...caller };
}

// El host 1.6 entiende `client.setLanguage`; a uno anterior no se le manda (su `hello` y sus métodos son estrictos).
export function supportsClientLanguage(protocol) {
  if (typeof protocol !== 'string') return false;
  const match = /^(\d+)\.(\d+)$/.exec(protocol);
  return match !== null && Number(match[1]) === 1 && Number(match[2]) >= 6;
}

export async function connectVerified({ userDataDir, clientVersion, deps, client = { kind: 'terminal' }, language }) {
  const { address, token } = readHostFiles(userDataDir, deps);
  verifyUnixEndpoint(address, deps);
  const socket = await deps.connect(address);
  const rpc = createRpc(socket);
  try {
    await verifyServer(rpc, token, deps.randomBytes);
  } catch (error) {
    socket.destroy();
    throw error;
  }
  const hello = await rpc.call('hello', { protocol: HOST_PROTOCOL, ...helloClient(client, clientVersion), token });
  if (language !== undefined && supportsClientLanguage(hello.protocol)) await setLanguage(rpc, socket, language);
  return { rpc, socket, hello };
}

async function setLanguage(rpc, socket, language) {
  try {
    await rpc.call('client.setLanguage', { language });
  } catch (error) {
    socket.destroy();
    throw error;
  }
}
