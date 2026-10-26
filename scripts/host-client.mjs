// Cliente MÍNIMO del host local de Mage (F2.6). Sirve de prueba del protocolo (`pnpm verify:gui` lo lanza) y de
// ejemplo para la terminal (F7) y el MCP (F11): lee el endpoint y el token que el host deja en
// `<userData>/run/`, se presenta con `hello`, lee la instantánea y se suscribe. Sin dependencias.
//
//   node scripts/host-client.mjs --user-data-dir <dir>                       # hello + lista de sesiones
//   node scripts/host-client.mjs --user-data-dir <dir> --session <id> --until result [--timeout 60000]
//
// Imprime UNA línea JSON por cada respuesta o evento (`{ "kind": "hello" | "list" | "snapshot" | "event" | ... }`)
// y sale con 0 si llegó al final, 1 si el host rechazó algo o venció el plazo. NUNCA imprime el token.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const PROTOCOL = '1.0';
const DEFAULT_TIMEOUT_MS = 60_000;

function parseArgs(argv) {
  const args = { userDataDir: null, session: null, until: null, timeoutMs: DEFAULT_TIMEOUT_MS };
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`Falta el valor de ${flag}`);
    if (flag === '--user-data-dir') args.userDataDir = value;
    else if (flag === '--session') args.session = value;
    else if (flag === '--until') args.until = value;
    else if (flag === '--timeout') args.timeoutMs = Number(value);
    else throw new Error(`Argumento desconocido: ${flag}`);
  }
  if (args.userDataDir === null) throw new Error('Falta --user-data-dir');
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0) throw new Error(`--timeout inválido: ${String(args.timeoutMs)}`);
  return args;
}

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

function readHostFiles(userDataDir) {
  const run = path.join(userDataDir, 'run');
  return {
    address: fs.readFileSync(path.join(run, 'host-endpoint'), 'utf8').trim(),
    token: fs.readFileSync(path.join(run, 'host-token'), 'utf8').trim(),
  };
}

function connect(address) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

// Peticiones con id: la respuesta se asocia por id; las notificaciones (`event`) van a `onEvent`.
function createRpc(socket, onEvent) {
  const pending = new Map();
  let nextId = 0;
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines.filter((l) => l.length > 0)) dispatch(JSON.parse(line));
  });
  const dispatch = (message) => {
    if (message.method === 'event') return onEvent(message.params);
    const settle = pending.get(message.id);
    if (settle === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) settle.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else settle.resolve(message.result);
  };
  socket.on('close', () => { for (const settle of pending.values()) settle.reject(new Error('El host cerró la conexión')); pending.clear(); });
  return (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { address, token } = readHostFiles(args.userDataDir);
  const socket = await connect(address);
  let finished = null;
  const finish = (code) => { if (finished === null) { finished = code; socket.end(); } };
  const timer = setTimeout(() => { print({ kind: 'timeout', ms: args.timeoutMs }); finish(1); }, args.timeoutMs);
  const call = createRpc(socket, (event) => {
    print({ kind: 'event', ...event });
    if (args.until !== null && event.event?.kind === args.until) finish(0);
  });
  const hello = await call('hello', { protocol: PROTOCOL, client: { kind: 'terminal', version: 'host-client' }, token });
  print({ kind: 'hello', protocol: hello.protocol, hostVersion: hello.hostVersion });
  const list = await call('sessions.list', undefined);
  print({ kind: 'list', sessions: list.sessions });
  if (args.session === null) { finish(0); } else {
    const subscribed = await call('session.subscribe', { sessionId: args.session });
    print({ kind: 'snapshot', subscriptionId: subscribed.subscriptionId, snapshot: subscribed.snapshot });
    if (args.until === null) finish(0);
  }
  await new Promise((resolve) => socket.once('close', resolve));
  clearTimeout(timer);
  process.exit(finished ?? 1);
}

main().catch((err) => {
  print({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
