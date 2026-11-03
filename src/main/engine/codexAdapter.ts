import type { ImageAttachment } from '@shared/ipc';
import type { MageEvent, PermissionDecision } from '@shared/events';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import { parseElicitationRequest, validateElicitationAnswer, type ElicitationAnswer, type ElicitationRequest } from '@shared/elicitation';
import { parseCodexPermissionPreset } from '@shared/codexPermissions';
import { resolveCodexBinary, type CodexSpawnCommand } from '../os/codexBinaryResolver';
import { MAGE_MCP_CALLER_ENV } from '../host/mcpCallers';
import { scrubAgentEnv } from '../os/agentEnv';
import { toCodexOverrides } from '../config/mcpProviderTranslate';
import { bridgeDocument, type BridgedFile } from '../instructions/instructionsBridge';
import type { AuthModel, EngineRequest, LaunchParams, PermissionRef, ProviderAdapter, SpawnPlan, SteerEncoding } from './providerAdapter';
import {
  approvalRequest,
  approvalResult,
  isRecord,
  modelsEvent,
  normalizeNotification,
  rateLimitEvents,
  contextUsageOf,
  trackTokenUsage,
  EMPTY_USAGE_TRACKER,
  type CodexUsageTracker,
} from './codexProtocol';

// Adapter de Codex (CLI de OpenAI) sobre `codex app-server`: JSON-RPC 2.0 por stdio, una linea por
// mensaje, proceso PERSISTENTE. Es el unico CLI que pide permiso por protocolo como Claude: las
// peticiones `item/*/requestApproval` pasan por los dialogos de Mage (decision nº 2).
//
// Medido con cuenta ChatGPT contra codex-cli 0.160.0 (spike/codex-spike.mjs --verify --real):
// deltas, items, uso, aprobaciones de comando/edicion, corte y resume tras reiniciar. El handshake
// habilita experimentalApi porque los perfiles de permisos lo exigen en esta version.
//
// Ciclo: al lanzar se encola `initialize`; con su respuesta, `initialized` + `thread/start` (o
// `thread/resume` en un relanzado) + el catalogo y los limites. Los mensajes del usuario que lleguen
// antes de tener hilo se encolan y salen como `turn/start` en cuanto hay `threadId`.

// Cuenta de Codex resuelta en main: su CODEX_HOME y, si es de API, su clave (boveda).
export interface CodexAccount {
  readonly home: string;
  readonly apiKey: string | null;
}

export interface CodexAdapterDeps {
  readonly resolveBinary?: () => string;
  // Cómo lanzar `codex <args>` (main pasa `codexSpawnCommand`, con la guarda de `app.isPackaged`). Sin él, `resolveBinary`.
  readonly spawnCommand?: (args: readonly string[]) => CodexSpawnCommand;
  // La cuenta de Codex cuyo CODEX_HOME es `accountDir`, o null (la sesion por defecto, `~/.codex`).
  readonly resolveAccount?: (accountDir: string) => CodexAccount | null;
  // Puente de instrucciones (grupo H): los CLAUDE.md que codex no tiene como suyos, para el cwd y el
  // CODEX_HOME (null = el de por defecto). Lo lee main: el adapter no toca el disco.
  readonly resolveInstructions?: (cwd: string, codexHome: string | null) => readonly BridgedFile[];
}

// Medido en 0.144.4: el app-server NO lee `CODEX_API_KEY`/`OPENAI_API_KEY` del entorno («Missing
// bearer»), pero un proveedor propio con `env_key` SI manda la clave («Incorrect API key provided»).
// Asi la clave de una cuenta de API va por el entorno y nunca a su `auth.json`. La variable lleva KEY en
// el nombre: la politica de entorno por defecto de codex no la pasa a los comandos (sin verificar).
export const CODEX_API_KEY_ENV = 'MAGE_CODEX_API_KEY';
const API_PROVIDER_ARGS: readonly string[] = [
  '-c',
  `model_providers.mage-openai={name="OpenAI",base_url="https://api.openai.com/v1",env_key="${CODEX_API_KEY_ENV}",wire_api="responses"}`,
  '-c',
  'model_provider="mage-openai"',
];

