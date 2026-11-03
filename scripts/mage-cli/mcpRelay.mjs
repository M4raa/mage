// Relevo stdio <-> host de `mage mcp` (D-M5): Claude y Codex lo lanzan como servidor MCP por stdio y este
// proceso pasa cada línea al túnel `mcp.message` del host (1.5) y devuelve lo que el host contesta. stdout lleva
// SOLO mensajes MCP (una línea JSON cada uno); todo aviso va a stderr. Nunca arranca Mage: si no hay host, sale.
// Sin dependencias: solo `node:*`; toda la E/S llega por parámetros.
import readline from 'node:readline';
import { isNoHostError } from './hostStarter.mjs';

// Igual que `MAGE_MCP_CALLER_ENV` de `src/main/host/mcpCallers.ts` (lo comprueba `mcpRelay.test.mjs`).
export const MAGE_MCP_CALLER_ENV = 'MAGE_MCP_CALLER';
const EXIT_OK = 0;
const EXIT_ERROR = 1;

async function connectOrExit({ connect, env, stderr, messages, exit }) {
  try {
    return await connect({ kind: 'mcp', caller: env[MAGE_MCP_CALLER_ENV] });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    stderr.write(`${isNoHostError(error) ? messages.mcpNoHost() : messages.mcpConnectFailed(detail)}\n`);
    exit(EXIT_ERROR);
    return null;
  }
}

function parseLine(line, { stderr, messages }) {
  try {
    return JSON.parse(line);
  } catch {
    // Una línea ilegible no tumba el relevo: se avisa (sin su contenido) y se sigue con la siguiente.
    stderr.write(`${messages.mcpBadLine()}\n`);
    return null;
  }
}

export async function runMcpRelay(context) {
  const { stdin, stdout, stderr, messages, exit } = context;
  const link = await connectOrExit(context);
  if (link === null) return;
  const { rpc, socket } = link;
  let finished = false;

  rpc.onNotification((method, params) => {
    if (method === 'mcp.message') stdout.write(`${JSON.stringify(params.message)}\n`);
  });
  socket.on('close', () => {
    if (finished) return;
    finished = true;
    stderr.write(`${messages.mcpHostClosed()}\n`);
    exit(EXIT_ERROR);
  });

  const lines = readline.createInterface({ input: stdin, crlfDelay: Infinity });
  lines.on('line', (line) => {
    if (line.trim().length === 0) return;
    const message = parseLine(line, context);
    if (message !== null) rpc.notify('mcp.message', { message });
  });
  lines.on('close', () => {
    if (finished) return;
    finished = true;
    rpc.close();
    exit(EXIT_OK);
  });
}
