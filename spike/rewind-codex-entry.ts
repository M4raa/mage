// Spike de F4.4/F4.5/U13 (carril K, punto de control K10): rewind, copia, divergir, borrar con copias y actualizar un hilo
// legacy de Codex con el código REAL de Mage (CodexAdapter, SessionCoordinator, RewindCoordinator, codexThreadTurnsList,
// CodexHistoryService, deleteCodexConversation, updateLegacyCodexThread) contra el CLI REAL. Lo empaqueta y lo lanza
// `rewind-codex.mjs`. Reutiliza el montaje de `rewind-claude-entry.ts` (mismo coordinador, distinto adapter).
// Gasta 5 turnos de gpt-6-luna/low en un CODEX_HOME desechable con sesión (nunca el del usuario). La salida solo lleva
// booleanos, recuentos y nombres de fichero: nunca credenciales ni textos del usuario.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { UserFacingError } from '@shared/i18n/localizedText';
import { CodexAdapter } from '../src/main/engine/codexAdapter';
import type { ProbeProcess } from '../src/main/engine/modelProbe';
import { codexSpawnCommand, resolveCodexBinary } from '../src/main/os/codexBinaryResolver';
import { scrubAgentEnv } from '../src/main/os/agentEnv';
import { defaultKillTreeDeps, killProcessTree } from '../src/main/os/processTree';
import { CodexHistoryService } from '../src/main/conversations/codexHistory';
import { deleteCodexConversation } from '../src/main/conversations/codexDeletion';
import { updateLegacyCodexThread } from '../src/main/conversations/codexLegacyUpdate';
import { codexThreadDelete, codexThreadTurnsList, type CodexRpcDeps } from '../src/main/conversations/codexRpc';
import { attempt, errorText, Rig, rm, sleep, type Live, type Rec } from './rewind-claude-entry';

const MODEL = 'gpt-6-luna';
const EFFORT = 'low';
const PERMISSION_MODE = ':workspace';
const TURN_PARAMS = { model: MODEL, effort: EFFORT, approvalPolicy: 'never' } as const;
const RPC_TIMEOUT_MS = 60_000;
const TURN_TIMEOUT_MS = 180_000;
const MIGRATE_TIMEOUT_MS = 60_000;
const POLL_MS = 150;
const NATIVE_ID_TIMEOUT_MS = 30_000;
const AFTER_STOP_MS = 2_000;
const ASK_TEXT = '¿Qué texto pusiste en a.txt según esta conversación? Responde solo con esa palabra';

type Message = { readonly id?: unknown; readonly method?: string; readonly params?: any; readonly result?: any; readonly error?: unknown };

const FS = {
  exists: existsSync,
  listDir: (path: string) => readdirSync(path),
  isDirectory: (path: string) => statSync(path).isDirectory(),
  statFile: (path: string) => ({ mtimeMs: statSync(path).mtimeMs, sizeBytes: statSync(path).size }),
  readPrefix: (path: string, max: number) => readFileSync(path, 'utf8').slice(0, max),
  readSuffix: (path: string, max: number) => readFileSync(path, 'utf8').slice(-max),
};

