// Spike de F4.4/F4.5/F4.6 (carril K, punto de control K10): rewind, Reintentar, Divergir y keep-alive de Claude con el
// código REAL de Mage (ClaudeAdapter, AgentSession, SessionManager, SessionCoordinator, RewindCoordinator,
// RewindStateStore, TranscriptService) contra el CLI real de Claude y un servidor Anthropic FALSO: sin cuota, clave
// falsa, carpetas temporales con prefijo `mage-k-`. Lo empaqueta y lo lanza `rewind-claude.mjs`.
// También exporta `Rig` y `Live`, que reutiliza `keepalive-claude-entry.ts` (mismo montaje, con la cuenta real).
// La salida solo lleva booleanos, recuentos y nombres de campo: nunca credenciales ni textos del usuario.
import { existsSync, createReadStream, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CoordinatedState } from '@shared/coordination';
import type { MageEvent } from '@shared/events';
import type { CreateSessionParams, RewindPointRef } from '@shared/ipc';
import { DEFAULT_KEEP_ALIVE, type KeepAliveSettings } from '@shared/settings';
import { ClaudeAdapter } from '../src/main/engine/claudeAdapter';
import { resolveClaudeBinary } from '../src/main/os/claudeBinaryResolver';
import { isKnownPermissionModeFor } from '../src/main/engine/permissionModes';
import type { ProviderAdapter } from '../src/main/engine/providerAdapter';
import { SessionManager } from '../src/main/engine/sessionManager';
import { createSessionFor } from '../src/main/engine/sessionFactory';
import { SessionCoordinator, BACKGROUND_TTL_MS, type SequencedSessionEvent } from '../src/main/coordination/sessionCoordinator';
import { RewindCoordinator } from '../src/main/coordination/rewindCoordinator';
import { claudePrompts } from '../src/main/coordination/rewindPoints';
import { RewindStateStore } from '../src/main/conversations/rewindStateStore';
import { TranscriptService } from '../src/main/transcripts/transcriptService';
import { readActiveBranchEntries } from '../src/main/transcripts/activeBranchReader';
import { resolveTranscriptPath } from '../src/main/transcripts/transcriptPath';
// @ts-expect-error servidor falso en JS, sin tipos
import { startFakeAnthropic } from '../scripts/fake-anthropic-messages.mjs';

export type Rec = Record<string, unknown>;

const FAKE_API_KEY = 'sk-mage-fake';
const MODEL = 'haiku';
const EFFORT = 'low';
const PERMISSION_MODE = 'acceptEdits';
const POLL_MS = 100;
const TURN_TIMEOUT_MS = 120_000;
const KA_TIMER_WAIT_MS = 30_000;
const KA_DONE_WAIT_MS = 120_000;
const AFTER_STOP_MS = 1_500;
const RUNNING_TURN_BUDGET_MS = 12_000;
const KA_OFFSET_MS = 3_600_000; // la hora que se «salta» para que el keep-alive venza ya
// Solo los temporizadores largos (el del keep-alive, ~59 min) son virtuales; los de las peticiones al motor y las esperas a reposo, reales.
const VIRTUAL_TIMER_MIN_MS = 60_000;

// Claude: con servidor falso, una cuenta «por clave de API» con clave falsa (T6); sin él, la cuenta real sin clave.
export const CLAUDE_MOUNT = {
  provider: 'claude', model: MODEL, effort: EFFORT, permissionMode: PERMISSION_MODE,
  adapter: (rig: Rig): ProviderAdapter => new ClaudeAdapter({
    resolveApiKey: () => (rig.fakeUrl === null ? null : FAKE_API_KEY),
    testBaseUrl: () => rig.fakeUrl ?? undefined,
    isPackaged: () => false,
  }),
} as const;

const SHARED = { mcpServers: [], settingsFragment: null, claudeAiConnectors: false } as const;

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 300);

