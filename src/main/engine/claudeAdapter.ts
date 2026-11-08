import { randomUUID } from 'node:crypto';
import type { ImageAttachment } from '@shared/ipc';
import { base64ByteLength, ERROR_FORMAT_LOCALE, validateAttachment } from '@shared/attachments';
import { buildUserContentBlocks } from '@shared/imageRefs';
import type { MageEvent, PermissionDecision, PermissionScope } from '@shared/events';
import { localized } from '@shared/i18n/localizedText';
import { isUuid } from '@shared/sessionInput';
import { parseElicitationRequest, type ElicitationAnswer } from '@shared/elicitation';
import { resolveClaudeBinary } from '../os/claudeBinaryResolver';
import { normalizeRawEvent } from './normalize';
import { allowRulesOf, allowScopesFor, formatRule, updatedPermissionsFor, type ClaudeRule } from './claudePermissionRules';
import { CommandLifecycleSchema } from './schemas';
import type { AuthModel, EngineRequest, LaunchParams, PermissionRef, ProviderAdapter, SpawnPlan, SteerEncoding } from './providerAdapter';
import { MAGE_MCP_CALLER_ENV } from '../host/mcpCallers';
import { decideTestAnthropicBaseUrl, scrubAgentEnv, TEST_ANTHROPIC_BASE_URL_ENV } from '../os/agentEnv';
import { claudeSharedLaunch, refuseClaudeMcpConfig, type ClaudeMcpConfigWriter } from '../config/mcpProviderTranslate';

// Argumentos fijos del CLI headless stream-json (confirmados en el spike M1.0).
// --output-format stream-json EXIGE --verbose. --permission-prompt-tool stdio activa el
// round-trip de permisos por stdin/stdout.
// Exportados para el sondeo de modelos (P-026 2.4): tiene que lanzar el CLI EXACTAMENTE igual que una
// sesion, o mediria otra cosa.
export const BASE_ARGS = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-prompt-tool',
  'stdio',
  '--include-partial-messages',
  // P-026 2.3 (D9): sin este flag el CLI rechaza `set_permission_mode bypassPermissions` («the session
  // was not launched with --dangerously-skip-permissions», medido en 2.1.283). Solo HABILITA el modo
  // «Omitir permisos» del ciclo: la sesion sigue arrancando en el modo que toque (medido: `default`).
  '--allow-dangerously-skip-permissions',
] as const;

// Hooks que Mage registra al arrancar (D2). Todos son de OBSERVACION del ciclo de vida: dan
// seguimiento fiable de lo que hace la sesion sin deducirlo del texto del modelo. Nombres del
// protocolo (HOOK_EVENTS del CLI). Deliberadamente FUERA: PreToolUse/PostToolUse (ruta critica de cada
// tool, ya cubierta por tool_use/tool_result del stream) y todo lo que pueda alterar decisiones.
const OBSERVED_HOOK_EVENTS = [
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionEnd',
] as const;

// Un solo callback id: el evento ya viene identificado en `input.hook_event_name`, asi que no hace
// falta un id por evento para saber quien disparo.
const HOOK_CALLBACK_ID = 'mage-observer';

// Tope que el CLI espera nuestra respuesta antes de seguir por su cuenta. Corto a proposito: un hook
// de observacion nunca debe retrasar una conversacion.
const HOOK_TIMEOUT_SECONDS = 5;

// Dependencias inyectables del adapter (testear el plan de spawn sin tocar el FS ni el entorno).
export interface ClaudeAdapterDeps {
  readonly resolveBinary?: () => string; // por defecto resolveClaudeBinary
  // Escribe el fichero de `--mcp-config` de la cuenta (con los secretos, en la carpeta de Mage): lo pone main.
  readonly writeMcpConfig?: ClaudeMcpConfigWriter; // por defecto refuseClaudeMcpConfig
  // Clave de API de la cuenta SI Y SOLO SI es una cuenta de Claude por API (grupo E); null para las de
  // suscripcion. La lee main de su boveda: nunca viene del renderer.
  readonly resolveApiKey?: (accountDir: string) => string | null; // por defecto () => null
  // D5 (#53): ajuste del usuario «Permitir Artifact», apagado por defecto. Se lee en cada arranque.
  readonly artifactEnabled?: () => boolean; // por defecto () => false
  // T6: valor crudo de MAGE_TEST_ANTHROPIC_BASE_URL y si la app esta empaquetada. Por defecto: sin variable y
  // EMPAQUETADA (lo seguro: nunca redirige).
  readonly testBaseUrl?: () => string | undefined;
  readonly isPackaged?: () => boolean;
  readonly log?: (level: 'warn', message: string, data?: unknown) => void;
}