const noLog = (): void => undefined;
const launch = (args: readonly string[]) => codexSpawnCommand(args, { isPackaged: false, execPath: process.execPath, log: noLog });
const spawnEnv = (home: string, extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv => ({ ...scrubAgentEnv(process.env), ...extra, CODEX_HOME: home });

// Un app-server de un solo uso como lo lanza main (entorno saneado, CODEX_HOME de la cuenta); se para por su PID con el killTree de Mage.
function spawnProbe(home: string): ProbeProcess {
  const codex = launch(['app-server']);
  const child = spawn(codex.command, [...codex.args], { env: spawnEnv(home, codex.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  child.stderr.resume();
  return {
    onStdout: (listener) => { child.stdout.setEncoding('utf8'); child.stdout.on('data', listener); },
    onExit: (listener) => { child.on('exit', listener); child.on('error', listener); },
    onError: (listener) => { child.on('error', listener); child.stdin.on('error', listener); },
    writeLine: (line) => { child.stdin.write(`${line}\n`); },
    endInput: () => { child.stdin.end(); },
    killTree: () => { killProcessTree(child, defaultKillTreeDeps()); },
  };
}

const RPC: CodexRpcDeps = { spawnProbe, timeoutMs: RPC_TIMEOUT_MS };

// El mismo `spawn` que `runCodex` de index.ts (sin empaquetar): `codex <args>` con CODEX_HOME y tope de tiempo.
function runCodex(home: string, args: readonly string[]): Promise<{ readonly exitCode: number | null; readonly stderr: string }> {
  const codex = launch(args);
  const child = spawn(codex.command, [...codex.args], { env: spawnEnv(home, codex.env), stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  return new Promise((resolveRun, rejectRun) => {
    let stderr = '';
    const timer = setTimeout(() => killProcessTree(child, defaultKillTreeDeps()), MIGRATE_TIMEOUT_MS);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); rejectRun(error); });
    child.on('close', (exitCode) => { clearTimeout(timer); resolveRun({ exitCode, stderr }); });
  });
}

// Cliente mínimo de UN app-server para lo que Mage no hace por esta vía: abrir un hilo `legacy` y darle un turno.
class OneShotCodex {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting = new Map<number, (message: Message) => void>();
  private readonly seen: Message[] = [];
  private seq = 0;

  constructor(home: string, cwd: string) {
    const codex = launch(['app-server']);
    this.child = spawn(codex.command, [...codex.args], { cwd, env: spawnEnv(home, codex.env), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stderr.resume();
    createInterface({ input: this.child.stdout }).on('line', (line) => this.receive(line));
  }

  async init(): Promise<void> {
    await this.rpc('initialize', { clientInfo: { name: 'mage-spike', version: '0.1.4' }, capabilities: { experimentalApi: true } });
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);
  }

  async rpc(method: string, params: object): Promise<any> {
    this.seq += 1;
    const id = this.seq;
    const reply = await new Promise<Message>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`sin respuesta a ${method}`)), RPC_TIMEOUT_MS);
      this.waiting.set(id, (message) => { clearTimeout(timer); resolve(message); });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    if (reply.error !== undefined) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
    return reply.result;
  }

  async turn(threadId: string, prompt: string): Promise<void> {
    const started = await this.rpc('turn/start', { threadId, input: [{ type: 'text', text: prompt, text_elements: [] }], ...TURN_PARAMS });
    const turnId = String(started?.turn?.id ?? '');
    const deadline = Date.now() + TURN_TIMEOUT_MS;
    while (!this.seen.some((m) => m.method === 'turn/completed' && m.params?.turn?.id === turnId)) {
      if (Date.now() > deadline) throw new Error(`el turno no termino en ${TURN_TIMEOUT_MS} ms`);
      await sleep(POLL_MS);
    }
  }

  close(): void {
    killProcessTree(this.child, defaultKillTreeDeps());
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
}

// ---------------------------------------------------------------- Montaje

function mountRig(home: string, stateDir: string): Rig {
  return new Rig({
    provider: 'codex', model: MODEL, effort: EFFORT, permissionMode: PERMISSION_MODE,
    adapter: () => new CodexAdapter({ spawnCommand: launch, resolveAccount: (dir) => ({ home: dir, apiKey: null }), resolveInstructions: () => [] }),
    accountDir: home, stateDir, keepAlive: null, virtualTimers: false,
  });
}

const realTemp = (prefix: string): string => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));

function assistantText(live: Live, fromEvent: number): string {
  const texts = live.events.slice(fromEvent).flatMap((e) => (e.event.kind === 'assistant_text' ? [e.event.text] : []));
  return texts.join(' ').trim();
}

