import type { ImageAttachment } from '@shared/ipc';
import { RUNTIME_PERMISSION_MODES, type RuntimePermissionMode } from '@shared/providers';
import type { MageEvent, PermissionDecision, TurnUsage } from '@shared/events';
import type { ManagedSession } from '../engine/sessionManager';
import type { SessionLogFn } from '../engine/agentSession';
import { runTurn, type Authorization, type LoopEvent, type LoopTools, type PreparedCall, type TurnOutcome } from './agentLoop';
import type { ChatClient, ChatMessage } from './chatClient';
import { loopToMageEvents } from './loopToMageEvents';

// Una sesion del runtime propio (P-032): implementa `ManagedSession`, asi que el `SessionManager` y la
// UI la tratan igual que a un CLI. Guarda el historial, encola los mensajes que llegan con un turno en
// curso, lleva el `AbortController` del turno y los permisos pendientes.
//
// ponytail: corre en el hilo de `main` (todo es E/S asincrona; los comandos son procesos hijo). Si alguna
// vez se mide un bloqueo (Glob/Grep sobre un arbol enorme), se mueve `runTurn` a un `utilityProcess` sin
// cambiar estos contratos.

export { RUNTIME_PERMISSION_MODES, type RuntimePermissionMode };

export function isRuntimePermissionMode(mode: string): mode is RuntimePermissionMode {
  return (RUNTIME_PERMISSION_MODES as readonly string[]).includes(mode);
}

export type GateVerdict = { readonly verdict: 'allow' } | { readonly verdict: 'ask' } | { readonly verdict: 'deny'; readonly reason: string };

// Lo que el runtime registra de un turno para la transcripcion (R4). Opcional: sin el, nada se escribe.
export interface TurnRecorder {
  user(text: string): void;
  loop(event: LoopEvent): void;
  // Mensajes nuevos que dejo el turno en el historial (para reanudar con lo mismo que vio el modelo).
  turnEnd(added: readonly ChatMessage[], outcome: TurnOutcome): void;
  reset(newSessionId: string): void;
  rename(title: string): void;
}

export interface RuntimeSessionDeps {
  readonly sessionId: string;
  readonly model: string;
  readonly permissionMode: RuntimePermissionMode;
  readonly client: ChatClient;
  readonly tools: LoopTools & { names(): readonly string[] };
  readonly gate: (call: PreparedCall, mode: RuntimePermissionMode) => GateVerdict;
  // Se construye en cada turno (fecha, notas del proyecto).
  readonly systemPrompt: () => string;
  readonly emit: (event: MageEvent) => void;
  readonly now: () => number;
  readonly newId: () => string;
  readonly toolsEnabled: boolean;
  readonly history?: readonly ChatMessage[]; // al reanudar (R4)
  readonly fit?: (messages: readonly ChatMessage[]) => readonly ChatMessage[];
  readonly recorder?: TurnRecorder;
  // Tras cada turno: el `context_usage` (R5). Ausente = no se emite.
  readonly contextUsage?: (messages: readonly ChatMessage[], outcome: TurnOutcome) => MageEvent | null;
  readonly log?: SessionLogFn;
}

interface PendingPermission {
  readonly toolUseId: string;
  readonly resolve: (decision: Authorization) => void;
}

const CLEAR_COMMAND = '/clear';
const RENAME_COMMAND = /^\/rename\s+(\S.*)$/s;

export class RuntimeSession implements ManagedSession {
  private sessionId: string;
  private model: string;
  private mode: RuntimePermissionMode;
  private toolsEnabled: boolean;
  private history: ChatMessage[];
  private readonly queue: string[] = [];
  private readonly pending = new Map<string, PendingPermission>();
  private turn: AbortController | null = null;
  private draining = false;
  private started = false;
  private stopped = false;

  constructor(private readonly deps: RuntimeSessionDeps) {
    this.sessionId = deps.sessionId;
    this.model = deps.model;
    this.mode = deps.permissionMode;
    this.toolsEnabled = deps.toolsEnabled;
    this.history = [...(deps.history ?? [])];
  }