// Puente de instrucciones, MEDIDO sin cuenta contra un servidor Responses falso (codex-cli 0.144.4,
// `spike/codex-spike.mjs --instructions`):
//   - el CLAUDE.md del PROYECTO lo lee el propio codex con este fallback, como si fuera su AGENTS.md
//     («# AGENTS.md instructions for <cwd>») y solo en la carpeta que no tenga AGENTS.md;
//   - el GLOBAL va en `developerInstructions` de `thread/start` (un mensaje developer). En
//     `thread/resume` el hilo conserva las suyas y las nuevas se ignoran, asi que solo se mandan al empezar.
// ponytail: el `-c` pisa un `project_doc_fallback_filenames` que el usuario tenga en su config.toml; solo
// se pasa cuando hay puente. Si molesta, leer su valor y sumarle CLAUDE.md.
const PROJECT_FALLBACK_ARGS: readonly string[] = ['-c', 'project_doc_fallback_filenames=["CLAUDE.md"]'];

const CLIENT_INFO = { name: 'mage', title: 'Mage', version: '0.1.2' } as const;
// `on-request`: el modelo pide aprobacion cuando sale del sandbox (medido: en una carpeta sin confianza
// el sandbox queda en solo lectura, asi que escribir pide permiso).
const APPROVAL_POLICY = 'on-request';
const JSONRPC_METHOD_NOT_FOUND = -32601;
// Rechazo de `turn/steer` (medido en 0.164.0): sin turno activo o con otro turno activo; el turno ya no es el nuestro.
const JSONRPC_INVALID_REQUEST = -32600;
const STALE_STEER_MESSAGES: readonly string[] = ['no active turn to steer', 'expected active turn id'];
// Ids de las peticiones propias de Mage, para reconocer su respuesta.
type OwnRequest = 'initialize' | 'thread' | 'turn' | 'models' | 'rateLimits' | 'steer' | 'engine' | 'other';

interface PendingApproval {
  readonly rawId: unknown;
  readonly method: string;
  readonly params: unknown;
}

export class CodexAdapter implements ProviderAdapter {
  // El login lo hace el propio CLI (`account/login/start`, orquestado por main) y Mage nunca ve el token.
  readonly auth: AuthModel = { kind: 'external', reason: 'codex guarda su sesión en su CODEX_HOME; Mage solo orquesta el inicio de sesión' };

  private outgoing: unknown[] = [];
  private nextId = 0;
  private readonly own = new Map<number, OwnRequest>();
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly elicitations = new Map<string, { readonly rawId: unknown; readonly request: ElicitationRequest }>();
  private readonly fileChanges = new Map<string, readonly unknown[]>();
  private threadId: string | null = null;
  private turnId: string | null = null;
  // `turn/start` mandado y sin respuesta todavia: un directo espera a tener el id del turno.
  private turnStarting = false;
  private heldSteers: Array<{ readonly messageId: string; readonly input: unknown[] }> = [];
  // id JSON-RPC de cada `turn/steer` -> id del directo de Mage.
  private readonly steerRequests = new Map<number, string>();
  // id JSON-RPC de cada peticion al motor -> requestId de Mage.
  private readonly engineRequests = new Map<number, string>();
  private usage: CodexUsageTracker = EMPTY_USAGE_TRACKER;
  private queuedInputs: Array<{ readonly input: unknown[]; readonly messageId: string | undefined }> = [];
  private params: LaunchParams | null = null;
  private model = '';
  private effort: string | null = null;
  private permissionProfile: string | null = null;
  private apiKey: string | null = null;
  private secrets: readonly string[] = [];
  private developerInstructions: string | null = null;

  constructor(private readonly deps: CodexAdapterDeps = {}) {}