const saysOnly = (answer: string, word: string, other: string): boolean => answer.toUpperCase().includes(word) && !answer.toUpperCase().includes(other);

// Pregunta lo mismo que T3 y devuelve lo que contestó el modelo.
async function ask(live: Live): Promise<string> {
  const from = live.events.length;
  await live.turn(ASK_TEXT);
  return assistantText(live, from);
}

async function threadIdOf(rig: Rig, live: Live): Promise<string> {
  await rig.until(() => rig.coordinator.snapshot(live.sessionId).nativeRef !== null, 'id del hilo de Codex', NATIVE_ID_TIMEOUT_MS);
  const ref = rig.coordinator.snapshot(live.sessionId).nativeRef;
  if (ref === null) throw new Error('la sesion de Codex no tiene hilo');
  return ref.nativeId;
}

// ---------------------------------------------------------------- Casos

interface ThreadCase { readonly r1: Rec; readonly f1: Rec }

// r1 (3 turnos) y f1 (1 turno) comparten hilo: el fork sale del hilo vivo ya rebobinado.
async function threadCases(rig: Rig, home: string, cwd: string): Promise<ThreadCase> {
  const history = new CodexHistoryService(FS, noLog);
  const live = rig.open(cwd);
  const r1: Rec = {};
  const f1: Rec = {};
  try {
    await live.turn('Crea a.txt con el texto UNO. Responde solo: hecho');
    await live.turn('Cambia a.txt a DOS. Responde solo: hecho');
    const threadId = await threadIdOf(rig, live);
    const planned = await attempt(() => rig.rewind.plan({ sessionId: live.sessionId, point: live.point(1), action: 'rewind' }));
    r1.planError = planned.ok ? null : planned.error;
    r1.planFilesNull = planned.ok && planned.value.files === null;
    r1.planCanSaveCopy = planned.ok && planned.value.canSaveCopy === true;
    const applied = await attempt(() => rig.rewind.apply({ sessionId: live.sessionId, point: live.point(1), action: 'rewind', restoreFiles: false, saveCopy: false }));
    r1.applyError = applied.ok ? null : applied.error;
    const answer = await ask(live);
    r1.answerIsUno = saysOnly(answer, 'UNO', 'DOS');
    r1.aTxt = existsSync(join(cwd, 'a.txt')) ? readFileSync(join(cwd, 'a.txt'), 'utf8').trim() : null;
    await divergeAndFork(rig, live, f1);
    rig.stop(live);
    await sleep(AFTER_STOP_MS);
    const turns = await attempt(() => codexThreadTurnsList(RPC, home, threadId));
    r1.turnsError = turns.ok ? null : turns.error;
    r1.turnsAfter = turns.ok ? turns.value.length : null;
    await forkQuestionAndDeletes(rig, home, cwd, threadId, history, f1);
  } finally {
    await rig.stopAll();
  }
  return { r1, f1 };
}

// diverge del 1º con el hilo vivo → id del hilo nuevo (U2).
async function divergeAndFork(rig: Rig, live: Live, f1: Rec): Promise<void> {
  const diverged = await attempt(() => rig.rewind.diverge({ sessionId: live.sessionId, point: live.point(0) }));
  f1.divergeError = diverged.ok ? null : diverged.error;
  f1.forkThreadId = diverged.ok && diverged.value.kind === 'codex' ? diverged.value.threadId : null;
}

