// Spike de F4.3: reabrir y migrar una conversación de Codex con revert usando el código REAL de Mage contra el CLI real.
// CODEX_HOME desechable con sesión iniciada (lo prepara quien verifica; nunca el del usuario) y carpetas temporales.
// Gasta 2 turnos de modelo (gpt-6-luna/low); reabrir, los dos procesos, el hilo sin base y migrar no usan modelo.
// Lo empaqueta y lo lanza `codex-revert-reopen.mjs`. La salida solo lleva recuentos y booleanos, nunca texto.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { codexTurnsToLines } from '@shared/codexTranscript';
import type { ProbeProcess } from '../src/main/engine/modelProbe';
import { scrubAgentEnv } from '../src/main/os/agentEnv';
import { resolveCodexBinary } from '../src/main/os/codexBinaryResolver';
import { CodexHistoryService } from '../src/main/conversations/codexHistory';
import { codexThreadDelete, codexThreadTurnsList, type CodexRpcDeps } from '../src/main/conversations/codexRpc';
import { codexTranscriptSource } from '../src/main/conversations/codexTurnsTranscript';
import { ConversationMigrationService } from '../src/main/conversations/conversationMigration';
import { createMigrationEndpoints } from '../src/main/conversations/migrationEndpoints';

const MODEL = { model: 'gpt-6-luna', effort: 'low', approvalPolicy: 'never' };
const KEPT = 'MAGEUNO';
const DROPPED = 'MAGEDOS';
const RPC_TIMEOUT_MS = 60_000;
const TURN_TIMEOUT_MS = 180_000;
const POLL_MS = 150;

interface Message { readonly id?: unknown; readonly method?: string; readonly params?: any; readonly result?: any; readonly error?: unknown }

const FS = {
  exists: existsSync,
  listDir: (path: string) => readdirSync(path),
  isDirectory: (path: string) => statSync(path).isDirectory(),
  statFile: (path: string) => ({ mtimeMs: statSync(path).mtimeMs, sizeBytes: statSync(path).size }),
  readPrefix: (path: string, max: number) => readFileSync(path, 'utf8').slice(0, max),
  readSuffix: (path: string, max: number) => readFileSync(path, 'utf8').slice(-max),
};