  // Proceso nuevo: se olvida el estado del anterior y se encola el handshake.
  buildSpawnPlan(params: LaunchParams): SpawnPlan {
    this.resetProcess(params);
    const account = this.deps.resolveAccount?.(params.accountDir) ?? null;
    this.apiKey = account?.apiKey ?? null;
    const mcp = toCodexOverrides(params.shared?.mcpServers ?? []);
    const caller = params.shared?.mageCaller;
    this.secrets = [...new Set([this.apiKey ?? '', caller?.credential ?? '', ...Object.values(mcp.env)].filter((value) => value.length > 0))];
    const bridged = this.deps.resolveInstructions?.(params.cwd, account?.home ?? null) ?? [];
    const userFiles = bridged.filter((file) => file.scope === 'user');
    this.developerInstructions = [
      ...(userFiles.length === 0 ? [] : [bridgeDocument(userFiles)]),
      ...(params.projectInstructions === undefined ? [] : [`# Mage project instructions\n${params.projectInstructions}`]),
    ].join('\n\n') || null;
    const fallback = bridged.some((file) => file.scope === 'project') ? PROJECT_FALLBACK_ARGS : [];
    // Codex solo pasa a un servidor MCP stdio las variables de su lista `env_vars` (lo mismo que hace
    // `toCodexOverrides` con los secretos de los MCP compartidos). Sin `mage` registrado no se anade: un
    // `mcp_servers.mage` sin comando haria fallar el arranque.
    const callerArgs = caller?.forwardToCodexMcp === true ? ['-c', `mcp_servers.mage.env_vars=["${MAGE_MCP_CALLER_ENV}"]`] : [];
    const args = ['app-server', ...mcp.args, ...callerArgs, ...fallback, ...(this.apiKey === null ? [] : API_PROVIDER_ARGS)];
    const env: NodeJS.ProcessEnv = {
      ...scrubAgentEnv(process.env),
      ...mcp.env,
      ...(caller === undefined ? {} : { [MAGE_MCP_CALLER_ENV]: caller.credential }),
      ...(account === null ? {} : { CODEX_HOME: account.home }),
      ...(this.apiKey === null ? {} : { [CODEX_API_KEY_ENV]: this.apiKey }),
    };
    // 0.160.0 rechaza thread/start.permissions sin esta capacidad: perfiles y MCP son experimentales.
    this.request('initialize', { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true } }, 'initialize');
    const launch = this.deps.spawnCommand?.(args) ?? { command: (this.deps.resolveBinary ?? resolveCodexBinary)(), args, env: {} };
    return { command: launch.command, args: launch.args, env: { ...env, ...launch.env } };
  }

  private resetProcess(params: LaunchParams): void {
    this.params = params;
    this.model = this.model.length === 0 ? params.model : this.model;
    this.effort ??= params.effort ?? '';
    this.permissionProfile ??= params.permissionMode ?? null;
    this.outgoing = [];
    this.own.clear();
    this.approvals.clear();
    this.elicitations.clear();
    this.fileChanges.clear();
    this.threadId = null;
    this.turnId = null;
    this.turnStarting = false;
    this.heldSteers = [];
    this.steerRequests.clear();
    this.engineRequests.clear();
    this.usage = EMPTY_USAGE_TRACKER;
  }

  takeOutgoing(): readonly unknown[] {
    const messages = this.outgoing;
    this.outgoing = [];
    return messages;
  }

  // Sin hilo todavia, el mensaje espera: sale como `turn/start` en cuanto `thread/start` conteste.
  encodeUserMessage(text: string, attachments: readonly ImageAttachment[] = [], messageId?: string): unknown {
    const input = buildInput(text, attachments);
    if (this.threadId === null) {
      this.queuedInputs.push({ input, messageId });
      return null;
    }
    this.startTurn(input, messageId);
    return null;
  }

  // Directo (F4.1): `turn/steer` contra el turno en marcha. Con `turn/start` aun sin respuesta, espera al
  // id del turno; sin turno, no hay a donde entrar y lo decide quien lo pidio (T3: va como mensaje normal).
  encodeSteer(messageId: string, text: string, attachments: readonly ImageAttachment[] = []): SteerEncoding {
    const input = buildInput(text, attachments);
    if (this.threadId !== null && this.turnId !== null) {
      this.sendSteer(messageId, input);
      return { kind: 'write', payload: null };
    }
    if (!this.turnStarting) return { kind: 'resolved', outcome: 'no_active_turn' };
    this.heldSteers.push({ messageId, input });
    return { kind: 'write', payload: null };
  }

  encodePermissionResponse(ref: PermissionRef, decision: PermissionDecision): unknown {
    const pending = this.approvals.get(ref.requestId);
    if (pending === undefined) throw new UserFacingError(localized('errors.engine.codexApprovalUnknown', { requestId: ref.requestId }));
    this.approvals.delete(ref.requestId);
    return { jsonrpc: '2.0', id: pending.rawId, result: approvalResult(pending.method, pending.params, decision.behavior === 'allow') };
  }

  encodeElicitationResponse(answer: ElicitationAnswer): unknown {
    const pending = this.elicitations.get(answer.requestId);
    if (pending === undefined) throw new UserFacingError(localized('errors.engine.elicitationUnknown', { requestId: answer.requestId }));
    if (!validateElicitationAnswer(pending.request, answer)) throw new Error('Respuesta de elicitation inválida');
    this.elicitations.delete(answer.requestId);
    return { jsonrpc: '2.0', id: pending.rawId, result: { action: answer.action,
      content: answer.action === 'accept' ? (answer.content ?? (pending.request.mode === 'form' ? {} : null)) : null } };
  }

  encodeInterrupt(): unknown {
    if (this.threadId === null || this.turnId === null) return null; // ningun turno en marcha
    return this.requestMessage('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }, 'other');
  }

  // Peticiones de rewind/fork (F4.4/F4.5) sobre el hilo abierto. Devuelve el mensaje JSON-RPC (como `encodeInterrupt`).
  encodeEngineRequest(requestId: string, request: EngineRequest): unknown {
    if (this.threadId === null) throw new Error(`Peticion al motor de codex sin hilo: requestId=${JSON.stringify(requestId)}`);
    const { method, params } = this.engineCall(this.threadId, request);
    const message = this.requestMessage(method, params, 'engine');
    this.engineRequests.set(this.nextId, requestId);
    return message;
  }

  private engineCall(threadId: string, request: EngineRequest): { readonly method: string; readonly params: Record<string, unknown> } {
    switch (request.kind) {
      case 'thread_revert':
        return { method: 'thread/revert', params: { threadId, beforeTurnId: request.beforeTurnId } };
      case 'thread_fork':
        return { method: 'thread/fork', params: { threadId, lastTurnId: request.lastTurnId, excludeTurns: true } };
      case 'thread_turns':
        return {
          method: 'thread/turns/list',
          params: { threadId, itemsView: 'full', sortDirection: 'asc', ...(request.cursor === null ? {} : { cursor: request.cursor }) },
        };
      default:
        throw new Error(`Codex no admite la peticion al motor: ${request.kind}`);
    }
  }

  // Codex fija modelo y permisos POR TURNO (`turn/start`): el cambio aplica al siguiente sin mandar nada.
  encodeSetModel(model: string): unknown {
    if (model.trim().length === 0) throw new Error(`Modelo vacio para codex: ${JSON.stringify(model)}`);
    this.model = model;
    return null;
  }

  encodeSetEffort(effort: string): unknown {
    if (effort.length > 0 && !['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) {
      throw new Error(`Esfuerzo de codex no valido: ${JSON.stringify(effort)}`);
    }
    this.effort = effort;
    return null;
  }

  encodeSetPermissionMode(mode: string): unknown {
    if (mode.trim().length === 0) throw new Error(`Modo de permiso vacio para codex: ${JSON.stringify(mode)}`);
    this.permissionProfile = mode;
    return null;
  }

  normalize(raw: unknown): MageEvent[] {
    if (!isRecord(raw)) return [];
    const events = this.dispatch(raw);
    return this.secrets.length === 0 ? events : events.map((event) => redactEventSecrets(event, this.secrets));
  }

  private dispatch(raw: Record<string, unknown>): MageEvent[] {
    const hasId = raw.id !== undefined && raw.id !== null;
    if (hasId && typeof raw.method === 'string') return this.onServerRequest(raw.id, raw.method, raw.params);
    if (hasId) return this.onResponse(raw);
    if (typeof raw.method !== 'string') return [];
    this.trackFileChanges(raw.method, raw.params);
    if (raw.method === 'thread/tokenUsage/updated') this.usage = trackTokenUsage(this.usage, raw.params);
    if (raw.method === 'serverRequest/resolved') return this.onResolved(raw.params);
    const events = normalizeNotification(raw.method, raw.params, this.usage.turn);
    const closed = raw.method === 'turn/completed' ? this.closeTurn() : [];
    const context = raw.method === 'thread/tokenUsage/updated' ? contextUsageOf(raw.params) : null;
    const withContext = context === null ? events : [...events, { kind: 'context_usage', usage: context } as MageEvent];
    return closed.length === 0 ? withContext : [...withContext, ...closed];
  }

  private closeTurn(): MageEvent[] {
    this.turnId = null;
    this.turnStarting = false;
    // El total del hilo se conserva: el turno siguiente cuenta desde el.
    this.usage = { ...this.usage, turn: null };
    this.fileChanges.clear();
    return this.releaseHeldSteers();
  }

  // 0.160.0 manda el diff en item/started; requestApproval solo lleva el itemId.
  private trackFileChanges(method: string, params: unknown): void {
    if (!isRecord(params) || !isRecord(params.item) || typeof params.item.id !== 'string') return;
    const item = params.item;
    if (method === 'item/completed') this.fileChanges.delete(params.item.id);
    if (method !== 'item/started' || item.type !== 'fileChange' || !Array.isArray(item.changes)) return;
    this.fileChanges.set(params.item.id, item.changes);
  }

  // --- Respuestas a lo que pidio Mage -------------------------------------------------------------

  private onResponse(raw: Record<string, unknown>): MageEvent[] {
    const kind = typeof raw.id === 'number' ? this.own.get(raw.id) : undefined;
    if (kind === undefined) return [];
    const id = raw.id as number;
    this.own.delete(id);
    if (kind === 'steer') return this.afterSteer(id, raw);
    if (kind === 'turn') return this.afterTurnStart(raw);
    if (kind === 'engine') return this.afterEngineRequest(id, raw);
    if (isRecord(raw.error)) return this.onError(kind, raw.error);
    switch (kind) {
      case 'initialize':
        return this.afterInitialize();
      case 'thread':
        return this.afterThread(raw.result);
      case 'models':
        return modelsEvent(raw.result);
      case 'rateLimits':
        return rateLimitEvents(raw.result);
      default:
        return [];
    }
  }

  private afterEngineRequest(id: number, raw: Record<string, unknown>): MageEvent[] {
    const requestId = this.engineRequests.get(id);
    if (requestId === undefined) return [];
    this.engineRequests.delete(id);
    const failed = isRecord(raw.error);
    return [{ kind: 'engine_response', requestId, ok: !failed, result: raw.result ?? null, error: failed ? describeRpcError(raw.error as Record<string, unknown>) : null }];
  }

  // Un fallo de la telemetria (limites sin cuenta: «authentication required», medido) no ensucia la
  // conversacion; uno del arranque o del turno si se pinta.
  private onError(kind: OwnRequest, error: Record<string, unknown>): MageEvent[] {
    if (kind === 'models' || kind === 'rateLimits' || kind === 'other') return [];
    return [{ kind: 'error', localized: localized('events.codex.requestRejected', { kind, detail: String(error.message) }) }];
  }

  private afterInitialize(): MageEvent[] {
    const params = this.requireParams();
    this.outgoing.push({ jsonrpc: '2.0', method: 'initialized' });
    const common = { cwd: params.cwd, model: this.model, approvalPolicy: this.approvalPolicy(), ...this.permissionsField() };
    const resume = params.conversationId !== undefined && params.conversationId.length > 0;
    if (resume) this.request('thread/resume', { ...common, threadId: params.conversationId }, 'thread');
    else this.request('thread/start', { ...common, ...this.instructionsField() }, 'thread');
    this.request('model/list', {}, 'models');
    this.request('account/rateLimits/read', undefined, 'rateLimits');
    return [];
  }

  private afterThread(result: unknown): MageEvent[] {
    const thread = isRecord(result) && isRecord(result.thread) ? result.thread : null;
    if (thread === null || typeof thread.id !== 'string') return [{ kind: 'error', localized: localized('events.codex.threadWithoutId') }];
    this.threadId = thread.id;
    const model = isRecord(result) && typeof result.model === 'string' ? result.model : this.model;
    const queued = this.queuedInputs;
    this.queuedInputs = [];
    for (const { input, messageId } of queued) this.startTurn(input, messageId);
    // El esquema 0.164.0 pone `default: "legacy"`, pero un campo AUSENTE no se trata como legacy: los hilos que abre
    // Mage son `paginated` (X-4 de INFORME-040). El revert de un legacy se rechaza con `-32600 thread/revert only
    // supports paginated threads` (A6 de INFORME-046).
    const mode = thread.historyMode === 'legacy' || thread.historyMode === 'paginated' ? thread.historyMode : null;
    return [
      { kind: 'session_init', sessionId: thread.id, model, tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], pluginErrors: [] },
      { kind: 'thread_history', mode },
    ];
  }

  // --- Peticiones del servidor --------------------------------------------------------------------

  private onServerRequest(rawId: unknown, method: string, params: unknown): MageEvent[] {
    if (method === 'mcpServer/elicitation/request') {
      const server = isRecord(params) && typeof params.serverName === 'string' ? params.serverName : 'MCP';
      const requestId = `codex-elicitation-${String(rawId)}`;
      const request = parseElicitationRequest(requestId, server, params);
      if (request === null) {
        this.outgoing.push({ jsonrpc: '2.0', id: rawId, result: { action: 'cancel', content: null } });
        return [{ kind: 'notice', localized: localized('events.mcp.elicitationUnsupported', { server }) }];
      }
      this.elicitations.set(requestId, { rawId, request });
      return [{ kind: 'elicitation_request', request }];
    }
    const requestId = `codex-${String(rawId)}`;
    const changes = isRecord(params) && typeof params.itemId === 'string' ? this.fileChanges.get(params.itemId) : undefined;
    const enriched = changes !== undefined && isRecord(params) ? { ...params, changes } : params;
    const request = approvalRequest(requestId, method, enriched);
    if (request === null) {
      // Una peticion que Mage no implementa se contesta con error: sin respuesta, codex esperaria.
      this.outgoing.push({ jsonrpc: '2.0', id: rawId, error: { code: JSONRPC_METHOD_NOT_FOUND, message: `Mage no implementa ${method}` } });
      return [];
    }
    this.approvals.set(requestId, { rawId, method, params });
    return [{ kind: 'permission_request', request }];
  }

  // Codex resolvio la peticion por su cuenta (turno interrumpido): la tarjeta sobra.
  private onResolved(params: unknown): MageEvent[] {
    if (!isRecord(params) || params.requestId === undefined) return [];
    const requestId = `codex-${String(params.requestId)}`;
    if (!this.approvals.delete(requestId)) return [];
    return [{ kind: 'permission_cancelled', requestId }];
  }

  // --- Envio --------------------------------------------------------------------------------------

  // `messageId` (F4.4): se manda como `clientUserMessageId` para que el item de usuario lo lleve de vuelta.
  private startTurn(input: readonly unknown[], messageId?: string): void {
    if (this.threadId === null) throw new Error('turn/start sin hilo de codex');
    this.turnStarting = true;
    // Medido con codex-cli 0.160.0 y Responses local: omitir esfuerzo manda medium; `effort: low`
    // en turn/start llega como reasoning.effort=low. Thread/start no acepta este campo.
    const effort = this.effort;
    this.request('turn/start', {
      threadId: this.threadId, input, model: this.model,
      ...(messageId === undefined ? {} : { clientUserMessageId: messageId }),
      ...(effort === null || effort.length === 0 ? {} : { effort }),
      approvalPolicy: this.approvalPolicy(), ...this.permissionsField(),
    }, 'turn');
  }

  // Respuesta a `turn/start`: con id de turno salen los directos que esperaban; sin el (error), no hay
  // turno al que entrar.
  private afterTurnStart(raw: Record<string, unknown>): MageEvent[] {
    this.turnStarting = false;
    const result = raw.result;
    this.turnId = isRecord(result) && isRecord(result.turn) && typeof result.turn.id === 'string' ? result.turn.id : null;
    const rejected = isRecord(raw.error) ? this.onError('turn', raw.error) : [];
    if (this.turnId === null) return [...rejected, ...this.releaseHeldSteers()];
    const held = this.heldSteers;
    this.heldSteers = [];
    for (const steer of held) this.sendSteer(steer.messageId, steer.input);
    return rejected;
  }

  private sendSteer(messageId: string, input: readonly unknown[]): void {
    if (this.threadId === null || this.turnId === null) throw new Error(`turn/steer sin hilo o sin turno de codex: ${messageId}`);
    this.request('turn/steer', { threadId: this.threadId, expectedTurnId: this.turnId, input, clientUserMessageId: messageId }, 'steer');
    this.steerRequests.set(this.nextId, messageId);
  }

  // Directos que esperaban un turno que no llego: no hay a donde entrar.
  private releaseHeldSteers(): MageEvent[] {
    const held = this.heldSteers;
    this.heldSteers = [];
    return held.map(({ messageId }) => ({ kind: 'steer_result', messageId, outcome: 'no_active_turn' }) as MageEvent);
  }

  private afterSteer(id: number, raw: Record<string, unknown>): MageEvent[] {
    const messageId = this.steerRequests.get(id);
    if (messageId === undefined) return [];
    this.steerRequests.delete(id);
    if (!isRecord(raw.error)) return [{ kind: 'steer_result', messageId, outcome: 'active_turn' }];
    return [steerRejection(messageId, raw.error)];
  }

  // El modo de permiso de Mage para codex es un perfil de su `permissionProfile/list` (`:workspace`…).
  private permissionsField(): { readonly permissions?: string } {
    const preset = this.permissionProfile === null ? null : parseCodexPermissionPreset(this.permissionProfile);
    return preset === null ? {} : { permissions: preset.profile };
  }

  private approvalPolicy(): string {
    return this.permissionProfile === null ? APPROVAL_POLICY
      : (parseCodexPermissionPreset(this.permissionProfile)?.approvalPolicy ?? APPROVAL_POLICY);
  }

  private instructionsField(): { readonly developerInstructions?: string } {
    return this.developerInstructions === null ? {} : { developerInstructions: this.developerInstructions };
  }

  private request(method: string, params: unknown, kind: OwnRequest): void {
    this.outgoing.push(this.requestMessage(method, params, kind));
  }

  private requestMessage(method: string, params: unknown, kind: OwnRequest): unknown {
    this.nextId += 1;
    this.own.set(this.nextId, kind);
    return { jsonrpc: '2.0', id: this.nextId, method, ...(params === undefined ? {} : { params }) };
  }

  private requireParams(): LaunchParams {
    if (this.params === null) throw new Error('codex contesto antes de lanzar el proceso');
    return this.params;
  }
}