  get currentModel(): string {
    return this.model;
  }

  start(): void {
    if (this.started) throw new Error(`La sesion del runtime ${this.sessionId} ya estaba arrancada`);
    this.started = true;
    this.emitInit();
    this.deps.emit({ kind: 'session_state', state: 'idle' });
  }

  sendUserMessage(text: string, attachments: readonly ImageAttachment[] = []): void {
    if (this.stopped) throw new Error(`La sesion del runtime ${this.sessionId} esta parada`);
    if (attachments.length > 0) {
      throw new Error(`El runtime propio no admite imagenes adjuntas todavia (se intentaron enviar ${attachments.length})`);
    }
    this.queue.push(text);
    if (!this.draining) void this.drain();
  }

  answerPermission(requestId: string, decision: PermissionDecision): void {
    const entry = this.pending.get(requestId);
    if (entry === undefined) throw new Error(`Permiso inexistente o ya contestado: ${requestId}`);
    this.pending.delete(requestId);
    entry.resolve(decision.behavior === 'allow' ? decision : { behavior: 'deny', message: decision.message, byUser: true });
  }

  interrupt(): void {
    this.turn?.abort();
    this.cancelPermissions();
  }

  setModel(model: string): void {
    const trimmed = model.trim();
    if (trimmed.length === 0) throw new Error(`Modelo vacio para la sesion ${this.sessionId}`);
    this.model = trimmed; // aplica al siguiente turno
  }

  setPermissionMode(mode: string): void {
    if (!isRuntimePermissionMode(mode)) {
      throw new Error(`Modo de permiso invalido para el runtime: ${JSON.stringify(mode)} (validos: ${RUNTIME_PERMISSION_MODES.join(', ')})`);
    }
    this.mode = mode;
    this.deps.emit({ kind: 'permission_mode', mode });
  }

  stopTask(taskId: string): void {
    throw new Error(`El runtime propio no tiene subagentes que parar (tarea ${JSON.stringify(taskId)})`);
  }

