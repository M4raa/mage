// Spike de F4.1: el directo de Codex con el código REAL de Mage (CodexAdapter) contra el CLI real. CODEX_HOME desechable con
// sesión iniciada (lo prepara quien verifica; nunca el del usuario) y carpeta temporal con un repositorio git.
// Gasta 5 turnos de modelo (gpt-6-luna/low). Lo empaqueta y lo lanza `steer-codex.mjs`. La salida solo lleva outcomes,
// códigos, tipos y recuentos, nunca texto.
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { CodexAdapter } from '../src/main/engine/codexAdapter';
import { resolveCodexBinary } from '../src/main/os/codexBinaryResolver';
import type { MageEvent } from '@shared/events';

const MODEL = 'gpt-6-luna';
const EFFORT = 'low';
const POLL_MS = 100;
const RPC_TIMEOUT_MS = 60_000;
const TURN_TIMEOUT_MS = 180_000;
const PERMISSION_WAIT_MS = 3000;
const OWN_ID_BASE = 10_000;
const JSONRPC_VERSION = '2.0';
const SPIKE_ACCOUNT = 'steer-spike';

type Raw = Record<string, any>;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null;

// El app-server como lo lanza Mage (plan del adapter, entorno saneado). Tras lanzar, y tras cada línea y cada encode*,
// se escribe en stdin todo lo de `takeOutgoing()`: así lo hace AgentSession.
class CodexDriver {
  readonly adapter: CodexAdapter;
  readonly raws: Raw[] = [];
  readonly events: MageEvent[] = [];
  holdPermissions = false;
  readonly held: { requestId: string; toolUseId: string }[] = [];
  private readonly child: ChildProcessWithoutNullStreams;
  private ownId = OWN_ID_BASE;

  constructor(home: string, cwd: string) {
    this.adapter = new CodexAdapter({ resolveBinary: resolveCodexBinary, resolveAccount: () => ({ home, apiKey: null }) });
    const plan = this.adapter.buildSpawnPlan({ sessionId: SPIKE_ACCOUNT, accountDir: home, model: MODEL, effort: EFFORT, cwd });
    this.child = spawn(plan.command, plan.args, { cwd, env: plan.env, stdio: 'pipe', windowsHide: true });
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', (line) => this.receive(line));
    this.flush();
  }

  // Todo lo que el adapter tiene pendiente de escribir.
  flush(): void {
    for (const message of this.adapter.takeOutgoing()) this.write(message);
  }

  write(message: unknown): void {
    if (message === null || message === undefined) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  // Un mensaje del usuario o un directo por el adapter; devuelve lo que encodeSteer decidió.
  user(text: string): void {
    this.write(this.adapter.encodeUserMessage(text));
    this.flush();
  }

  steer(messageId: string, text: string): { kind: string; outcome?: string } {
    const encoding = this.adapter.encodeSteer(messageId, text);
    if (encoding.kind === 'write') this.write(encoding.payload);
    this.flush();
    return encoding.kind === 'resolved' ? { kind: encoding.kind, outcome: encoding.outcome } : { kind: encoding.kind };
  }

  // Petición propia (review/start, turn/steer...) por el mismo stdin; el adapter no las conoce y no las toca.
  async rpc(method: string, params: object): Promise<Raw> {
    this.ownId += 1;
    const id = this.ownId;
    this.write({ jsonrpc: JSONRPC_VERSION, id, method, params });
    return this.reply(id);
  }

  sendOwn(method: string, params: object): number {
    this.ownId += 1;
    this.write({ jsonrpc: JSONRPC_VERSION, id: this.ownId, method, params });
    return this.ownId;
  }

  reply(id: number): Promise<Raw> {
    return this.until(() => this.raws.find((raw) => raw.id === id && raw.method === undefined), RPC_TIMEOUT_MS, `respuesta ${id}`);
  }

  allowHeld(): void {
    for (const ref of this.held.splice(0)) this.allow(ref);
  }

  // Espera a que `find` devuelva algo distinto de undefined; lanza al agotar el tiempo.
  async until<T>(find: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = find();
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error(`sin ${what} en ${timeoutMs} ms`);
      await sleep(POLL_MS);
    }
  }

  completedTurns(): number {
    return this.raws.filter((raw) => raw.method === 'turn/completed').length;
  }

  close(): void {
    this.child.stdin.end();
    if (this.child.exitCode === null && this.child.pid !== undefined) process.kill(this.child.pid);
  }

  private receive(line: string): void {
    let raw: Raw;
    try {
      raw = JSON.parse(line) as Raw;
    } catch {
      return; // avisos del CLI que no son JSON
    }
    this.raws.push(raw);
    for (const event of this.adapter.normalize(raw)) {
      this.events.push(event);
      if (event.kind === 'permission_request') this.onPermission(event.request);
    }
    this.flush();
  }

  private onPermission(request: { requestId: string; toolUseId: string }): void {
    const ref = { requestId: request.requestId, toolUseId: request.toolUseId };
    if (this.holdPermissions) this.held.push(ref);
    else this.allow(ref);
  }

  private allow(ref: { requestId: string; toolUseId: string }): void {
    this.write(this.adapter.encodePermissionResponse(ref, { behavior: 'allow' }));
  }
}

