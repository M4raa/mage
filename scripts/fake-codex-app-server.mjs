// App-server FALSO de Codex para verify:gui. Lo lanza Mage SIN empaquetar cuando MAGE_CODEX_BIN apunta aquí
// (`codexSpawnCommand`: el Node de Electron con ELECTRON_RUN_AS_NODE). JSON-RPC por stdio, una línea por mensaje, como
// `codex app-server` 0.164.0. Sirve los turnos que la fixture dejó en `<CODEX_HOME>/fake-app-server-turns.json`
// (`{ [threadId]: Turn[] }`), UNA página por turno para ejercitar la paginación por `nextCursor`. Sin red, sin modelo y sin
// escribir nada.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

// El mismo nombre que escribe `seedCodexRevertThread` (scripts/lib/providerHistoryFixtures.mjs).
const TURNS_FILE = 'fake-app-server-turns.json';
const METHOD_NOT_FOUND = -32601;

function turnsOf(threadId) {
  const file = join(process.env.CODEX_HOME ?? '', TURNS_FILE);
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8'))[threadId] ?? [];
}

function turnsPage(params) {
  const turns = turnsOf(String(params?.threadId ?? ''));
  const index = params?.cursor === undefined || params?.cursor === null ? 0 : Number(params.cursor);
  const next = index + 1 < turns.length ? String(index + 1) : null;
  return { data: turns.slice(index, index + 1), nextCursor: next, backwardsCursor: null };
}

const HANDLERS = {
  initialize: () => ({ userAgent: 'mage-fake-codex-app-server' }),
  'thread/turns/list': turnsPage,
  'thread/resume': () => ({}),
  'thread/delete': () => ({}),
};

// null: una notificación (`initialized`) o algo que no es una petición.
function answer(message) {
  if (message.id === undefined || typeof message.method !== 'string') return null;
  const handler = HANDLERS[message.method];
  if (handler === undefined) {
    return { jsonrpc: '2.0', id: message.id, error: { code: METHOD_NOT_FOUND, message: `metodo no soportado por el app-server falso: ${message.method}` } };
  }
  return { jsonrpc: '2.0', id: message.id, result: handler(message.params) };
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim().length === 0) return;
  const reply = answer(JSON.parse(line));
  if (reply !== null) process.stdout.write(`${JSON.stringify(reply)}\n`);
});
