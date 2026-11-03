// App-server FALSO de Codex para verify:gui. Lo lanza Mage SIN empaquetar cuando MAGE_CODEX_BIN apunta aquí
// (`codexSpawnCommand`: el Node de Electron con ELECTRON_RUN_AS_NODE). JSON-RPC por stdio, una línea por mensaje, como
// `codex app-server` 0.164.0. Sirve los turnos que la fixture dejó en `<CODEX_HOME>/fake-app-server-turns.json`
// (`{ [threadId]: Turn[] }`), UNA página por turno para ejercitar la paginación por `nextCursor`. Sin red, sin modelo y sin
// escribir nada.
//
// Escenario `approval` (solo con MAGE_FAKE_CODEX_SCENARIO=approval; sin el, el fichero se comporta como siempre): abre
// un hilo (`thread/start` -> `fake-thread-<uuid>`) y un turno por mensaje (`turn/start` -> `fake-turn-<n>`) y, justo tras
// responder al turno, PIDE un permiso (`item/commandExecution/requestApproval` para `echo mage-host-tab`, con id propio
// del servidor). Cuando llega la respuesta del cliente a esa peticion cierra el turno (`serverRequest/resolved` y
// `turn/completed`) sin ejecutar nada. Un permiso por turno: dos turnos seguidos piden dos. La forma sale de
// `codexAdapter.ts` (`afterThread`, `afterTurnStart`, `onServerRequest`, `onResolved`) y `codexProtocol.ts`
// (`approvalRequest`, `TurnSchema`).
import { randomUUID } from 'node:crypto';
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

const APPROVAL_SCENARIO = 'approval';
const APPROVAL_METHOD = 'item/commandExecution/requestApproval';
const APPROVAL_COMMAND = 'echo mage-host-tab';
// Ids de las peticiones del servidor: aparte de los del cliente (numeros pequenos) para no confundirse.
const FIRST_SERVER_REQUEST_ID = 9000;

const scenario = { threadId: null, turnCount: 0, nextRequestId: FIRST_SERVER_REQUEST_ID, pending: new Map() };

function inApprovalScenario() {
  return process.env.MAGE_FAKE_CODEX_SCENARIO === APPROVAL_SCENARIO;
}

function startThread(params) {
  scenario.threadId = `fake-thread-${randomUUID()}`;
  return { thread: { id: scenario.threadId, historyMode: 'paginated' }, model: String(params?.model ?? '') };
}

function startTurn() {
  scenario.turnCount += 1;
  return { turn: { id: `fake-turn-${scenario.turnCount}`, status: 'inProgress' } };
}

// La peticion de permiso que sigue a la respuesta de `turn/start`: [mensajes a escribir tras ella].
function approvalRequestFor(turnId) {
  const requestId = scenario.nextRequestId;
  scenario.nextRequestId += 1;
  scenario.pending.set(requestId, turnId);
  const params = { threadId: scenario.threadId, turnId, itemId: `fake-item-${requestId}`, command: APPROVAL_COMMAND, cwd: process.cwd() };
  return { jsonrpc: '2.0', id: requestId, method: APPROVAL_METHOD, params };
}

// La respuesta del cliente a una peticion nuestra cierra el turno; null si no era una.
function closeTurnOnAnswer(message) {
  if (message.method !== undefined || !scenario.pending.has(message.id)) return null;
  const turnId = scenario.pending.get(message.id);
  scenario.pending.delete(message.id);
  const turn = { id: turnId, status: 'completed' };
  return [
    { jsonrpc: '2.0', method: 'serverRequest/resolved', params: { threadId: scenario.threadId, requestId: message.id } },
    { jsonrpc: '2.0', method: 'turn/completed', params: { threadId: scenario.threadId, turn } },
  ];
}

const HANDLERS = {
  initialize: () => ({ userAgent: 'mage-fake-codex-app-server' }),
  'thread/turns/list': turnsPage,
  'thread/resume': () => ({}),
  'thread/delete': () => ({}),
};

const APPROVAL_HANDLERS = { 'thread/start': startThread, 'turn/start': startTurn };

// null: una notificación (`initialized`) o algo que no es una petición.
function answer(message) {
  if (message.id === undefined || typeof message.method !== 'string') return null;
  const handler = (inApprovalScenario() ? APPROVAL_HANDLERS[message.method] : undefined) ?? HANDLERS[message.method];
  if (handler === undefined) {
    return { jsonrpc: '2.0', id: message.id, error: { code: METHOD_NOT_FOUND, message: `metodo no soportado por el app-server falso: ${message.method}` } };
  }
  return { jsonrpc: '2.0', id: message.id, result: handler(message.params) };
}

// Lo que se escribe por una linea: la respuesta, y en el escenario lo que ella dispara (permiso o cierre de turno).
function replies(message) {
  const reply = answer(message);
  const extra = [];
  if (inApprovalScenario() && message.method === 'turn/start') extra.push(approvalRequestFor(reply.result.turn.id));
  if (inApprovalScenario()) extra.push(...(closeTurnOnAnswer(message) ?? []));
  return reply === null ? extra : [reply, ...extra];
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim().length === 0) return;
  for (const out of replies(JSON.parse(line))) process.stdout.write(`${JSON.stringify(out)}\n`);
});