// Una operación cuyo fallo es un DATO del resultado (no se traga: sale en el JSON).
export type Attempt<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };
export async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
}

interface VirtualTimer { readonly fn: () => void; cancelled: boolean; fired: boolean }
interface FakeRequest { readonly messages: readonly string[] }
export interface Fake { readonly url: string; readonly requests: FakeRequest[]; close(): Promise<void> }

export interface RigOptions {
  // Proveedor y su montaje: el adapter de CLI que `createSessionFor` entrega a cada sesión (uno nuevo por sesión).
  readonly provider: string;
  readonly model: string;
  readonly effort: string;
  readonly permissionMode: string;
  readonly adapter: (rig: Rig) => ProviderAdapter;
  // Config dir de la cuenta (el temporal del spike contra el falso, o `~/.claude` en el keep-alive real).
  readonly accountDir: string;
  // Carpeta temporal para `rewind-state.json`.
  readonly stateDir: string;
  readonly keepAlive: KeepAliveSettings | null;
  readonly virtualTimers: boolean;
}

// Una sesión del coordinador con lo que le llega al «oyente de la pestaña».
export class Live {
  readonly events: SequencedSessionEvent[] = [];
  readonly sent: { readonly text: string; readonly commandId: string }[] = [];
  readonly permissionErrors: string[] = [];
  sessionId = '';
  stopped = false;

  constructor(private readonly rig: Rig, readonly cwd: string) {}

  receive(payload: SequencedSessionEvent): void {
    this.events.push(payload);
    const { event } = payload;
    if (event.kind !== 'permission_request') return;
    const { requestId, input } = event.request;
    // Se concede todo lo que pida, como la pestaña con «Permitir».
    setImmediate(() => {
      try {
        this.rig.coordinator.answerPermission(this.sessionId, requestId, { behavior: 'allow', updatedInput: input });
      } catch (err) {
        this.permissionErrors.push(errorText(err));
      }
    });
  }

  state(): CoordinatedState {
    return this.rig.coordinator.snapshot(this.sessionId).state;
  }

  results(): readonly Extract<MageEvent, { kind: 'result' }>['result'][] {
    return this.events.flatMap((e) => (e.event.kind === 'result' ? [e.event.result] : []));
  }

  has(kind: MageEvent['kind']): boolean {
    return this.events.some((e) => e.event.kind === kind);
  }

  // Un mensaje con su `commandId` (= el uuid de la entrada en la transcripción, D-K1) y espera a que acabe el turno.
  async turn(text: string): Promise<string> {
    const commandId = this.fire(text);
    const label = `turno ${this.sent.length}`;
    const before = this.results().length;
    await this.rig.until(() => this.results().length > before && this.state() === 'idle', label, TURN_TIMEOUT_MS);
    return commandId;
  }

  // El envío sin esperar.
  fire(text: string): string {
    const commandId = randomUUID();
    this.sent.push({ text, commandId });
    this.rig.coordinator.send({ sessionId: this.sessionId, text, commandId });
    return commandId;
  }

  // La burbuja `index` (0 = el primer mensaje enviado con `turn`/`fire`) como la identifica el renderer.
  point(index: number): RewindPointRef {
    const sent = this.sent[index];
    if (sent === undefined) throw new Error(`No hay mensaje enviado nº ${index} (hay ${this.sent.length})`);
    return { userIndex: index, text: sent.text, nativeId: sent.commandId };
  }

  transcriptPath(): string {
    return resolveTranscriptPath(this.rig.options.accountDir, this.cwd, this.sessionId);
  }
}

// El montaje de main (index.ts) con dobles solo donde Electron entra: reloj, temporizadores, claves y rutas.
export class Rig {
  readonly state: RewindStateStore;
  readonly coordinator: SessionCoordinator;
  readonly rewind: RewindCoordinator;
  private readonly transcripts: TranscriptService;
  readonly timers: VirtualTimer[] = [];
  readonly logs: { readonly level: string; readonly message: string }[] = [];
  readonly lives: Live[] = [];
  offsetMs = 0;
  // URL del servidor falso de la prueba en curso; null = Claude contra su API de verdad (cuenta real, sin clave de API).
  fakeUrl: string | null = null;

