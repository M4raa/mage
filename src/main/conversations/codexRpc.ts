import { z } from 'zod';
import type { CodexTurn } from '@shared/codexTranscript';
import type { ProbeProcess } from '../engine/modelProbe';

// Llamadas de UN SOLO USO al app-server de Codex de una cuenta: arranca, se presenta, hace sus peticiones en serie y se
// cierra. `thread/delete` quita la conversación de origen al migrarla (MEDIDO con codex-cli 0.160.0,
// `spike/codex-copy-rollout-spike.mjs`). `thread/turns/list` trae los turnos VIGENTES de un hilo, sin lo descartado por un
// `thread/revert` (MEDIDO con codex-cli 0.164.0, `spike/codex-revert-reopen.mjs`).

export interface CodexRpcDeps {
  readonly spawnProbe: (home: string) => ProbeProcess;
  readonly timeoutMs: number;
}

type Call = (method: string, params: object) => Promise<unknown>;

interface Pending {
  readonly method: string;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

interface Reply {
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly message?: unknown };
}

const INIT_ID = 'mage-rpc-init';
const CALL_ID = 'mage-rpc-call';
const CLIENT_INFO = { name: 'mage', version: '0.1.2' };
const THREAD_ID_PATTERN = /^[A-Za-z0-9-]+$/;
// `{ data, nextCursor, backwardsCursor }` (codex-cli 0.164.0): el cursor es una cadena opaca o null. Lo que no se usa pasa
// (`.passthrough()`); lo que se usa se valida, y si no cuadra se lanza: nunca se corta la lectura en silencio.
const TurnsPageSchema = z.object({
  data: z.array(z.object({ id: z.string(), items: z.array(z.unknown()) }).passthrough()),
  nextCursor: z.string().nullable().optional(),
}).passthrough();
// Un servidor que repitiera el cursor no deja a main en un bucle.
const MAX_TURN_PAGES = 1000;

export function codexThreadDelete(deps: CodexRpcDeps, home: string, threadId: string): Promise<void> {
  if (!validParams(home, threadId)) {
    return Promise.reject(new Error(`Parametros invalidos para borrar un hilo de Codex: home=${JSON.stringify(home)} hilo=${JSON.stringify(threadId)}`));
  }
  return withAppServer(deps, home, 'thread/delete', async (call) => {
    await call('thread/delete', { threadId });
  });
}

// Los turnos vigentes de un hilo que EXISTE en la cuenta, en orden y con todos sus items. Si la base del historial no los
// tiene (0 turnos: un rollout copiado sin ella), `thread/resume` los reconstruye desde el rollout y se vuelven a pedir
// (medido con codex-cli 0.164.0, sin credenciales ni turnos de modelo).
export function codexThreadTurnsList(deps: CodexRpcDeps, home: string, threadId: string): Promise<readonly CodexTurn[]> {
  if (!validParams(home, threadId)) {
    return Promise.reject(new Error(`Parametros invalidos para leer los turnos de un hilo de Codex: home=${JSON.stringify(home)} hilo=${JSON.stringify(threadId)}`));
  }
  return withAppServer(deps, home, 'thread/turns/list', async (call) => {
    const turns = await listAllTurns(call, threadId);
    if (turns.length > 0) return turns;
    await call('thread/resume', { threadId, excludeTurns: true });
    return listAllTurns(call, threadId);
  });
}

function validParams(home: string, threadId: string): boolean {
  return home.trim().length > 0 && THREAD_ID_PATTERN.test(threadId);
}

async function listAllTurns(call: Call, threadId: string): Promise<CodexTurn[]> {
  const turns: CodexTurn[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_TURN_PAGES; page++) {
    const params = { threadId, itemsView: 'full', sortDirection: 'asc', ...(cursor === null ? {} : { cursor }) };
    const parsed = TurnsPageSchema.safeParse(await call('thread/turns/list', params));
    if (!parsed.success) throw new Error(`Respuesta de thread/turns/list inesperada: ${parsed.error.message}`);
    turns.push(...parsed.data.data.map((turn) => ({ id: turn.id, items: turn.items })));
    cursor = parsed.data.nextCursor ?? null;
    if (cursor === null) return turns;
  }
  throw new Error(`thread/turns/list no termino tras ${MAX_TURN_PAGES} paginas (hilo ${threadId})`);
}

// Arranca el app-server, se presenta y ejecuta `run`. El proceso se cierra (árbol entero) al terminar, por error o por
// tiempo; si muere antes, las peticiones pendientes fallan.
async function withAppServer<T>(deps: CodexRpcDeps, home: string, purpose: string, run: (call: Call) => Promise<T>): Promise<T> {
  const session = new AppServerSession(deps.spawnProbe(home), purpose);
  const timer = setTimeout(() => session.fail(new Error(`Codex no respondio a ${purpose} dentro de ${deps.timeoutMs} ms`)), deps.timeoutMs);
  try {
    await session.request(INIT_ID, 'initialize', { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true } });
    session.notify('initialized');
    return await run(session.call);
  } finally {
    clearTimeout(timer);
    session.close();
  }
}

class AppServerSession {
  private readonly pending = new Map<string, Pending>();
  private buffer = '';
  private calls = 0;
  private failure: Error | null = null;

  constructor(private readonly child: ProbeProcess, purpose: string) {
    child.onError?.(() => this.fail(new Error('Fallo el transporte con el CLI de Codex')));
    child.onExit(() => this.fail(new Error(`El CLI de Codex termino antes de responder a ${purpose}`)));
    child.onStdout((chunk) => this.receive(chunk));
  }

  // La primera llamada lleva el id `mage-rpc-call`; las siguientes, `mage-rpc-call-2`, `-3`…
  readonly call: Call = (method, params) => {
    this.calls += 1;
    return this.request(this.calls === 1 ? CALL_ID : `${CALL_ID}-${this.calls}`, method, params);
  };

  request(id: string, method: string, params: object): Promise<unknown> {
    if (this.failure !== null) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.send({ id, method, params });
    });
  }

  notify(method: string): void {
    this.send({ method });
  }

  fail(error: Error): void {
    if (this.failure !== null) return;
    this.failure = error;
    for (const waiting of this.pending.values()) waiting.reject(error);
    this.pending.clear();
  }

  close(): void {
    this.fail(new Error('Sesion con el CLI de Codex cerrada'));
    this.child.killTree();
  }

  private send(message: object): void {
    this.child.writeLine(JSON.stringify({ jsonrpc: '2.0', ...message }));
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    for (const line of lines) this.settle(parseReply(line));
  }

  private settle(reply: Reply | null): void {
    if (reply === null || typeof reply.id !== 'string') return;
    const waiting = this.pending.get(reply.id);
    if (waiting === undefined) return;
    this.pending.delete(reply.id);
    if (reply.error === undefined) waiting.resolve(reply.result);
    else waiting.reject(new Error(`Codex rechazo ${waiting.method}: ${String(reply.error.message ?? 'sin motivo')}`));
  }
}

// Los avisos que no son JSON (o no son una respuesta) se ignoran: el app-server mezcla notificaciones con respuestas.
function parseReply(line: string): Reply | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Reply) : null;
  } catch {
    return null;
  }
}
