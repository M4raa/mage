// Spike del impostor (F7.1). Se ESCRIBE para el punto de control; no se ejecuta en el carril. Sin dependencias.
//
//   node scripts/mage-cli/spikes/impostor-spike.mjs --scenarios --user-data-dir <dir-desechable>
//   node scripts/mage-cli/spikes/impostor-spike.mjs --occupy-profile <userDataDir>
//
// REGLA: el impostor CIERRA cada conexión tras responder (la sonda de la 026 falló porque no lo hacía).
//
// --scenarios: para `wrong-proof`, `error-reply` y `silent-close` levanta un impostor con un `host-token` «olvidado»
//   en `<dir>/run/`, llama a `connectVerified` y comprueba que rechaza con NOT_MAGE_SERVER sin haber enviado el
//   token ni `hello`. Una línea JSON por escenario; sale con 0 solo si los tres cumplen.
// --occupy-profile: escucha en la dirección REAL del host de ese perfil ANTES de que arranque Mage y cuenta lo que
//   ve cada conexión. No escribe ficheros en el perfil. Ctrl+C la cierra y sale con 0.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import { posix, win32 } from 'node:path';
import { NOT_MAGE_SERVER, computeProof, connectVerified } from '../hostLink.mjs';

const SCENARIOS = ['wrong-proof', 'error-reply', 'silent-close'];
const HASH_HEX_CHARS = 12;
const PRIVATE_DIR_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const IMPOSTOR_ERROR_CODE = -32001;

const print = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  if (mode === '--scenarios' && rest[0] === '--user-data-dir' && rest[1] !== undefined) return { mode: 'scenarios', dir: rest[1] };
  if (mode === '--occupy-profile' && rest[0] !== undefined) return { mode: 'occupy', dir: rest[0] };
  throw new Error('Uso: --scenarios --user-data-dir <dir-desechable> | --occupy-profile <userDataDir>');
}

const linkDeps = {
  platform: process.platform,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  lstat: fs.lstatSync,
  getuid: process.getuid?.bind(process) ?? (() => -1),
  connect: (address) => new Promise((resolve, reject) => {
    const socket = net.createConnection(address);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  }),
  randomBytes,
};

// Copia de hostEndpoint.ts; si cambia allí, cambia aquí.
function realHostAddress(userDataDir) {
  const win = process.platform === 'win32';
  const { join } = win ? win32 : posix;
  const hash = createHash('sha256').update(win ? userDataDir.toLowerCase() : userDataDir).digest('hex').slice(0, HASH_HEX_CHARS);
  if (win) return `\\\\.\\pipe\\mage-${hash}-v1`;
  const xdg = process.env.XDG_RUNTIME_DIR;
  const base = xdg !== undefined && xdg.length > 0 ? join(xdg, 'mage') : join(userDataDir, 'run');
  return join(base, `${hash}.sock`);
}

// Un net.Server que, por cada línea, apunta si ve el token o `hello`, contesta con `reply` y CIERRA la conexión.
function startImpostor({ address, token, reply, onConnection }) {
  const seen = { tokenSeen: false, helloSeen: false };
  let connections = 0;
  const server = net.createServer((socket) => {
    const connection = ++connections;
    const state = { tokenSeen: false, helloSeen: false };
    let buffer = '';
    socket.on('error', () => socket.destroy());
    socket.on('close', () => onConnection?.({ connection, ...state }));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines.filter((l) => l.length > 0)) {
        if (token !== null && line.includes(token)) state.tokenSeen = seen.tokenSeen = true;
        if (line.includes('"hello"')) state.helloSeen = seen.helloSeen = true;
        const response = reply(JSON.parse(line));
        if (response === null) socket.end();
        else socket.end(`${JSON.stringify(response)}\n`);
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(address, () => resolve({ server, seen }));
  });
}

const replyFor = (scenario, request) => {
  if (scenario === 'silent-close') return null;
  if (scenario === 'error-reply') return { jsonrpc: '2.0', id: request.id, error: { code: IMPOSTOR_ERROR_CODE, message: 'x' } };
  return { jsonrpc: '2.0', id: request.id, result: { proof: computeProof(randomBytes(32).toString('hex'), request.params?.nonce ?? '') } };
};

function writeForgottenFiles(dir, address) {
  const run = posix.join(dir.replaceAll('\\', '/'), 'run');
  fs.mkdirSync(run, { recursive: true, mode: PRIVATE_DIR_MODE });
  fs.chmodSync(run, PRIVATE_DIR_MODE);
  const files = { endpoint: posix.join(run, 'host-endpoint'), token: posix.join(run, 'host-token') };
  const token = randomBytes(32).toString('hex');
  fs.writeFileSync(files.endpoint, address, { mode: PRIVATE_FILE_MODE });
  fs.writeFileSync(files.token, token, { mode: PRIVATE_FILE_MODE });
  return { files, token };
}

function impostorAddress(dir) {
  if (process.platform === 'win32') return `\\\\.\\pipe\\mage-impostor-${randomBytes(4).toString('hex')}`;
  return posix.join(dir, 'run', 'impostor.sock');
}

async function runScenario(dir, scenario) {
  const address = impostorAddress(dir);
  const { files, token } = writeForgottenFiles(dir, address);
  const { server, seen } = await startImpostor({ address, token, reply: (request) => replyFor(scenario, request) });
  if (process.platform !== 'win32') fs.chmodSync(address, PRIVATE_FILE_MODE);
  let message = null;
  try {
    await connectVerified({ userDataDir: dir, clientVersion: 'impostor-spike', deps: linkDeps });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolve) => server.close(resolve));
  for (const file of [files.endpoint, files.token, address]) fs.rmSync(file, { force: true });
  const result = { scenario, rejected: message !== null, message, tokenSeen: seen.tokenSeen, helloSeen: seen.helloSeen };
  print(result);
  return result.rejected && message === NOT_MAGE_SERVER && !result.tokenSeen && !result.helloSeen;
}

async function runScenarios(dir) {
  let allGood = true;
  for (const scenario of SCENARIOS) allGood = (await runScenario(dir, scenario)) && allGood;
  return allGood ? 0 : 1;
}

async function occupyProfile(dir) {
  const address = realHostAddress(dir);
  const { server } = await startImpostor({
    address,
    token: null,
    reply: (request) => replyFor('wrong-proof', request),
    onConnection: print,
  });
  print({ occupied: address });
  await new Promise((resolve) => process.once('SIGINT', resolve));
  await new Promise((resolve) => server.close(resolve));
  return 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const code = args.mode === 'scenarios' ? await runScenarios(args.dir) : await occupyProfile(args.dir);
  process.exit(code);
}

main().catch((err) => {
  print({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