  constructor(readonly options: RigOptions) {
    this.state = new RewindStateStore({
      filePath: join(options.stateDir, 'rewind-state.json'),
      exists: existsSync,
      readFile: (path) => readFileSync(path, 'utf8'),
      writeFile: (path, data) => writeFileSync(path, data, 'utf8'),
      rename: renameSync,
      removeFile: (path) => rmSync(path, { force: true }),
      tempSuffix: () => randomUUID(),
      log: (level, message) => { this.logs.push({ level, message }); },
    });
    const log = (level: string, message: string): void => { this.logs.push({ level, message }); };
    const sessions = new SessionManager(
      (provider, base) => createSessionFor(provider, base, {
        buildAdapter: () => options.adapter(this),
        buildRuntime: (id) => { throw new Error(`El spike no usa el runtime propio (${id})`); },
      }),
      {
        homedir: homedir(), fileExists: existsSync, listHome: () => [], resolveShared: () => SHARED, hasClaudeLogin: () => true,
        isKnownPermissionMode: (provider, mode) => isKnownPermissionModeFor(provider, mode, null),
      },
      log,
    );
    this.coordinator = new SessionCoordinator({
      sessions,
      index: { resolveConversation: (ref) => ({ conversationId: `conv-${ref.nativeId}`, lastSeq: 0 }), recordLastSeq: () => undefined },
      now: () => Date.now() + this.offsetMs,
      log,
      newId: () => randomUUID(),
      alwaysAllowTools: () => [],
      defer: (fn) => queueMicrotask(fn),
      setTimer: (fn, ms) => this.setTimer(fn, ms),
      // Lo mismo que cablea index.ts.
      onUserMessageSent: (ref) => { if (ref.provider === 'claude') this.state.clearPendingCut(ref.nativeId); },
      ...(options.keepAlive === null ? {} : {
        keepAliveSettings: () => options.keepAlive ?? DEFAULT_KEEP_ALIVE,
        isApiKeyAccount: () => false,
        onKeepAliveDone: (ref, sample, rewound, kaUuid) => {
          this.state.recordKeepAlive(ref.nativeId, sample);
          if (rewound) this.state.setPendingCut(ref.nativeId, kaUuid);
        },
      }),
    });
    this.transcripts = new TranscriptService({
      exists: existsSync,
      sizeOf: (path) => (existsSync(path) ? statSync(path).size : -1),
      createReadStream: (path, start) => createReadStream(path, { encoding: 'utf8', ...(start === undefined ? {} : { start }) }),
    });
    this.rewind = new RewindCoordinator({
      coordinator: this.coordinator,
      readClaudeBranch: ({ accountDir, cwd, sessionId, pendingCutUuid }) => this.readBranch(resolveTranscriptPath(accountDir, cwd, sessionId), pendingCutUuid),
      state: this.state,
      newId: () => randomUUID(),
      now: () => Date.now() + this.offsetMs,
      log: (level, message) => { this.logs.push({ level, message }); },
    });
  }

  // La rama activa de una transcripción, con el corte pendiente si lo hay (lo que lee main al rebobinar y al reabrir).
  readBranch(file: string, pendingCutUuid: string | null): ReturnType<typeof readActiveBranchEntries> {
    return readActiveBranchEntries(this.transcripts, file, {
      ...(pendingCutUuid === null ? {} : { pendingCutUuid }),
      onMissingParent: () => { this.logs.push({ level: 'warn', message: 'padre inexistente en la transcripcion' }); },
    });
  }