// Adapter de Claude: unica implementacion de ProviderAdapter en el MVP. Conoce el comando, sus
// flags, el NDJSON de entrada y el protocolo de permisos; nada de esto escapa de aqui.
export class ClaudeAdapter implements ProviderAdapter {
  // El login lo hace el propio CLI (Fase 9): Mage orquesta `claude auth login` y NUNCA ve el token.
  // `loginArgs` esta MEDIDO contra el binario 2.1.270 (`spike/cli-login-spike.mjs`), no leido del
  // `--help`. El layout es el que usaba AccountService cableado por dentro hasta 9.1.
  readonly auth: AuthModel = {
    kind: 'cli-oauth',
    login: {
      accounts: {
        configDirEnvVar: 'CLAUDE_CONFIG_DIR',
        mainDirName: '.claude',
        stateFileName: '.claude.json',
      },
      loginArgs: ['auth', 'login', '--claudeai'],
    },
  };

  private readonly resolveBinary: () => string;
  private readonly writeMcpConfig: ClaudeMcpConfigWriter;
  private readonly resolveApiKey: (accountDir: string) => string | null;
  private readonly artifactEnabled: () => boolean;
  private readonly testBaseUrl: () => string | undefined;
  private readonly isPackaged: () => boolean;
  private readonly log: ClaudeAdapterDeps['log'];

  constructor(deps: ClaudeAdapterDeps = {}) {
    this.resolveBinary = deps.resolveBinary ?? resolveClaudeBinary;
    this.writeMcpConfig = deps.writeMcpConfig ?? refuseClaudeMcpConfig;
    this.resolveApiKey = deps.resolveApiKey ?? (() => null);
    this.artifactEnabled = deps.artifactEnabled ?? (() => false);
    this.testBaseUrl = deps.testBaseUrl ?? (() => undefined);
    this.isPackaged = deps.isPackaged ?? (() => true); // lo seguro: sin dato, nunca redirige
    this.log = deps.log;
  }