// `"-32600 mensaje"` si el error trae codigo numerico; solo el mensaje si no.
function describeRpcError(error: Record<string, unknown>): string {
  const message = String(error.message);
  return typeof error.code === 'number' ? `${error.code} ${message}` : message;
}

function buildInput(text: string, attachments: readonly ImageAttachment[]): unknown[] {
  const input: unknown[] = [{ type: 'text', text, text_elements: [] }];
  for (const attachment of attachments) input.push({ type: 'image', url: `data:${attachment.mediaType};base64,${attachment.data}` });
  return input;
}

// Traduce el rechazo de `turn/steer` (formas medidas en 0.164.0): review/compact -> not_steerable con su
// tipo; turno ya acabado o cambiado -> no_active_turn; cualquier otro -> failed con el detalle.
function steerRejection(messageId: string, error: Record<string, unknown>): MageEvent {
  const info = isRecord(error.data) && isRecord(error.data.codexErrorInfo) ? error.data.codexErrorInfo : null;
  const notSteerable = info !== null && isRecord(info.activeTurnNotSteerable) ? info.activeTurnNotSteerable : null;
  if (notSteerable !== null) {
    const turnKind = typeof notSteerable.turnKind === 'string' ? notSteerable.turnKind : 'unknown';
    return { kind: 'steer_result', messageId, outcome: 'not_steerable', turnKind };
  }
  const message = String(error.message);
  const stale = error.code === JSONRPC_INVALID_REQUEST && STALE_STEER_MESSAGES.some((prefix) => message.startsWith(prefix));
  if (stale) return { kind: 'steer_result', messageId, outcome: 'no_active_turn' };
  return { kind: 'steer_result', messageId, outcome: 'failed', localized: localized('events.codex.requestRejected', { kind: 'steer', detail: message }) };
}

// Medido con una clave falsa: OpenAI devuelve la clave en el error («Incorrect API key provided:
// sk-…»). Nunca llega asi a la conversacion.
function redactEventSecrets(event: MageEvent, secrets: readonly string[]): MageEvent {
  // Son eventos propios, ya normalizados, sin ciclos. La proyeccion preserva su forma y limpia
  // TODOS los strings antes de salir a logs/IPC, incluidos outputs, diffs e inputs de permisos.
  const serialized = JSON.stringify(event, (_field, value: unknown) => {
    if (typeof value !== 'string') return value;
    return secrets.reduce((text, secret) => text.split(secret).join('[clave oculta]'), value);
  });
  return JSON.parse(serialized) as MageEvent;
}
