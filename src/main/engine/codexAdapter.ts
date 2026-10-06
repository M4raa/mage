import type { ImageAttachment } from '@shared/ipc';
import type { MageEvent, PermissionDecision, TurnUsage } from '@shared/events';
import { resolveCodexBinary } from '../os/codexBinaryResolver';
import { scrubAgentEnv } from '../os/agentEnv';
import { toCodexOverrides } from '../config/mcpProviderTranslate';
import { bridgeDocument, type BridgedFile } from '../instructions/instructionsBridge';
import type { AuthModel, LaunchParams, PermissionRef, ProviderAdapter, SpawnPlan } from './providerAdapter';
import {
  approvalRequest,
  approvalResult,
  isRecord,
  modelsEvent,
  normalizeNotification,
  rateLimitEvents,
  turnUsageOf,
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
// Ids de las peticiones propias de Mage, para reconocer su respuesta.
type OwnRequest = 'initialize' | 'thread' | 'turn' | 'models' | 'rateLimits' | 'other';

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
  private readonly fileChanges = new Map<string, readonly unknown[]>();
  private threadId: string | null = null;
  private turnId: string | null = null;
  private turnUsage: TurnUsage | null = null;
  private queuedInputs: unknown[][] = [];
  private params: LaunchParams | null = null;
  private model = '';
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
    this.secrets = [...new Set([this.apiKey ?? '', ...Object.values(mcp.env)].filter((value) => value.length > 0))];
    const bridged = this.deps.resolveInstructions?.(params.cwd, account?.home ?? null) ?? [];
    const userFiles = bridged.filter((file) => file.scope === 'user');
    this.developerInstructions = userFiles.length === 0 ? null : bridgeDocument(userFiles);
    const fallback = bridged.some((file) => file.scope === 'project') ? PROJECT_FALLBACK_ARGS : [];
    const args = ['app-server', ...mcp.args, ...fallback, ...(this.apiKey === null ? [] : API_PROVIDER_ARGS)];
    const env: NodeJS.ProcessEnv = {
      ...scrubAgentEnv(process.env),
      ...mcp.env,
      ...(account === null ? {} : { CODEX_HOME: account.home }),
      ...(this.apiKey === null ? {} : { [CODEX_API_KEY_ENV]: this.apiKey }),
    };
    // 0.160.0 rechaza thread/start.permissions sin esta capacidad: perfiles y MCP son experimentales.
    this.request('initialize', { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true } }, 'initialize');
    return { command: (this.deps.resolveBinary ?? resolveCodexBinary)(), args, env };
  }

  private resetProcess(params: LaunchParams): void {
    this.params = params;
    this.model = this.model.length === 0 ? params.model : this.model;
    this.permissionProfile ??= params.permissionMode ?? null;
    this.outgoing = [];
    this.own.clear();
    this.approvals.clear();
    this.fileChanges.clear();
    this.threadId = null;
    this.turnId = null;
    this.turnUsage = null;
  }

  takeOutgoing(): readonly unknown[] {
    const messages = this.outgoing;
    this.outgoing = [];
    return messages;
  }

  // Sin hilo todavia, el mensaje espera: sale como `turn/start` en cuanto `thread/start` conteste.
  encodeUserMessage(text: string, attachments: readonly ImageAttachment[] = []): unknown {
    const input: unknown[] = [{ type: 'text', text, text_elements: [] }];
    for (const attachment of attachments) input.push({ type: 'image', url: `data:${attachment.mediaType};base64,${attachment.data}` });
    if (this.threadId === null) {
      this.queuedInputs.push(input);
      return null;
    }
    this.startTurn(input);
    return null;
  }

  encodePermissionResponse(ref: PermissionRef, decision: PermissionDecision): unknown {
    const pending = this.approvals.get(ref.requestId);
    if (pending === undefined) throw new Error(`Aprobacion de codex desconocida o ya resuelta: ${ref.requestId}`);
    this.approvals.delete(ref.requestId);
    return { jsonrpc: '2.0', id: pending.rawId, result: approvalResult(pending.method, pending.params, decision.behavior === 'allow') };
  }

  encodeInterrupt(): unknown {
    if (this.threadId === null || this.turnId === null) return null; // ningun turno en marcha
    return this.requestMessage('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }, 'other');
  }

  // Codex fija modelo y permisos POR TURNO (`turn/start`): el cambio aplica al siguiente sin mandar nada.
  encodeSetModel(model: string): unknown {
    if (model.trim().length === 0) throw new Error(`Modelo vacio para codex: ${JSON.stringify(model)}`);
    this.model = model;
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
    if (raw.method === 'thread/tokenUsage/updated') this.turnUsage = turnUsageOf(raw.params) ?? this.turnUsage;
    if (raw.method === 'serverRequest/resolved') return this.onResolved(raw.params);
    const events = normalizeNotification(raw.method, raw.params, this.turnUsage);
    if (raw.method === 'turn/completed') this.closeTurn();
    return events;
  }

  private closeTurn(): void {
    this.turnId = null;
    this.turnUsage = null;
    this.fileChanges.clear();
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
    this.own.delete(raw.id as number);
    if (isRecord(raw.error)) return this.onError(kind, raw.error);
    switch (kind) {
      case 'initialize':
        return this.afterInitialize();
      case 'thread':
        return this.afterThread(raw.result);
      case 'turn':
        this.turnId = isRecord(raw.result) && isRecord(raw.result.turn) && typeof raw.result.turn.id === 'string' ? raw.result.turn.id : null;
        return [];
      case 'models':
        return modelsEvent(raw.result);
      case 'rateLimits':
        return rateLimitEvents(raw.result);
      default:
        return [];
    }
  }

  // Un fallo de la telemetria (limites sin cuenta: «authentication required», medido) no ensucia la
  // conversacion; uno del arranque o del turno si se pinta.
  private onError(kind: OwnRequest, error: Record<string, unknown>): MageEvent[] {
    if (kind === 'models' || kind === 'rateLimits' || kind === 'other') return [];
    return [{ kind: 'error', message: `codex rechazo la peticion (${kind}): ${String(error.message)}` }];
  }

  private afterInitialize(): MageEvent[] {
    const params = this.requireParams();
    this.outgoing.push({ jsonrpc: '2.0', method: 'initialized' });
    const common = { cwd: params.cwd, model: this.model, approvalPolicy: APPROVAL_POLICY, ...this.permissionsField() };
    const resume = params.conversationId !== undefined && params.conversationId.length > 0;
    if (resume) this.request('thread/resume', { ...common, threadId: params.conversationId }, 'thread');
    else this.request('thread/start', { ...common, ...this.instructionsField() }, 'thread');
    this.request('model/list', {}, 'models');
    this.request('account/rateLimits/read', undefined, 'rateLimits');
    return [];
  }

  private afterThread(result: unknown): MageEvent[] {
    const thread = isRecord(result) && isRecord(result.thread) ? result.thread : null;
    if (thread === null || typeof thread.id !== 'string') return [{ kind: 'error', message: 'codex abrio el hilo sin id' }];
    this.threadId = thread.id;
    const model = isRecord(result) && typeof result.model === 'string' ? result.model : this.model;
    const queued = this.queuedInputs;
    this.queuedInputs = [];
    for (const input of queued) this.startTurn(input);
    return [
      { kind: 'session_init', sessionId: thread.id, model, tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], pluginErrors: [] },
    ];
  }

  // --- Peticiones del servidor --------------------------------------------------------------------

  private onServerRequest(rawId: unknown, method: string, params: unknown): MageEvent[] {
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

  private startTurn(input: readonly unknown[]): void {
    if (this.threadId === null) throw new Error('turn/start sin hilo de codex');
    // Medido con codex-cli 0.160.0 y Responses local: omitir esfuerzo manda medium; `effort: low`
    // en turn/start llega como reasoning.effort=low. Thread/start no acepta este campo.
    const effort = this.requireParams().effort;
    this.request('turn/start', {
      threadId: this.threadId, input, model: this.model,
      ...(effort === undefined || effort.length === 0 ? {} : { effort }),
      ...this.permissionsField(),
    }, 'turn');
  }

  // El modo de permiso de Mage para codex es un perfil de su `permissionProfile/list` (`:workspace`…).
  private permissionsField(): { readonly permissions?: string } {
    return this.permissionProfile === null || this.permissionProfile.length === 0 ? {} : { permissions: this.permissionProfile };
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