  buildSpawnPlan(params: LaunchParams): SpawnPlan {
    this.steers.clear(); // proceso nuevo: los directos del anterior murieron con el
    this.engineRequests.clear(); // y las peticiones al motor sin respuesta tambien
    this.permissionRules.clear(); // y sus permisos abiertos
    // Reanudar (`--resume <id>`) continua la conversacion existente y sigue escribiendo en su misma
    // transcripcion; arrancar (`--session-id <id>`) crea una nueva con el id dado. Mutuamente
    // excluyentes: el CLI no acepta ambos.
    const args = [...BASE_ARGS, ...sessionArgsOf(params)];
    // Modelo vacío = sin `--model`: el CLI elige el suyo (una delegada sin modelo conocido).
    if (params.model.length > 0) args.push('--model', params.model);
    // Effort opcional (M2.4): solo se anade si viene (ya validado en la frontera); sin el, default CLI.
    if (params.effort !== undefined && params.effort.length > 0) args.push('--effort', params.effort);
    // Tope de gasto opcional (M2.4): centavos enteros -> dolares con 2 decimales SOLO en la frontera
    // del argumento del CLI (internamente el dinero nunca es float). Ya validado (>0) aguas arriba.
    if (params.maxBudgetUsdCents !== undefined) args.push('--max-budget-usd', centsToUsd(params.maxBudgetUsdCents));
    // Modo de permiso inicial opcional (M2.6): --permission-mode <mode>. Sin el, el CLI arranca en el
    // modo configurado de la cuenta y Mage lo adopta (P-026 2.3). Con el, incluido `default`: un Manual
    // elegido a mano no lo cambia el `defaultMode` de la cuenta.
    if (params.permissionMode !== undefined && params.permissionMode.length > 0) {
      args.push('--permission-mode', params.permissionMode);
    }
    if (params.projectInstructions !== undefined && params.projectInstructions.length > 0) {
      args.push('--append-system-prompt', params.projectInstructions);
    }
    // Lo comun (MCP compartidos y extensiones, hooks y permisos) traducido a flags de Claude.
    const shared = claudeSharedLaunch(params.shared, params.accountDir, this.writeMcpConfig);
    args.push(...shared.args);
    // Env del hijo: se fija la cuenta y se SANEA (scrubAgentEnv), que borra toda credencial heredada. El
    // invariante de facturacion vive en un solo sitio: ver src/main/os/agentEnv.ts. Segunda excepcion
    // escrita alli: la clave de una cuenta de Claude por API se pone DESPUES del saneado y solo en el hijo
    // de esa cuenta; las de suscripcion no reciben ninguna.
    const apiKey = this.resolveApiKey(params.accountDir);
    // #53/D5 (medido en 2.1.309, spike/f1-artifact.mjs): en modo SDK el CLI apaga Artifact salvo con
    // CLAUDE_CODE_ARTIFACT verdadero. Publica en claude.ai, así que es opción del usuario, apagada por
    // defecto; el valor va DESPUÉS del env heredado: manda el ajuste, no lo que el usuario exportara.
    const testEndpoint = decideTestAnthropicBaseUrl({ value: this.testBaseUrl(), isPackaged: this.isPackaged(), isApiKeyAccount: apiKey !== null });
    if (testEndpoint.kind === 'ignored') this.log?.('warn', `${TEST_ANTHROPIC_BASE_URL_ENV} ignorada`, { reason: testEndpoint.reason });
    const env: NodeJS.ProcessEnv = {
      ...scrubAgentEnv(process.env),
      [FILE_CHECKPOINTING_ENV]: 'true',
      CLAUDE_CODE_ARTIFACT: this.artifactEnabled() ? '1' : '0',
      CLAUDE_CONFIG_DIR: params.accountDir,
      ...shared.env,
      ...(apiKey === null ? {} : { [ANTHROPIC_API_KEY_ENV]: apiKey }),
      // D-M6: identidad de esta sesion ante `mage mcp`, tambien DESPUES del saneado.
      ...(params.shared?.mageCaller === undefined ? {} : { [MAGE_MCP_CALLER_ENV]: params.shared.mageCaller.credential }),
      ...(testEndpoint.kind === 'use' ? { ANTHROPIC_BASE_URL: testEndpoint.url } : {}),
    };
    return { command: this.resolveBinary(), args, env };
  }

  // SIN adjuntos, el payload es EXACTAMENTE el de siempre (`content` string), que es la forma minima
  // viable validada en el spike. Con adjuntos pasa a array de bloques, que es como el protocolo lleva
  // imagenes: [{type:'text'}, {type:'image', source:{type:'base64', media_type, data}}].
  // `parent_tool_use_id`: clave requerida, nullable.
  // Con `messageId` (un UUID) el mensaje lleva `uuid`: el CLI lo usa como id propio (rewind, directos).
  encodeUserMessage(text: string, attachments: readonly ImageAttachment[] = [], messageId?: string): unknown {
    if (messageId === undefined) return this.encodeUserPayload(text, attachments);
    if (!isUuid(messageId)) throw new Error(`El id de un mensaje de Claude tiene que ser un UUID: ${JSON.stringify(messageId)}`);
    return { ...this.encodeUserPayload(text, attachments), uuid: messageId };
  }