  // Idempotente: abortar, vaciar la cola y retirar los permisos pendientes.
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.queue.length = 0;
    this.interrupt();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      for (let text = this.queue.shift(); text !== undefined && !this.stopped; text = this.queue.shift()) {
        const rename = RENAME_COMMAND.exec(text.trim());
        if (text.trim() === CLEAR_COMMAND) this.resetConversation();
        else if (rename !== null) this.rename(rename[1]!.trim());
        else await this.runOne(text);
      }
    } finally {
      this.draining = false;
    }
  }

  private async runOne(text: string): Promise<void> {
    const controller = new AbortController();
    this.turn = controller;
    this.deps.emit({ kind: 'session_state', state: 'running' });
    const before = this.history.length;
    try {
      this.history.push({ role: 'user', content: text });
      this.deps.recorder?.user(text);
      const outcome = await runTurn(
        { model: this.model, system: this.deps.systemPrompt(), history: this.history, signal: controller.signal, toolsEnabled: this.toolsEnabled },
        this.loopDeps(),
      );
      this.toolsEnabled = outcome.toolsEnabled;
      this.deps.recorder?.turnEnd(this.history.slice(before), outcome);
      this.finishTurn(outcome);
    } catch (err) {
      // Un fallo inesperado (no del modelo: del registro, del escritor…) no mata la sesion.
      const message = err instanceof Error ? err.message : String(err);
      this.deps.log?.('error', 'Fallo inesperado en un turno del runtime', { sessionId: this.sessionId, message });
      this.deps.emit({ kind: 'error', message: `Fallo inesperado del runtime: ${message}` });
      this.deps.emit({ kind: 'result', result: { isError: true, subtype: 'error_during_execution', numTurns: null } });
    } finally {
      this.turn = null;
      this.cancelPermissions();
      this.deps.emit({ kind: 'session_state', state: 'idle' });
    }
  }

  private finishTurn(outcome: TurnOutcome): void {
    if (outcome.error !== null) this.deps.emit({ kind: 'error', message: outcome.error });
    const usage = toTurnUsage(outcome);
    this.deps.emit({
      kind: 'result',
      result: {
        isError: outcome.status === 'error',
        subtype: outcome.status === 'error' ? 'error_during_execution' : outcome.status,
        numTurns: outcome.rounds,
        ...(usage === null ? {} : { usage }),
      },
    });
    const context = this.deps.contextUsage?.(this.history, outcome) ?? null;
    if (context !== null) this.deps.emit(context);
  }

  private loopDeps() {
    return {
      client: this.deps.client,
      tools: this.deps.tools,
      authorize: (call: PreparedCall, signal: AbortSignal) => this.authorize(call, signal),
      fit: this.deps.fit ?? ((messages: readonly ChatMessage[]) => messages),
      emit: (event: LoopEvent) => {
        this.deps.recorder?.loop(event);
        for (const mage of loopToMageEvents(event)) this.deps.emit(mage);
      },
      now: this.deps.now,
      newId: this.deps.newId,
    };
  }

  private authorize(call: PreparedCall, signal: AbortSignal): Promise<Authorization> {
    const gate = this.deps.gate(call, this.mode);
    if (gate.verdict === 'allow') return Promise.resolve({ behavior: 'allow' });
    if (gate.verdict === 'deny') return Promise.resolve({ behavior: 'deny', message: gate.reason, byUser: false });
    if (signal.aborted) return Promise.resolve({ behavior: 'deny', message: 'turno interrumpido', byUser: false });
    const requestId = this.deps.newId();
    return new Promise<Authorization>((resolve) => {
      this.pending.set(requestId, {
        toolUseId: call.id,
        resolve: (decision) => {
          if (!this.stopped) this.deps.emit({ kind: 'session_state', state: 'running' });
          resolve(decision);
        },
      });
      this.deps.emit({
        kind: 'permission_request',
        request: {
          requestId,
          toolUseId: call.id,
          toolName: call.name,
          input: call.input,
          description: null,
          requiresUserInteraction: false,
          displayName: null,
        },
      });
      this.deps.emit({ kind: 'session_state', state: 'requires_action' });
    });
  }

  // Al interrumpir o parar: cada permiso pendiente se retira (la tarjeta pasa a cancelada) y el bucle
  // recibe un «deny» que no llega a ejecutar nada (el turno ya esta abortado).
  private cancelPermissions(): void {
    for (const [requestId, entry] of [...this.pending]) {
      this.pending.delete(requestId);
      this.deps.emit({ kind: 'permission_cancelled', requestId });
      entry.resolve({ behavior: 'deny', message: 'turno interrumpido', byUser: false });
    }
  }

  // `/rename <titulo>`: el `custom-title` va a la transcripcion, como lo hace el CLI. Sin turno.
  private rename(title: string): void {
    this.deps.recorder?.rename(title);
    this.deps.emit({ kind: 'local_command_output', command: 'rename', args: title, text: '' });
  }

  // `/clear`: conversacion nueva en la misma sesion, sin gastar nada.
  private resetConversation(): void {
    const newSessionId = this.deps.newId();
    this.history = [];
    this.sessionId = newSessionId;
    this.deps.recorder?.reset(newSessionId);
    this.deps.emit({ kind: 'conversation_reset', newSessionId });
    this.emitInit();
  }

  private emitInit(): void {
    this.deps.emit({
      kind: 'session_init',
      sessionId: this.sessionId,
      model: this.model,
      tools: this.toolsEnabled ? this.deps.tools.names() : [],
      mcpServers: [],
      slashCommands: ['clear', 'rename'],
      skills: [],
      plugins: [],
      pluginErrors: [],
    });
  }
}

function toTurnUsage(outcome: TurnOutcome): TurnUsage | null {
  if (outcome.usage === null) return null;
  const { inputTokens, outputTokens } = outcome.usage;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, thinkingTokens: null, cacheReadTokens: null };
}