function prepareRepo(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'mage-g-steer-codex-'));
  const git = (...args: string[]): void => void execFileSync('git', ['-c', 'user.name=spike', '-c', 'user.email=spike@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
  git('init');
  writeFileSync(join(cwd, 'f.txt'), 'uno\n');
  git('add', 'f.txt');
  git('commit', '-m', 'uno');
  writeFileSync(join(cwd, 'f.txt'), 'uno\ndos\n');
  return cwd;
}

// Marca de lo ocurrido hasta ahora: lo que cuenta es lo que llega DESPUÉS.
const mark = (driver: CodexDriver): { events: number; raws: number } => ({ events: driver.events.length, raws: driver.raws.length });

const steerOutcome = (driver: CodexDriver, from: number, messageId: string): string | null => {
  const found = driver.events.slice(from).find((event) => event.kind === 'steer_result' && event.messageId === messageId);
  return found?.kind === 'steer_result' ? found.outcome : null;
};

const waitResult = (driver: CodexDriver, from: number): Promise<MageEvent> =>
  driver.until(() => driver.events.slice(from).find((event) => event.kind === 'result'), TURN_TIMEOUT_MS, 'result del turno');

// El directo ya llegó (o no) cuando el turno acabó: el recibo de turn/steer sale antes que turn/completed.
async function caseEnTurno(driver: CodexDriver): Promise<string | null> {
  const from = mark(driver).events;
  driver.user('Run the shell command `sleep 8`, then reply with exactly: DONE');
  await driver.until(() => driver.events.slice(from).find((event) => event.kind === 'tool_use'), TURN_TIMEOUT_MS, 'tool_use');
  driver.steer('m-en-turno', 'Also end your final reply with the word BETA.');
  await waitResult(driver, from);
  return steerOutcome(driver, from, 'm-en-turno');
}

async function caseEsperandoTurno(driver: CodexDriver): Promise<string | null> {
  const from = mark(driver).events;
  // En el MISMO tick: el directo espera al id del turno.
  driver.user('Reply with exactly: UNO');
  driver.steer('m-esperando', 'Reply with exactly: DOS instead.');
  await waitResult(driver, from);
  return steerOutcome(driver, from, 'm-esperando');
}

function caseTardio(driver: CodexDriver): Record<string, unknown> {
  const receipt = driver.steer('m-tardio', 'x');
  return { recibo: `${receipt.kind}/${receipt.outcome ?? ''}` };
}

async function casePermisoPendiente(driver: CodexDriver): Promise<string | null> {
  const from = mark(driver).events;
  driver.holdPermissions = true;
  driver.user('Run the shell command `echo hola > q.txt` and then reply with exactly: DONE');
  await driver.until(() => (driver.held.length > 0 ? true : undefined), TURN_TIMEOUT_MS, 'permission_request');
  driver.steer('m-permiso', 'Also end your final reply with the word BETA.');
  await sleep(PERMISSION_WAIT_MS);
  driver.holdPermissions = false;
  driver.allowHeld();
  await waitResult(driver, from);
  return steerOutcome(driver, from, 'm-permiso');
}

// Solo `code` y `turnKind` del rechazo; nunca su mensaje.
function rejectionOf(reply: Raw): { code: unknown; turnKind: unknown } {
  const error = isRecord(reply.error) ? reply.error : {};
  const info = isRecord(error.data) && isRecord(error.data.codexErrorInfo) ? error.data.codexErrorInfo : {};
  const notSteerable = isRecord(info.activeTurnNotSteerable) ? info.activeTurnNotSteerable : {};
  return { code: error.code ?? null, turnKind: notSteerable.turnKind ?? null };
}

// Mage no abre review ni compactación: el spike abre el turno a mano y le manda un turn/steer también a mano.
async function steerManually(driver: CodexDriver, threadId: string, turnId: string): Promise<{ code: unknown; turnKind: unknown }> {
  const reply = await driver.rpc('turn/steer', { threadId, expectedTurnId: turnId, input: [{ type: 'text', text: 'x', text_elements: [] }] });
  await driver.until(() => driver.raws.find((raw) => raw.method === 'turn/completed' && raw.params?.turn?.id === turnId), TURN_TIMEOUT_MS, 'turn/completed del turno manual');
  return rejectionOf(reply);
}

async function caseRevision(driver: CodexDriver, threadId: string): Promise<{ code: unknown; turnKind: unknown }> {
  const started = await driver.rpc('review/start', { threadId, target: { type: 'uncommittedChanges' }, delivery: 'inline' });
  const turnId = String(started.result?.turn?.id ?? '');
  if (turnId.length === 0) throw new Error('review/start no devolvio el id del turno');
  return steerManually(driver, threadId, turnId);
}

async function caseCompactacion(driver: CodexDriver, threadId: string): Promise<{ code: unknown; turnKind: unknown }> {
  const from = mark(driver).raws;
  const id = driver.sendOwn('thread/compact/start', { threadId });
  const started = await driver.until(() => driver.raws.slice(from).find((raw) => raw.method === 'turn/started'), RPC_TIMEOUT_MS, 'turn/started de la compactacion');
  await driver.reply(id);
  return steerManually(driver, threadId, String(started.params?.turn?.id ?? ''));
}

export function codexBinary(): string {
  return resolveCodexBinary();
}

export async function run(home: string): Promise<Record<string, unknown>> {
  const cwd = prepareRepo();
  const driver = new CodexDriver(home, cwd);
  try {
    const init = await driver.until(() => driver.events.find((event) => event.kind === 'session_init'), RPC_TIMEOUT_MS, 'session_init');
    const threadId = init.kind === 'session_init' ? init.sessionId : '';
    const enTurno = await caseEnTurno(driver);
    const esperandoTurno = await caseEsperandoTurno(driver);
    const tardio = caseTardio(driver);
    const permisoPendiente = await casePermisoPendiente(driver);
    const revision = await caseRevision(driver, threadId);
    const compactacion = await caseCompactacion(driver, threadId);
    const turnos = driver.completedTurns();
    await driver.rpc('thread/delete', { threadId });
    return { turnos, casos: { enTurno, esperandoTurno, tardio, permisoPendiente, revision, compactacion } };
  } finally {
    driver.close();
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}