  private setTimer(fn: () => void, ms: number): () => void {
    if (!this.options.virtualTimers || ms <= VIRTUAL_TIMER_MIN_MS || ms === BACKGROUND_TTL_MS) {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    }
    const virtual: VirtualTimer = { fn, cancelled: false, fired: false };
    this.timers.push(virtual);
    return () => { virtual.cancelled = true; };
  }

  pendingVirtualTimers(): number {
    return this.timers.filter((timer) => !timer.cancelled && !timer.fired).length;
  }

  // Adelanta el reloj y dispara los temporizadores virtuales que había pendientes.
  advance(ms: number): number {
    this.offsetMs += ms;
    const due = this.timers.filter((timer) => !timer.cancelled && !timer.fired);
    for (const timer of due) {
      timer.fired = true;
      timer.fn();
    }
    return due.length;
  }

  open(cwd: string, extra: Partial<CreateSessionParams> = {}, accountDir: string = this.options.accountDir): Live {
    const live = new Live(this, cwd);
    const { provider, model, effort, permissionMode } = this.options;
    const params = { accountDir, model, provider, cwd, effort, permissionMode, ...extra } as CreateSessionParams;
    live.sessionId = this.coordinator.create(params, (payload) => live.receive(payload));
    this.lives.push(live);
    return live;
  }

  // Para su proceso por su PID (`AgentSession.stop` usa el killTree de Mage). Idempotente.
  stop(live: Live): void {
    if (live.stopped) return;
    live.stopped = true;
    this.coordinator.stop(live.sessionId);
  }

  async stopAll(): Promise<void> {
    for (const live of this.lives) this.stop(live);
    await sleep(AFTER_STOP_MS);
  }

  async until(pred: () => boolean, label: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!pred()) {
      if (Date.now() > deadline) throw new Error(`Tiempo agotado (${timeoutMs} ms) esperando: ${label}`);
      await sleep(POLL_MS);
    }
  }
}

// ---------------------------------------------------------------- Utilidades de los casos

const realTemp = (prefix: string): string => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));

// Tamaño en bytes de una carpeta con todo su contenido (0 si no existe).
export function dirBytes(dir: string): { readonly exists: boolean; readonly bytes: number; readonly files: number } {
  if (!existsSync(dir)) return { exists: false, bytes: 0, files: 0 };
  const total = { bytes: 0, files: 0 };
  const pending = [dir];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) {
        total.bytes += statSync(full).size;
        total.files += 1;
      }
    }
  }
  return { exists: true, ...total };
}

// La última petición que el «modelo» recibió y cuyo último mensaje contiene `marker`; null si ninguna.
function lastFor(fake: Fake, marker: string): FakeRequest | null {
  const tag = `T(${marker})`;
  for (let i = fake.requests.length - 1; i >= 0; i -= 1) {
    const request = fake.requests[i];
    if (request !== undefined && (request.messages.at(-1) ?? '').includes(tag)) return request;
  }
  return null;
}

const textOf = (request: FakeRequest | null): string => (request === null ? '' : request.messages.join('\n'));
const readText = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);

interface CaseEnv { readonly cwd: string; readonly fake: Fake }

// Una carpeta de trabajo y un servidor falso propios de cada caso (el falso escribe en SU cwd).
async function withCase<T>(rig: Rig, run: (env: CaseEnv) => Promise<T>): Promise<T> {
  const cwd = realTemp('mage-k-claude-cwd-');
  const fake = (await startFakeAnthropic({ cwd })) as Fake;
  rig.fakeUrl = fake.url;
  try {
    return await run({ cwd, fake });
  } finally {
    await rig.stopAll();
    await fake.close();
    rm(cwd);
  }
}