  private encodeUserPayload(text: string, attachments: readonly ImageAttachment[]): Record<string, unknown> {
    if (attachments.length === 0) {
      return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
    }
    // Segunda validacion, la de verdad: esto es lo que llega por IPC. `data.length` NO es el tamaño
    // (base64 abulta ~4/3), asi que se decodifica el tamaño real.
    for (const attachment of attachments) {
      validateAttachment({ mediaType: attachment.mediaType, byteLength: base64ByteLength(attachment.data) }, ERROR_FORMAT_LOCALE);
    }
    // Cada imagen justo detras de su token `[Imagen N]` (P-026 3.2; MEDIDO en S3: el CLI respeta el orden
    // intercalado). Nunca un bloque de texto vacio: un mensaje de SOLO imagen tambien vale.
    const content = buildUserContentBlocks(text, attachments);
    return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null };
  }

  // Directo (F4.1): el mensaje normal con `uuid`; el CLI lo mete en el turno en marcha o abre uno propio,
  // y lo cuenta con `command_lifecycle` (ver normalizeSteer).
  encodeSteer(messageId: string, text: string, attachments: readonly ImageAttachment[] = []): SteerEncoding {
    if (!isUuid(messageId)) throw new Error(`El id de un directo de Claude tiene que ser un UUID: ${JSON.stringify(messageId)}`);
    const payload = this.encodeUserMessage(text, attachments, messageId);
    this.steers.set(messageId, false);
    return { kind: 'write', payload };
  }

  // `updatedInput` REESCRIBE el input de la tool: por ahi viajan las respuestas de AskUserQuestion
  // (2.3). Sin el, `{}` — que NO es un bug: el fuente del CLI dice que significa "usa el input
  // original" y es lo que mandan sus clientes moviles. El campo del payload es `toolUseID`, con la D y
  // la ID en mayusculas; escribirlo `toolUseId` compila igual y el CLI no lo reconoce.
  // Con alcance («esta sesión» o «siempre») van además las reglas que el CLI sugirió para ESTA llamada (ver
  // claudePermissionRules.ts); el destino lo pone el alcance.
  encodePermissionResponse(ref: PermissionRef, decision: PermissionDecision): unknown {
    const open = this.permissionRules.get(ref.requestId);
    this.permissionRules.delete(ref.requestId);
    if (decision.behavior === 'deny') {
      return this.permissionResponse(ref, { behavior: 'deny', message: decision.message, toolUseID: ref.toolUseId });
    }
    const allow = { behavior: 'allow', updatedInput: decision.updatedInput ?? {}, toolUseID: ref.toolUseId };
    if (decision.scope === undefined) return this.permissionResponse(ref, allow);
    if (open === undefined || !open.scopes.includes(decision.scope)) {
      throw new Error(`La petición de permiso ${ref.requestId} no admite el alcance ${decision.scope}`);
    }
    return this.permissionResponse(ref, { ...allow, updatedPermissions: updatedPermissionsFor(open.rules, decision.scope) });
  }

  private permissionResponse(ref: PermissionRef, payload: Record<string, unknown>): unknown {
    return { type: 'control_response', response: { subtype: 'success', request_id: ref.requestId, response: payload } };
  }

  encodeInterrupt(): unknown {
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } };
  }

  // Cambio de modelo en caliente (protocolo confirmado contra el fuente del CLI 2.1.214): el CLI
  // responde control_response success y el nuevo modelo aplica al SIGUIENTE turno.
  encodeSetModel(model: string): unknown {
    if (model.trim().length === 0) throw new Error(`Modelo vacio para set_model: ${JSON.stringify(model)}`);
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'set_model', model } };
  }

  // Cambio de modo de permiso en caliente (protocolo confirmado contra el fuente del CLI): el CLI
  // responde control_response success {mode} y emite system/status con el nuevo permissionMode.
  encodeSetPermissionMode(mode: string): unknown {
    if (mode.trim().length === 0) throw new Error(`Modo de permiso vacio para set_permission_mode: ${JSON.stringify(mode)}`);
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'set_permission_mode', mode } };
  }

  // Para UN subagente (0.1.1 R2, punto 29). MEDIDO en 2.1.285 (`engine-spike --subagent-bg --stop-task`):
  // `stop_task {task_id}` con el `agentId` del lanzamiento (es el `task_id` de `system/task_started`)
  // contesta success {} y el CLI emite `task_updated killed` + `task_notification stopped` de ESE; los
  // demas siguen y terminan, y el hilo principal no se corta.
  encodeStopTask(taskId: string): unknown {
    if (taskId.trim().length === 0) throw new Error(`task_id vacio para stop_task: ${JSON.stringify(taskId)}`);
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'stop_task', task_id: taskId } };
  }

  // Desglose de la ventana de contexto (D3). Protocolo verificado EN VIVO contra el CLI 2.1.220: el
  // request no lleva campos y el CLI contesta control_response success con {categories, totalTokens,
  // maxTokens, percentage, ...}. Se puede pedir sin haber mandado ningun turno (no gasta suscripcion).
  encodeGetContextUsage(): unknown {
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'get_context_usage' } };
  }

  // Registro de hooks al arrancar (D2). Verificado EN VIVO contra el CLI 2.1.220: el CLI responde
  // success (con el catalogo de comandos, ver normalize) y a partir de ahi manda un control_request
  // hook_callback por cada disparo. Detalles del diseno:
  //  - Solo hooks de OBSERVACION (ciclo de vida). No se registran PreToolUse/PostToolUse: van en la
  //    ruta critica de cada tool y el stream ya da tool_use/tool_result, asi que solo anadirian
  //    latencia y riesgo de bloquear la conversacion si algo va mal en la respuesta.
  //  - `timeout` explicito por matcher: si Mage no contestara, el CLI espera ESE tiempo y sigue, en
  //    vez de quedarse colgado indefinidamente.
  encodeInitialize(): unknown {
    const matchers = OBSERVED_HOOK_EVENTS.map(() => [
      { hookCallbackIds: [HOOK_CALLBACK_ID], timeout: HOOK_TIMEOUT_SECONDS },
    ]);
    const hooks = Object.fromEntries(OBSERVED_HOOK_EVENTS.map((event, index) => [event, matchers[index]]));
    return { type: 'control_request', request_id: randomUUID(), request: { subtype: 'initialize', hooks } };
  }

  // Respuesta a un hook_callback: `continue: true` = solo observamos, no alteramos el flujo (no se
  // deniega, ni se reescribe input, ni se corta el turno).
  encodeHookResponse(requestId: string): unknown {
    if (requestId.trim().length === 0) {
      throw new Error(`requestId vacio al responder a un hook: ${JSON.stringify(requestId)}`);
    }
    return {
      type: 'control_response',
      response: { subtype: 'success', request_id: requestId, response: { continue: true } },
    };
  }

  // Peticiones de rewind (F4.4/F4.5). MEDIDO en 2.1.311 (Mage corre con 2.1.314, sin cambios en 2.1.318):
  //  - C-2 `rewind_conversation` contesta `{ rewound, targetMessageUuid, prefillText, precedingAssistantUuid }`;
  //    sus rechazos son `stale_target`, `target_not_found` y `turn_running`.
  //  - C-5 `rewind_files` con `dry_run` contesta `{ canRewind, filesChanged, insertions, deletions }`.
  // El resto de `kind` son de Codex.
  encodeEngineRequest(requestId: string, request: EngineRequest): unknown {
    const body = this.engineRequestBody(request);
    this.engineRequests.add(requestId);
    return { type: 'control_request', request_id: requestId, request: body };
  }

  private engineRequestBody(request: EngineRequest): Record<string, unknown> {
    switch (request.kind) {
      case 'rewind_conversation':
        return {
          subtype: 'rewind_conversation',
          target_message_uuid: requireUuid(request.targetUuid),
          last_seen_user_message_uuid: requireUuid(request.lastSeenUuid),
        };
      case 'rewind_files':
        return { subtype: 'rewind_files', user_message_id: requireUuid(request.userMessageUuid), dry_run: request.dryRun };
      default:
        throw new Error(`Claude no admite la peticion al motor: ${request.kind}`);
    }
  }

  // Cancelaciones que hay que mandar al CLI por una elicitation que Mage no sabe mostrar.
  private outgoing: unknown[] = [];
  // Directos en vuelo: uuid -> true si ya paso un `result` desde que se escribio (su `started` abrira turno propio).
  private readonly steers = new Map<string, boolean>();
  // request_id de las peticiones al motor sin respuesta (`encodeEngineRequest`).
  private readonly engineRequests = new Set<string>();
  // Peticiones de permiso abiertas: request_id -> reglas del CLI y alcances ofrecidos. Viven en main: el renderer
  // solo elige el alcance, nunca la regla.
  private readonly permissionRules = new Map<string, { readonly rules: readonly ClaudeRule[]; readonly scopes: readonly PermissionScope[] }>();

  takeOutgoing(): readonly unknown[] {
    const taken = this.outgoing;
    this.outgoing = [];
    return taken;
  }

  // MEDIDO en 2.1.292 (`spike/claude-elicitation-spike.mjs`, sin turnos de pago): el CLI manda un
  // control_request `elicitation` y espera un control_response `{action, content}`; el MCP recibe lo mismo.
  encodeElicitationResponse(answer: ElicitationAnswer): unknown {
    const payload = answer.action === 'accept' ? { action: 'accept', content: answer.content ?? {} } : { action: answer.action };
    return { type: 'control_response', response: { subtype: 'success', request_id: answer.requestId, response: payload } };
  }

  normalize(raw: unknown): MageEvent[] {
    const elicitation = this.normalizeElicitation(raw);
    if (elicitation !== null) return elicitation;
    const engine = this.normalizeEngineResponse(raw);
    if (engine !== null) return engine;
    const type = (raw as { type?: unknown } | null)?.type;
    if (type === 'command_lifecycle') return this.normalizeSteer(raw);
    const events = normalizeRawEvent(raw);
    if (type === 'control_cancel_request') this.forgetPermission(raw);
    const decorated = type === 'control_request' ? this.withPermissionScopes(raw, events) : events;
    return type === 'result' ? [...decorated, ...this.afterResult()] : decorated;
  }

  // can_use_tool: guarda las reglas y anuncia en la petición los alcances que se pueden aplicar y la regla que se guardaría.
  private withPermissionScopes(raw: unknown, events: MageEvent[]): MageEvent[] {
    const message = raw as { request_id?: unknown; request?: Record<string, unknown> };
    const request = message.request;
    if (typeof message.request_id !== 'string' || request?.subtype !== 'can_use_tool') return events;
    const requestId = message.request_id;
    return events.map((event) => {
      if (event.kind !== 'permission_request' || event.request.requestId !== requestId) return event;
      const rules = allowRulesOf(request.permission_suggestions, event.request.toolName);
      const scopes = allowScopesFor({ toolName: event.request.toolName, input: event.request.input, requiresUserInteraction: event.request.requiresUserInteraction, suppressAlwaysAllow: request.suppress_always_allow_rule === true });
      this.permissionRules.set(requestId, { rules, scopes });
      if (scopes.length === 0) return event;
      return { ...event, request: { ...event.request, allowScopes: scopes, rule: rules.map(formatRule).join(', ') } };
    });
  }

  private forgetPermission(raw: unknown): void {
    const requestId = (raw as { request_id?: unknown }).request_id;
    if (typeof requestId === 'string') this.permissionRules.delete(requestId);
  }

  // La respuesta a una peticion al motor sale como `engine_response` (exito o rechazo): un rechazo NO pasa ademas
  // por `control_error`. Una respuesta de otra peticion sigue su camino.
  private normalizeEngineResponse(raw: unknown): MageEvent[] | null {
    if ((raw as { type?: unknown } | null)?.type !== 'control_response') return null;
    const response = (raw as { response?: Record<string, unknown> }).response;
    const requestId = response?.request_id;
    if (response === undefined || response === null || typeof requestId !== 'string' || !this.engineRequests.delete(requestId)) return null;
    const ok = response.subtype === 'success';
    const error = typeof response.error === 'string' ? response.error : JSON.stringify(response.error);
    return [{ kind: 'engine_response', requestId, ok, result: ok ? (response.response ?? null) : null, error: ok ? null : error }];
  }

  // `started` antes de un `result` = absorbido en el turno; despues = turno propio. `cancelled` = no llego.
  // Un uuid que no es un directo nuestro, o una linea malformada, no emite nada.
  private normalizeSteer(raw: unknown): MageEvent[] {
    const parsed = CommandLifecycleSchema.safeParse(raw);
    if (!parsed.success) return [];
    const { command_uuid: messageId, state } = parsed.data;
    const afterResult = this.steers.get(messageId);
    if (afterResult === undefined || (state !== 'started' && state !== 'cancelled')) return [];
    this.steers.delete(messageId);
    if (state === 'cancelled') return [{ kind: 'steer_result', messageId, outcome: 'failed' }];
    return [{ kind: 'steer_result', messageId, outcome: afterResult ? 'new_turn' : 'active_turn' }];
  }

  // Cierre de turno: los directos sin `started` pasan a «tras result». Salvaguarda: uno que ya lo estaba
  // y ve OTRO `result` sin haber recibido `started` se da por turno propio (inferido), para que la cola
  // nunca se quede esperando una señal que no llega.
  private afterResult(): MageEvent[] {
    const inferred: MageEvent[] = [];
    for (const [messageId, afterResult] of this.steers) {
      if (!afterResult) {
        this.steers.set(messageId, true);
        continue;
      }
      this.steers.delete(messageId);
      inferred.push({ kind: 'steer_result', messageId, outcome: 'new_turn', inferred: true });
    }
    return inferred;
  }

  private normalizeElicitation(raw: unknown): MageEvent[] | null {
    const { request_id: requestId, request } = (raw ?? {}) as { request_id?: unknown; request?: Record<string, unknown> };
    if ((raw as { type?: unknown })?.type !== 'control_request' || request?.subtype !== 'elicitation' || typeof requestId !== 'string') return null;
    const server = typeof request.mcp_server_name === 'string' ? request.mcp_server_name : 'MCP';
    const parsed = parseElicitationRequest(requestId, server, {
      mode: request.mode, message: request.message, url: request.url, elicitationId: request.elicitation_id, requestedSchema: request.requested_schema,
    });
    if (parsed !== null) return [{ kind: 'elicitation_request', request: parsed }];
    this.outgoing.push({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { action: 'cancel' } } });
    return [{ kind: 'notice', localized: localized('events.mcp.elicitationUnsupported', { server }) }];
  }
}