// El app-server de un solo uso, como lo lanza main (entorno saneado, CODEX_HOME de la cuenta); se para por su PID.
function spawnProbe(home: string): ProbeProcess {
  const child = spawn(resolveCodexBinary(), ['app-server'], { env: { ...scrubAgentEnv(process.env), CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stderr.resume();
  return {
    onStdout: (listener) => { child.stdout.setEncoding('utf8'); child.stdout.on('data', listener); },
    onExit: (listener) => { child.on('exit', listener); },
    onError: (listener) => { child.on('error', listener); child.stdin.on('error', listener); },
    writeLine: (line) => { child.stdin.write(`${line}\n`); },
    endInput: () => { child.stdin.end(); },
    killTree: () => { child.kill(); },
  };
}

const RPC: CodexRpcDeps = { spawnProbe, timeoutMs: RPC_TIMEOUT_MS };

// Cliente mínimo para lo que Mage no hace aquí: abrir el hilo, los dos turnos y el revert. Es también la «pestaña viva»
// que sigue con el hilo abierto mientras otro proceso pide sus turnos.
class LiveCodex {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<number, (message: Message) => void>();
  private readonly seen: Message[] = [];
  private seq = 0;

  constructor(home: string, cwd: string) {
    this.child = spawn(resolveCodexBinary(), ['app-server'], { cwd, env: { ...scrubAgentEnv(process.env), CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', (line) => this.receive(line));
  }

  async init(): Promise<void> {
    await this.rpc('initialize', { clientInfo: { name: 'mage-spike', version: '0.1.3' }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
  }

  async rpc(method: string, params: object): Promise<any> {
    const id = (this.seq += 1);
    const reply = await new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`sin respuesta a ${method}`)), RPC_TIMEOUT_MS);
      this.waiting.set(id, (message) => { clearTimeout(timer); resolve(message); });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    if (reply.error !== undefined) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
    return reply.result;
  }

  async turn(threadId: string, prompt: string): Promise<string> {
    const started = await this.rpc('turn/start', { threadId, input: [{ type: 'text', text: prompt, text_elements: [] }], ...MODEL });
    const turnId = String(started?.turn?.id ?? '');
    await this.until((m) => m.method === 'turn/completed' && m.params?.turn?.id === turnId);
    return turnId;
  }

  close(): void {
    if (this.child.exitCode === null) this.child.kill();
  }

  private receive(line: string): void {
    let message: Message;
    try {
      message = JSON.parse(line) as Message;
    } catch {
      return; // avisos del CLI que no son JSON
    }
    if (typeof message.id === 'number' && message.method === undefined) {
      this.waiting.get(message.id)?.(message);
      this.waiting.delete(message.id);
      return;
    }
    this.seen.push(message);
  }

  private async until(found: (message: Message) => boolean): Promise<void> {
    const deadline = Date.now() + TURN_TIMEOUT_MS;
    while (!this.seen.some(found)) {
      if (Date.now() > deadline) throw new Error(`el turno no termino en ${TURN_TIMEOUT_MS} ms`);
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
  }
}

const textOf = async (home: string, threadId: string): Promise<{ turns: number; text: string }> => {
  const turns = await codexThreadTurnsList(RPC, home, threadId);
  return { turns: turns.length, text: JSON.stringify(codexTurnsToLines(turns)) };
};

// Reabrir como Mage, con el proceso «vivo» todavía abierto sobre el mismo hilo (dos procesos).
async function checkReopen(home: string, threadId: string): Promise<Record<string, unknown>> {
  const history = new CodexHistoryService(FS, () => undefined);
  const entries = history.list(home).filter((summary) => summary.sessionId === threadId).length;
  const source = codexTranscriptSource(history, home, threadId);
  const read = await textOf(home, threadId);
  return { entries, segments: history.hasSegments(home, threadId), sourceKind: source?.kind ?? null, turns: read.turns, hasKept: read.text.includes(KEPT), hasDropped: read.text.includes(DROPPED) };
}

// El hilo copiado SIN las bases internas (como tras copiar un rollout a otra cuenta): 0 turnos → `thread/resume` → otra vez.
async function checkWithoutHistoryDb(home: string, bare: string, threadId: string): Promise<Record<string, unknown>> {
  const root = join(home, 'sessions');
  for (const name of readdirSync(root, { recursive: true }).map(String).filter((file) => file.includes(threadId))) {
    mkdirSync(dirname(join(bare, 'sessions', name)), { recursive: true });
    copyFileSync(join(root, name), join(bare, 'sessions', name));
  }
  const read = await textOf(bare, threadId);
  return { turns: read.turns, hasKept: read.text.includes(KEPT), hasDropped: read.text.includes(DROPPED) };
}

// Migrar a otra cuenta de Codex con el servicio REAL: con segmentos no se copia el rollout; se escriben los turnos vigentes.
async function checkMigrate(home: string, dest: string, threadId: string, cwd: string): Promise<Record<string, unknown>> {
  const history = new CodexHistoryService(FS, () => undefined);
  const unused = (what: string) => (): never => { throw new Error(`el spike no usa ${what}`); };
  const endpoints = createMigrationEndpoints({
    readText: (path) => readFileSync(path, 'utf8'),
    writeText: (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text, 'utf8'); },
    copyFile: (from, to) => { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); },
    removeFile: (path) => rmSync(path, { force: true }),
    nowMs: Date.now,
    newId: randomUUID,
    claude: { effectiveDir: unused('claude'), deleteConversation: unused('claude') },
    codex: { homeOf: (dir) => dir, history, deleteThread: (h, id) => codexThreadDelete(RPC, h, id), listTurns: (h, id) => codexThreadTurnsList(RPC, h, id) },
    agy: { profileOf: unused('agy'), history: { findDb: unused('agy'), readLines: unused('agy') }, writeDb: unused('agy') },
  });
  const result = await new ConversationMigrationService(endpoints).migrate({ sourceAccountDir: home, sourceProvider: 'codex', sessionId: threadId, cwd, privacy: 'shared', destAccountDir: dest, destProvider: 'codex' });
  const written = history.findRollout(dest, result.sessionId);
  const text = written === null ? '' : readFileSync(written, 'utf8');
  return { newId: result.sessionId !== threadId, written: written !== null, hasKept: text.includes(KEPT), hasDropped: text.includes(DROPPED), sourceGone: !history.hasThread(home, threadId) };
}

function removeTemp(dirs: readonly string[], out: Record<string, unknown>): void {
  const pending: string[] = [];
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    } catch (err) {
      pending.push(`${dir}: ${(err as NodeJS.ErrnoException).code ?? String(err)}`); // `.sandbox` lleva ACL de Codex
    }
  }
  out.pendingToDelete = pending;
}

export function codexBinary(): string {
  return resolveCodexBinary();
}

export async function run(home: string): Promise<Record<string, unknown>> {
  const cwd = mkdtempSync(join(tmpdir(), 'mage-b-revert-cwd-'));
  const dest = mkdtempSync(join(tmpdir(), 'mage-b-revert-dest-'));
  const bare = mkdtempSync(join(tmpdir(), 'mage-b-revert-nodb-'));
  const out: Record<string, unknown> = { modelTurns: 0 };
  const live = new LiveCodex(home, cwd);
  try {
    await live.init();
    const threadId = String((await live.rpc('thread/start', { cwd, ...MODEL, ephemeral: false }))?.thread?.id ?? '');
    await live.turn(threadId, `Reply with exactly: ${KEPT}`);
    const second = await live.turn(threadId, `Reply with exactly: ${DROPPED}`);
    out.modelTurns = 2;
    await live.rpc('thread/revert', { threadId, beforeTurnId: second });
    out.reopen = await checkReopen(home, threadId);
    out.liveStillAnswers = (await live.rpc('thread/read', { threadId }))?.thread?.id === threadId;
    live.close();
    out.withoutHistoryDb = await checkWithoutHistoryDb(home, bare, threadId);
    out.migrate = await checkMigrate(home, dest, threadId, cwd);
  } finally {
    live.close();
    removeTemp([cwd, dest, bare], out);
  }
  return out;
}
