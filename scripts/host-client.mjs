// Cliente MÍNIMO del host local de Mage (F2.6). Sirve de prueba del protocolo (`pnpm verify:gui` lo lanza) y de
// ejemplo para la terminal (F7) y el MCP (F11): lee el endpoint y el token que el host deja en
// `<userData>/run/`, verifica al host con `host.challenge` (F7.1) y después se presenta con `hello`, lee la
// instantánea y se suscribe. Sin dependencias.
//
//   node scripts/host-client.mjs --user-data-dir <dir>                       # hello + lista de sesiones
//   node scripts/host-client.mjs --user-data-dir <dir> --session <id> --until result [--timeout 60000]
//
// Imprime UNA línea JSON por cada respuesta o evento (`{ "kind": "hello" | "list" | "snapshot" | "event" | ... }`)
// y sale con 0 si llegó al final, 1 si el host rechazó algo o venció el plazo. NUNCA imprime el token.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import { connectVerified } from './mage-cli/hostLink.mjs';

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

function connect(address) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

const linkDeps = {
  platform: process.platform,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  lstat: fs.lstatSync,
  getuid: process.getuid?.bind(process) ?? (() => -1),
  connect,
  randomBytes,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { rpc, socket, hello } = await connectVerified({ userDataDir: args.userDataDir, clientVersion: 'host-client', deps: linkDeps });
  let finished = null;
  const finish = (code) => { if (finished === null) { finished = code; socket.end(); } };
  const timer = setTimeout(() => { print({ kind: 'timeout', ms: args.timeoutMs }); finish(1); }, args.timeoutMs);
  rpc.onNotification((method, event) => {
    if (method !== 'event') return;
    print({ kind: 'event', ...event });
    if (args.until !== null && event.event?.kind === args.until) finish(0);
  });
  print({ kind: 'hello', protocol: hello.protocol, hostVersion: hello.hostVersion });
  const list = await rpc.call('sessions.list');
  print({ kind: 'list', sessions: list.sessions });
  if (args.session === null) { finish(0); } else {
    const subscribed = await rpc.call('session.subscribe', { sessionId: args.session });
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