function requireUuid(value: string): string {
  if (!isUuid(value)) throw new Error(`Se esperaba un UUID: ${JSON.stringify(value)}`);
  return value;
}

// Checkpoints de ficheros (medido en 2.1.311): sin esta variable `rewind_files` contesta
// «File rewinding is not enabled.». Las copias van al `file-history/` del config dir de la cuenta, que es del CLI;
// no cubre lo escrito con Bash. Va DESPUES del saneado del entorno.
const FILE_CHECKPOINTING_ENV = 'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING';

// Argumentos de sesion. Reanudar (`--resume <id>`) continua la conversacion; arrancar (`--session-id <id>`) crea una.
// Divergir (medido en 2.1.311) = `--resume <origen> --resume-session-at <at> --fork-session
// --session-id <nuevo>`; el original no cambia (C-3b). Fork y resume son excluyentes.
function sessionArgsOf(params: LaunchParams): string[] {
  const fork = params.forkFrom;
  if (fork === undefined) return params.resume === true ? ['--resume', params.sessionId] : ['--session-id', params.sessionId];
  if (params.resume === true) throw new Error(`forkFrom y resume son excluyentes: sessionId=${JSON.stringify(params.sessionId)}`);
  return [
    '--resume', requireUuid(fork.sessionId),
    '--resume-session-at', requireUuid(fork.atUuid),
    '--fork-session',
    '--session-id', requireUuid(params.sessionId),
  ];
}

// Variable con la que el CLI autentica por clave de API (medido en 2.1.285: con un config dir vacio,
// `claude auth status` da `authMethod: "api_key"`, `apiKeySource: "ANTHROPIC_API_KEY"`).
const ANTHROPIC_API_KEY_ENV = 'ANTHROPIC_API_KEY';

// Formatea centavos enteros como dolares con 2 decimales (p.ej. 500 -> "5.00"), solo para el arg del
// CLI. La division entera + resto evita el error de coma flotante de (cents/100).toFixed(2).
function centsToUsd(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = Math.abs(cents % 100);
  return `${whole}.${fraction.toString().padStart(2, '0')}`;
}