export function rm(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

const noFiles = { restoreFiles: false, saveCopy: false } as const;

// ---------------------------------------------------------------- Casos

// Rewind de la conversación sin ficheros tras dos turnos con herramienta: mide la regla de `last_seen` (D-K2/§3).
async function c1Conversacion(rig: Rig): Promise<Rec> {
  return withCase(rig, async ({ cwd, fake }) => {
    const live = rig.open(cwd);
    await live.turn('WRITE a.txt UNO');
    await live.turn('WRITE a.txt DOS');
    const applied = await attempt(() => rig.rewind.apply({ sessionId: live.sessionId, point: live.point(1), action: 'rewind', ...noFiles }));
    await live.turn('ECO tras');
    const request = textOf(lastFor(fake, 'ECO tras'));
    return {
      applyError: applied.ok ? null : applied.error,
      staleTarget: !applied.ok && applied.error.includes('stale_target'),
      draftMatches: applied.ok && applied.value.draft === 'WRITE a.txt DOS',
      lastRequestHasUno: request.includes('UNO'),
      lastRequestHasDos: request.includes('DOS'),
      aTxt: readText(join(cwd, 'a.txt')),
      permissionErrors: live.permissionErrors.length,
    };
  });
}

// El plan lista los ficheros del punto y `restoreFiles` los devuelve a su estado.
async function c2Ficheros(rig: Rig): Promise<Rec> {
  return withCase(rig, async ({ cwd }) => {
    const live = rig.open(cwd);
    await live.turn('WRITE a.txt UNO');
    await live.turn('WRITE a.txt DOS');
    const planned = await attempt(() => rig.rewind.plan({ sessionId: live.sessionId, point: live.point(1), action: 'rewind' }));
    const files = planned.ok ? planned.value.files : null;
    const applied = await attempt(() => rig.rewind.apply({ sessionId: live.sessionId, point: live.point(1), action: 'rewind', restoreFiles: true, saveCopy: false }));
    return {
      planError: planned.ok ? null : planned.error,
      filesAvailable: files?.available === true,
      changedHasATxt: files?.changed.some((file) => file.endsWith('a.txt')) === true,
      changedCount: files?.changed.length ?? null,
      applyError: applied.ok ? null : applied.error,
      filesRestored: applied.ok && applied.value.filesRestored,
      aTxt: readText(join(cwd, 'a.txt')),
    };
  });
}

// Lo que escribe Bash no está en los puntos de control: ni el plan lo lista ni el rewind lo deshace.
async function c3Bash(rig: Rig): Promise<Rec> {
  return withCase(rig, async ({ cwd }) => {
    const live = rig.open(cwd);
    await live.turn('SHELLWRITE b.txt X');
    await live.turn('ECO y');
    const planned = await attempt(() => rig.rewind.plan({ sessionId: live.sessionId, point: live.point(0), action: 'rewind' }));
    const files = planned.ok ? planned.value.files : null;
    const applied = await attempt(() => rig.rewind.apply({ sessionId: live.sessionId, point: live.point(0), action: 'rewind', restoreFiles: files?.available === true, saveCopy: false }));
    return {
      planError: planned.ok ? null : planned.error,
      filesAvailable: files?.available === true,
      planListsBTxt: files?.changed.some((file) => file.endsWith('b.txt')) === true,
      applyError: applied.ok ? null : applied.error,
      bTxt: readText(join(cwd, 'b.txt')),
      permissionErrors: live.permissionErrors.length,
    };
  });
}

// Rewind con el turno en marcha: se interrumpe y termina sin error dentro del presupuesto.
async function c4TurnoEnMarcha(rig: Rig): Promise<Rec> {
  return withCase(rig, async ({ cwd }) => {
    const live = rig.open(cwd);
    live.fire('SLEEP');
    // «Sin esperar» al final del turno: basta con que el CLI ya lo haya empezado (su primer `tool_use`), para que el mensaje esté en la transcripción.
    await rig.until(() => live.has('tool_use'), 'tool_use de SLEEP', TURN_TIMEOUT_MS);
    const busyBefore = live.state() !== 'idle';
    const startedAt = Date.now();
    const applied = await attempt(() => rig.rewind.apply({ sessionId: live.sessionId, point: live.point(0), action: 'rewind', ...noFiles }));
    const ms = Date.now() - startedAt;
    const idle = (await attempt(() => rig.until(() => live.state() === 'idle', 'reposo tras el rewind', 5_000))).ok;
    return { busyBefore, applyError: applied.ok ? null : applied.error, ms, withinBudget: ms < RUNNING_TURN_BUDGET_MS, idleAfter: idle };
  });
}

// Reintentar: rebobina el 2º y lo reenvía; el «modelo» no ve la respuesta vieja.
async function c5Reintentar(rig: Rig): Promise<Rec> {
  return withCase(rig, async ({ cwd, fake }) => {
    const live = rig.open(cwd);
    await live.turn('ECO uno');
    await live.turn('ECO dos');
    const before = live.results().length;
    const applied = await attempt(() => rig.rewind.apply({ sessionId: live.sessionId, point: live.point(1), action: 'retry', ...noFiles }));
    if (applied.ok) await rig.until(() => live.results().length > before && live.state() === 'idle', 'turno reenviado', TURN_TIMEOUT_MS);
    const request = textOf(lastFor(fake, 'ECO dos'));
    return {
      applyError: applied.ok ? null : applied.error,
      retriedStatus: applied.ok ? applied.value.retried?.status ?? null : null,
      lastRequestEndsWithSecond: request.length > 0,
      oldAnswerPresent: request.includes('ECO: ECO dos'),
      firstAnswerPresent: request.includes('ECO: ECO uno'),
    };
  });
}

// Divergir: otra sesión nace de la hoja del 1º con el id que elige Mage, y la original no cambia.
async function c6Divergir(rig: Rig): Promise<Rec> {
  return withCase(rig, async ({ cwd, fake }) => {
    const live = rig.open(cwd);
    await live.turn('ECO uno');
    await live.turn('ECO dos');
    const originalBefore = readText(live.transcriptPath());
    const diverged = await attempt(() => rig.rewind.diverge({ sessionId: live.sessionId, point: live.point(0) }));
    if (!diverged.ok || diverged.value.kind !== 'claude') return { divergeError: diverged.ok ? `resultado de otro proveedor (${diverged.value.kind})` : diverged.error };
    const forked = rig.open(cwd, { forkFrom: diverged.value.forkFrom });
    await forked.turn('ECO rama');
    const request = textOf(lastFor(fake, 'ECO rama'));
    return {
      divergeError: null,
      forkHasFirst: request.includes('ECO uno'),
      forkHasFirstAnswer: request.includes('ECO: ECO uno'),
      forkHasSecond: request.includes('ECO dos'),
      forkIdIsMages: forked.sessionId !== live.sessionId && existsSync(forked.transcriptPath()),
      originalUnchanged: originalBefore !== null && originalBefore === readText(live.transcriptPath()),
    };
  });
}

// NO MEDIDO en 040/046: ¿reabrir con `--resume` tras un rewind sin mensaje nuevo respeta el corte? Es un dato, no un fallo.
async function c7ReabrirTrasRewind(rig: Rig): Promise<Rec> {
  return withCase(rig, async ({ cwd, fake }) => {
    const live = rig.open(cwd);
    await live.turn('ECO uno');
    await live.turn('ECO dos');
    const second = live.point(1);
    const applied = await attempt(() => rig.rewind.apply({ sessionId: live.sessionId, point: second, action: 'rewind', ...noFiles }));
    if (!applied.ok) return { applyError: applied.error };
    const cut = rig.state.pendingCut(live.sessionId);
    const branch = await attempt(() => rig.readBranch(live.transcriptPath(), cut));
    rig.stop(live);
    await sleep(AFTER_STOP_MS);
    const reopened = rig.open(cwd, { resumeSessionId: live.sessionId });
    await reopened.turn('ECO reabierta');
    const request = textOf(lastFor(fake, 'ECO reabierta'));
    return {
      applyError: null,
      pendingCutSaved: cut !== null,
      branchError: branch.ok ? null : branch.error,
      branchHasSecond: branch.ok && claudePrompts(branch.value).some((prompt) => prompt.uuid === second.nativeId),
      resumeHasFirst: request.includes('ECO uno'),
      resumeFollowsCut: request.length > 0 && !request.includes('ECO dos'),
    };
  });
}

// Keep-alive contra el falso: el reloj salta una hora, el KA sale oculto, se retira con su rewind y el siguiente turno no lo ve.
async function c8KeepAliveFalso(accountDir: string, stateDir: string): Promise<Rec> {
  const rig = new Rig({ ...CLAUDE_MOUNT, accountDir, stateDir, keepAlive: { ...DEFAULT_KEEP_ALIVE, minContextTokens: 0 }, virtualTimers: true });
  try {
    return await withCase(rig, async ({ cwd, fake }) => {
      const live = rig.open(cwd);
      await live.turn('ECO base');
      const timerRegistered = (await attempt(() => rig.until(() => rig.pendingVirtualTimers() > 0, 'temporizador del keep-alive', KA_TIMER_WAIT_MS))).ok;
      if (!timerRegistered) return { timerRegistered, hint: 'el keep-alive no se programo: ¿llego context_usage?' };
      const eventsBefore = live.events.length;
      rig.advance(KA_OFFSET_MS);
      const done = await attempt(() => rig.until(() => rig.state.keepAliveTotals().count === 1, 'registro del keep-alive', KA_DONE_WAIT_MS));
      await sleep(POLL_MS * 5);
      const eventsDuringKa = live.events.length - eventsBefore;
      await live.turn('ECO despues');
      const after = textOf(lastFor(fake, 'ECO despues'));
      const kaPrompt = 'T(Responde solo: ok)';
      return {
        timerRegistered,
        keepAliveRecorded: done.ok,
        doneError: done.ok ? null : done.error,
        eventsDuringKa,
        fakeReceivedKa: fake.requests.filter((request) => request.messages.some((message) => message.includes(kaPrompt))).length,
        afterRequestHasKa: after.includes('Responde solo: ok'),
        totalsCount: rig.state.keepAliveTotals().count,
        disabledNotice: live.events.some((e) => e.event.kind === 'notice'),
      };
    });
  } finally {
    await rig.stopAll();
  }
}

// ---------------------------------------------------------------- Entrada

export function claudeBinary(): string {
  return resolveClaudeBinary();
}

export async function run(): Promise<Rec> {
  const cfg = realTemp('mage-k-claude-cfg-');
  const stateDir = realTemp('mage-k-claude-state-');
  mkdirSync(join(cfg, 'projects'), { recursive: true });
  writeFileSync(join(cfg, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true }));
  const rig = new Rig({ ...CLAUDE_MOUNT, accountDir: cfg, stateDir, keepAlive: null, virtualTimers: false });
  try {
    const casos: Rec = {};
    casos.c1Conversacion = await c1Conversacion(rig);
    casos.c2Ficheros = await c2Ficheros(rig);
    casos.c3Bash = await c3Bash(rig);
    casos.c4TurnoEnMarcha = await c4TurnoEnMarcha(rig);
    casos.c5Reintentar = await c5Reintentar(rig);
    casos.c6Divergir = await c6Divergir(rig);
    casos.c7ReabrirTrasRewind = await c7ReabrirTrasRewind(rig);
    casos.t1Disco = dirBytes(join(cfg, 'file-history'));
    casos.c8KeepAliveFalso = await c8KeepAliveFalso(cfg, stateDir);
    return { casos };
  } finally {
    await rig.stopAll();
    rm(cfg);
    rm(stateDir);
  }
}