// El fork reanudado contesta lo mismo que T3; el original no se deja borrar con copias (X-3); al final se borran los dos.
async function forkQuestionAndDeletes(rig: Rig, home: string, cwd: string, threadId: string, history: CodexHistoryService, f1: Rec): Promise<void> {
  const forkId = typeof f1.forkThreadId === 'string' ? f1.forkThreadId : null;
  if (forkId === null) return;
  const deps = { history, deleteThread: (h: string, id: string) => codexThreadDelete(RPC, h, id), forget: (id: string) => rig.state.forgetThread(id), log: noLog };
  const reopened = rig.open(cwd, { resumeSessionId: forkId });
  try {
    f1.forkAnswerIsUno = saysOnly(await ask(reopened), 'UNO', 'DOS');
  } finally {
    rig.stop(reopened);
    await sleep(AFTER_STOP_MS);
  }
  f1.deleteOriginalHasCopies = await hasCopiesError(() => deleteCodexConversation(deps, home, threadId));
  f1.forkDeleted = (await attempt(() => deleteCodexConversation(deps, home, forkId))).ok;
  f1.originalDeleted = (await attempt(() => deleteCodexConversation(deps, home, threadId))).ok;
}

// true si el borrado lanza el `UserFacingError` con `errors.rewind.hasCopies`.
async function hasCopiesError(run: () => Promise<void>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (err) {
    return err instanceof UserFacingError && err.localized.key === 'errors.rewind.hasCopies';
  }
}

// l1 (1 turno): un hilo `legacy` se actualiza con `codex migrate-rollouts`; lo que hace con los rollout está NO MEDIDO: se anotan los nombres.
async function l1Legacy(home: string, cwd: string, backupRoot: string): Promise<Rec> {
  const history = new CodexHistoryService(FS, noLog);
  const out: Rec = {};
  const codex = new OneShotCodex(home, cwd);
  let threadId = '';
  try {
    await codex.init();
    threadId = String((await codex.rpc('thread/start', { cwd, ...TURN_PARAMS, ephemeral: false, historyMode: 'legacy' }))?.thread?.id ?? '');
    await codex.turn(threadId, 'Responde solo: hola');
  } finally {
    codex.close();
    await sleep(AFTER_STOP_MS);
  }
  const names = (): readonly string[] => history.threadFiles(home, threadId).map((file) => basename(file));
  out.historyBefore = history.historyModeOf(home, threadId);
  out.filesBefore = names();
  const updated = await attempt(() => updateLegacyCodexThread({
    history, backupRoot, mkdir: (dir) => { mkdirSync(dir, { recursive: true }); }, copyFile: copyFileSync, runCodex, now: Date.now,
  }, home, threadId));
  out.updateError = updated.ok ? null : updated.error;
  out.backupFiles = updated.ok ? readdirSync(updated.value.backupDir).length : null;
  out.historyAfter = history.historyModeOf(home, threadId);
  out.filesAfter = names();
  out.threadDeleted = (await attempt(() => codexThreadDelete(RPC, home, threadId))).ok;
  return out;
}

export function codexBinary(): string {
  return resolveCodexBinary();
}

export async function run(home: string): Promise<Rec> {
  const cwd = realTemp('mage-k-codex-cwd-');
  const legacyCwd = realTemp('mage-k-codex-legacy-cwd-');
  const stateDir = realTemp('mage-k-codex-state-');
  const backupRoot = realTemp('mage-k-codex-backup-');
  const out: Rec = { modelTurns: 5 };
  try {
    const rig = mountRig(home, stateDir);
    const threads = await threadCases(rig, home, cwd);
    out.r1Rewind = threads.r1;
    out.f1Divergir = threads.f1;
    out.l1Legacy = await l1Legacy(home, legacyCwd, backupRoot);
  } catch (err) {
    out.error = errorText(err);
  } finally {
    out.pendingToDelete = removeTemp([cwd, legacyCwd, stateDir, backupRoot]);
  }
  return out;
}

// `.sandbox` lleva ACL de Codex: lo que no se pueda borrar se anota, no se oculta.
function removeTemp(dirs: readonly string[]): string[] {
  const pending: string[] = [];
  for (const dir of dirs) {
    try {
      rm(dir);
    } catch (err) {
      pending.push(`${basename(dir)}: ${(err as NodeJS.ErrnoException).code ?? String(err)}`);
    }
  }
  return pending;
}
