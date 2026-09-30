import type { MageEvent, ToolFileInfo, ToolUse } from '@shared/events';
import type { UsageWindowInfo } from '@shared/usage';
// Se reutiliza el conversor de fechas del panel de Uso (unico sitio que sabe distinguir epoch en
// segundos de epoch en ms) en vez de escribir aqui un segundo: el `resetsAt` del stream viene en
// SEGUNDOS y ese es justo el caso que ya resuelve.
import { parseEpochMs } from '../usage/schemas';
import { countOrNull, parseSubagentRunInfo } from '@shared/subagentRun';
import {
  CanUseToolSchema,
  CancelSchema,
  CompactBoundarySchema,
  ContextUsageSchema,
  ConversationResetSchema,
  HookCallbackSchema,
  InitializeResponseSchema,
  InitSchema,
  LocalCommandRunSchema,
  RateLimitEventSchema,
  ResultSchema,
  SessionStateSchema,
  ToolResultBlockSchema,
  ToolResultUserSchema,
} from './schemas';

// Normaliza una linea cruda del stdout del CLI (ya JSON-parseada) a eventos comunes de Mage.
// Contrato: devuelve [] para tipos que no nos interesan (no es error: hay muchos subtypes de
// system que ignoramos); LANZA Error si un mensaje que SI reconocemos llega con forma invalida
// (lo captura AgentSession y lo convierte en un evento 'error', sin matar el proceso).
export function normalizeRawEvent(raw: unknown): MageEvent[] {
  if (!isRecord(raw) || typeof raw.type !== 'string') return [];
  switch (raw.type) {
    case 'system':
      return normalizeSystem(raw);
    case 'stream_event':
      return normalizeStreamDelta(raw);
    case 'assistant':
      return normalizeAssistant(raw);
    case 'user':
      return normalizeUserToolResults(raw);
    case 'control_request':
      return normalizeControlRequest(raw);
    case 'control_cancel_request':
      return [{ kind: 'permission_cancelled', requestId: CancelSchema.parse(raw).request_id }];
    case 'control_response':
      return normalizeControlResponse(raw);
    // Tipo que la sonda de §0 vio en el stream EN VIVO. Sus campos NO estan medidos (provocar un rate
    // limit de verdad significa agotar la suscripcion), asi que se lee de forma defensiva: si trae un
    // texto, se propaga; si no, no se emite nada. Nunca se inventa un campo.
    case 'rate_limit_event':
      return normalizeRateLimitEvent(raw);
    case 'result':
      return normalizeResult(raw);
    case 'conversation_reset':
      return [{ kind: 'conversation_reset', newSessionId: ConversationResetSchema.parse(raw).new_conversation_id }];
    default:
      return [];
  }
}

// Nombres de herramientas a partir de lo que venga en `tools`. MEDIDO para Claude Code: es un array de
// strings (`tools: inputs.tools.map(tool => sdkCompatToolName(tool.name))` en su propio codigo). Para
// `agy` NO esta medido —el spike de E3 solo conto 56 entradas, no miro dentro—, asi que tambien se
// acepta `{ name }` y se descarta lo que no encaje.
//
// Se resuelve aqui y no en el esquema a proposito: la lista de herramientas no puede tumbar el arranque
// de una sesion entera. Perderla degrada un panel; fallar deja al usuario sin conversacion.
export function toolNames(tools: readonly unknown[] | undefined): readonly string[] {
  if (tools === undefined) return [];
  return tools
    .map((tool) => {
      if (typeof tool === 'string') return tool;
      if (typeof tool === 'object' && tool !== null && 'name' in tool) {
        const { name } = tool as { name: unknown };
        return typeof name === 'string' ? name : null;
      }
      return null;
    })
    .filter((name): name is string => name !== null && name.length > 0);
}

// Texto de un error de plugin. La forma NO esta medida (sin errores no llega el campo): se usa lo que
// parezca un mensaje y, si no hay, el elemento entero en JSON, recortado.
const MAX_PLUGIN_ERROR_CHARS = 200;
function pluginErrorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (isRecord(error)) {
    const message = [error.message, error.error, error.plugin].find((value): value is string => typeof value === 'string');
    if (message !== undefined) return message;
  }
  return JSON.stringify(error).slice(0, MAX_PLUGIN_ERROR_CHARS);
}

function normalizeSystem(raw: Record<string, unknown>): MageEvent[] {
  if (raw.subtype === 'init') {
    const init = InitSchema.parse(raw);
    const events: MageEvent[] = [
      {
        kind: 'session_init',
        sessionId: init.session_id,
        model: init.model,
        tools: toolNames(init.tools),
        // Ausentes -> colecciones vacias (nunca undefined): el consumidor no tiene que distinguir
        // "el CLI no lo reporto" de "no hay ninguno" para pintarlo.
        mcpServers: init.mcp_servers ?? [],
        slashCommands: init.slash_commands ?? [],
        skills: init.skills ?? [],
        plugins: (init.plugins ?? []).map((plugin) => ({ name: plugin.name, source: plugin.source ?? null })),
        pluginErrors: (init.plugin_errors ?? []).map(pluginErrorText),
      },
    ];
    // El modo con el que arranco la sesion (P-026 2.3): la pestaña enseña el del CLI, no uno supuesto.
    if (init.permissionMode !== undefined && init.permissionMode.length > 0) events.push({ kind: 'permission_mode', mode: init.permissionMode });
    return events;
  }
  if (raw.subtype === 'session_state_changed') {
    return [{ kind: 'session_state', state: SessionStateSchema.parse(raw).state }];
  }
  if (raw.subtype === 'compact_boundary') {
    // Compactacion (M2.4): trigger 'manual'|'auto' con fallback (mensaje laxo, render best-effort).
    const parsed = CompactBoundarySchema.parse(raw);
    return [{ kind: 'compacted', trigger: parsed.compact_metadata?.trigger ?? 'manual' }];
  }
  if (raw.subtype === 'status') return normalizeStatus(raw);
  if (raw.subtype === 'task_progress' || raw.subtype === 'task_notification') return normalizeTaskUpdate(raw);
  return [];
}

function normalizeStatus(raw: Record<string, unknown>): MageEvent[] {
  const events: MageEvent[] = [];
  // Modo de permiso (M2.6): el CLI emite system/status con permissionMode ante CUALQUIER cambio.
  if (typeof raw.permissionMode === 'string') events.push({ kind: 'permission_mode', mode: raw.permissionMode });
  if (raw.status === 'requesting') events.push({ kind: 'request_started' });
  return events;
}

// `system/task_progress` y `system/task_notification` de un subagente en segundo plano (medido en
// 2.1.284, ver `subagent_update`). Sin `tool_use_id` no hay a que bloque atribuirlo: se ignora.
function normalizeTaskUpdate(raw: Record<string, unknown>): MageEvent[] {
  const toolUseId = typeof raw.tool_use_id === 'string' && raw.tool_use_id.length > 0 ? raw.tool_use_id : null;
  if (toolUseId === null) return [];
  const status = raw.subtype === 'task_progress' ? 'running' : typeof raw.status === 'string' ? raw.status : 'completed';
  const usage = isRecord(raw.usage) ? raw.usage : {};
  return [
    {
      kind: 'subagent_update',
      toolUseId,
      status,
      tokens: countOrNull(usage.total_tokens),
      toolUses: countOrNull(usage.tool_uses),
      durationMs: countOrNull(usage.duration_ms),
    },
  ];
}

// control_response: la respuesta del CLI a un control_request nuestro. NO lleva el subtype de la
// peticion (solo `request_id`), asi que se discrimina por FORMA: si el payload trae el desglose de
// contexto, es la respuesta de `get_context_usage`. Cualquier otra (set_model, interrupt...) no
// produce evento: su efecto se observa por otros mensajes del stream. Un error del CLI tampoco se
// traga: se convierte en evento 'error' con su mensaje.
function normalizeControlResponse(raw: Record<string, unknown>): MageEvent[] {
  const response = raw.response;
  if (!isRecord(response)) return [];
  if (response.subtype === 'error') {
    const detail = typeof response.error === 'string' ? response.error : JSON.stringify(response.error);
    // No se decide aqui si esto es un error de la conversacion: se propaga con el request_id y
    // AgentSession, que sabe que peticiones son suyas, decide si el usuario debe verlo.
    const requestId = typeof response.request_id === 'string' ? response.request_id : '';
    return [{ kind: 'control_error', requestId, message: detail }];
  }
  const payload = response.response;
  if (!isRecord(payload)) return [];
  // Respuesta al `initialize` (D2): se reconoce por traer el catalogo de comandos, que ademas llega
  // CON descripcion (el system/init solo da los nombres).
  //
  // TRAMPA PARA EL FUTURO, dicha aqui a proposito: el `control_response` de EXITO no trae el `subtype`
  // de la peticion, solo el `request_id`, asi que el despacho es POR FORMA. Hoy no hay colision
  // (contexto se reconoce por `categories`+`totalTokens`), pero una TERCERA peticion propia con una
  // forma parecida obligaria a llevar un `Map<requestId, subtype>` en AgentSession en vez del `Set`
  // actual. No se adivina la forma: se correlaciona.
  if (Array.isArray(payload.commands)) {
    const parsed = InitializeResponseSchema.parse(payload);
    const commands = parsed.commands.map((command) => ({
      name: command.name,
      description: command.description ?? '',
      argumentHint: command.argumentHint ?? null,
      aliases: command.aliases ?? [],
    }));
    const subagents = parsed.agents.map((agent) => ({
      name: agent.name,
      description: agent.description ?? '',
      model: agent.model ?? null,
    }));
    // Dos eventos y no uno ampliado: `commands_available` conserva su forma, su reducer y sus tests.
    const events: MageEvent[] = [];
    if (commands.length > 0) events.push({ kind: 'commands_available', commands });
    if (subagents.length > 0) events.push({ kind: 'subagents_available', subagents });
    const models = parsed.models.map((model) => ({ id: model.value, label: model.displayName ?? model.value }));
    if (models.length > 0) events.push({ kind: 'models_available', models });
    // Modo real de la sesion ANTES del primer turno (P-026 2.3): una conversacion nueva se lanza sin
    // `--permission-mode` y adopta el que tenga la cuenta.
    const mode = parsed.current_permission_mode;
    if (mode !== undefined && mode.length > 0) events.push({ kind: 'permission_mode', mode });
    return events;
  }
  if (!Array.isArray(payload.categories) || typeof payload.totalTokens !== 'number') return [];
  const usage = ContextUsageSchema.parse(payload);
  return [
    {
      kind: 'context_usage',
      usage: {
        totalTokens: usage.totalTokens,
        maxTokens: usage.maxTokens,
        percentage: usage.percentage,
        categories: usage.categories.map((category) => ({
          name: category.name,
          tokens: category.tokens,
          isDeferred: category.isDeferred ?? false,
        })),
      },
    },
  ];
}

// Deltas de contenido: texto del asistente (efecto typing) y texto del PENSAMIENTO (2.5), que son dos
// eventos distintos porque se pintan en sitios distintos. El resto (json del input de una tool, firmas)
// se ignora. Extraccion defensiva: los stream_event son muy variables.
//
// El campo del delta de pensamiento se lee de forma TOLERANTE (`thinking` o `text`, lo que venga como
// string) en vez de fijar uno: la forma exacta no se ha medido contra el CLI real, y adivinar un nombre
// de campo ya ha salido caro en este proyecto tres veces. Con esto, si el CLI usa cualquiera de los
// dos, funciona; y si usa otro, no se emite nada — nunca se inventa texto.
function normalizeStreamDelta(raw: Record<string, unknown>): MageEvent[] {
  const event = raw.event;
  if (!isRecord(event) || event.type !== 'content_block_delta') return [];
  const delta = event.delta;
  if (!isRecord(delta)) return [];
  if (delta.type === 'text_delta' && typeof delta.text === 'string') {
    return [{ kind: 'stream_delta', text: delta.text }];
  }
  if (delta.type === 'thinking_delta') {
    const text = typeof delta.thinking === 'string' ? delta.thinking : typeof delta.text === 'string' ? delta.text : null;
    return text === null ? [] : [{ kind: 'thinking_delta', text }];
  }
  return [];
}

// Un mensaje assistant trae su TEXTO completo y 0..n bloques tool_use.
//
// El texto se emite como `assistant_text`, que el reducer del chat IGNORA a proposito (Mage lanza con
// `--include-partial-messages`, asi que ese texto ya esta pintado por los `stream_delta` y anadirlo lo
// duplicaria). Existe para las reglas de NOTIFICACION por regex del usuario, que necesitan el mensaje
// entero y no trozos sueltos. Hallazgo de la Fase B: la variante estaba modelada y consumida
// (`notify.ts`) pero NADIE la emitia, asi que esas reglas no se disparaban nunca.
function normalizeAssistant(raw: Record<string, unknown>): MageEvent[] {
  const message = raw.message;
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  // Limite de uso: MEDIDO en una transcripcion real (el CLI lo manda como un `assistant` marcado con
  // `error: "rate_limit"` y `apiErrorStatus: 429`, con el texto ya redactado dentro). No es texto del
  // asistente: es un aviso, y va al hilo como linea de sistema.
  if (raw.error === 'rate_limit') {
    return [{ kind: 'rate_limit', summary: assistantTextOf(message.content), resetsAtMs: null }];
  }
  const events: MageEvent[] = [];
  const text = assistantTextOf(message.content);
  if (text.length > 0) events.push({ kind: 'assistant_text', text });
  const local = localCommandOutput(raw, message, text);
  if (local !== null) events.push(local);
  const parent = typeof raw.parent_tool_use_id === 'string' && raw.parent_tool_use_id.length > 0 ? raw.parent_tool_use_id : null;
  for (const block of message.content) {
    const tool = toToolUse(block, parent);
    if (tool !== null) events.push({ kind: 'tool_use', tool });
  }
  return events;
}

// Comando local (P-028, grupo C): `local_command_run` es la marca medida; `model: "<synthetic>"` el
// respaldo, con `command: null`, para un sintetico que no sea comando. Va ADEMAS de `assistant_text`,
// que siguen necesitando las reglas de notificacion.
const SYNTHETIC_MODEL = '<synthetic>';

function localCommandOutput(raw: Record<string, unknown>, message: Record<string, unknown>, text: string): MageEvent | null {
  if (isRecord(raw.local_command_run)) {
    const run = LocalCommandRunSchema.parse(raw.local_command_run);
    return { kind: 'local_command_output', command: run.command.length > 0 ? run.command : null, args: run.args, text };
  }
  if (message.model !== SYNTHETIC_MODEL || text.length === 0) return null;
  return { kind: 'local_command_output', command: null, args: '', text };
}

// Concatena los bloques `text` de un mensaje del asistente (se ignoran `thinking` y `tool_use`).
function assistantTextOf(content: readonly unknown[]): string {
  return content
    .filter((block): block is { type: string; text: string } => isRecord(block) && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

// Un mensaje `user` de STDOUT puede ser el eco de uno o varios tool_result (resultado de tools ya
// ejecutadas) o un user normal. Solo nos interesan los tool_result; el content es variable, asi que
// filtramos defensivamente cada bloque. `durationMs` lo rellena AgentSession (aqui: null).
function normalizeUserToolResults(raw: Record<string, unknown>): MageEvent[] {
  // safeParse (no throw): un `user` es render best-effort; si no encaja, lo ignoramos. Solo lanzamos
  // en mensajes de los que DEPENDEMOS (permisos, result), no en el eco de mensajes de usuario.
  const parsed = ToolResultUserSchema.safeParse(raw);
  if (!parsed.success) return [];
  const content = parsed.data.message.content;
  if (!Array.isArray(content)) return []; // user normal (content string) -> nada que renderizar
  // El `tool_use_result` estructurado es hermano top-level del message (uno por turno de tool), asi que
  // se calcula UNA vez y se cuelga de cada bloque `tool_result` del mensaje. Eso solo es correcto si un
  // mensaje trae como mucho un `tool_result`; con dos (tool calls en paralelo) los dos recibirian el
  // filePath/diff del mismo fichero.
  //
  // MEDIDO el 2026-09-16 (auditoria B.1.7) sobre las 486 transcripciones reales de `~/.claude/projects`:
  // 20.382 mensajes con `tool_result` y NINGUNO con mas de uno; 20.391 con `tool_use` y ninguno con mas
  // de uno tampoco — este CLI reparte las tools en mensajes distintos en vez de agruparlas. El dia que
  // eso cambie, lo que hay que hacer es emparejar por `tool_use_id` en vez de adjuntar a todos.
  const file = extractFileInfo(raw);
  const subagent = parseSubagentRunInfo(raw.tool_use_result);
  const events: MageEvent[] = [];
  for (const block of content) {
    const result = ToolResultBlockSchema.safeParse(block);
    if (!result.success) continue; // saltar bloques que no sean tool_result
    const { tool_use_id, content: blockContent, is_error } = result.data;
    events.push({
      kind: 'tool_result',
      result: {
        toolUseId: tool_use_id,
        isError: is_error ?? false,
        output: flattenToolContent(blockContent),
        durationMs: null,
        ...(file === undefined ? {} : { file }),
        ...(subagent === null ? {} : { subagent }),
      },
    });
  }
  return events;
}

// Extrae la info del archivo del `tool_use_result` (best-effort; el campo es z.unknown en el
// protocolo). Write trae `content`; Edit trae `structuredPatch`. Sin filePath -> undefined.
function extractFileInfo(raw: Record<string, unknown>): ToolFileInfo | undefined {
  const tur = raw.tool_use_result;
  if (!isRecord(tur)) return undefined;
  // La RUTA puede venir en dos sitios: al nivel raiz (Write/Edit) o dentro de `file` (Read, que
  // devuelve `{ file: { filePath, content, numLines... } }`). Sin esto, una lectura llegaba a la UI sin
  // ruta y su preview se pintaba en texto plano por no saber de que lenguaje era.
  // Del `file` anidado se coge SOLO la ruta: su `content` es el mismo texto que ya viene en la salida
  // de la tool, y tomarlo aqui lo pintaria dos veces (una como salida y otra como "fichero escrito").
  const path = filePathOf(tur);
  if (path === null) return undefined;
  return {
    path,
    content: typeof tur.content === 'string' ? tur.content : null,
    structuredPatch: tur.structuredPatch ?? null,
  };
}


// Ruta del fichero afectado, mirando primero la raiz y luego el `file` anidado. null si no hay ninguna.
function filePathOf(tur: Record<string, unknown>): string | null {
  if (typeof tur.filePath === 'string') return tur.filePath;
  const nested = tur.file;
  if (isRecord(nested) && typeof nested.filePath === 'string') return nested.filePath;
  return null;
}

// Aplana el `content` de un tool_result a texto: string tal cual; array -> une los bloques de texto
// y marca las imagenes/otros como [imagen]/[contenido].
function flattenToolContent(content: string | unknown[]): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => {
      if (!isRecord(block)) return '';
      if (block.type === 'text' && typeof block.text === 'string') return block.text;
      if (block.type === 'image') return '[imagen]';
      return '[contenido]';
    })
    .join('');
}

function normalizeControlRequest(raw: Record<string, unknown>): MageEvent[] {
  const request = raw.request;
  if (!isRecord(request)) return [];
  // hook_callback: solo llega si Mage registro hooks en el `initialize` (D2). El CLI ESPERA respuesta.
  if (request.subtype === 'hook_callback') return [toHookFired(raw)];
  // Del resto solo can_use_tool nos concierne (mcp/elicitation no ocurren sin registrarlos).
  if (request.subtype !== 'can_use_tool') return [];
  const parsed = CanUseToolSchema.parse(raw);
  return [
    {
      kind: 'permission_request',
      request: {
        requestId: parsed.request_id,
        toolUseId: parsed.request.tool_use_id,
        toolName: parsed.request.tool_name,
        input: parsed.request.input,
        description: parsed.request.description ?? null,
        // `?? false` / `?? null`: la mayoria de las tools no traen estos dos campos, y su ausencia
        // significa "permiso normal", no "dato desconocido".
        requiresUserInteraction: parsed.request.requires_user_interaction ?? false,
        displayName: parsed.request.display_name ?? null,
      },
    },
  ];
}

// Traduce un hook_callback a evento de seguimiento. `detail` recoge el dato util del evento cuando lo
// hay (mensaje de la Notification, tool de PreToolUse); el resto del input no se propaga: puede traer
// rutas y el ultimo mensaje del modelo, y esto es telemetria de ciclo de vida, no contenido.
function toHookFired(raw: Record<string, unknown>): MageEvent {
  const parsed = HookCallbackSchema.parse(raw);
  const { input } = parsed.request;
  return {
    kind: 'hook_fired',
    requestId: parsed.request_id,
    event: input.hook_event_name,
    detail: input.message ?? input.tool_name ?? null,
  };
}

// `rate_limit_event` del stream, MEDIDO el 2026-09-14 contra el CLI 2.1.270 (Fase 9, S3). Payload real:
//   {status, resetsAt, rateLimitType, overageStatus, isUsingOverage,
//    unifiedWindows: {five_hour: {utilization, resetsAt}, seven_day: {...}}}
//
// Tres cosas que la spec del fuente NO decia y que hay que respetar aqui:
//   1. `utilization` NO esta en la raiz: vive dentro de `unifiedWindows`. Leerlo de la raiz da
//      `undefined` siempre.
//   2. Es FRACCION (0,36), no porcentaje. El endpoint de uso da 36 para el mismo instante, asi que
//      aqui se convierte — si no, el panel mostraria 0 %.
//   3. `resetsAt` va en SEGUNDOS, no en milisegundos.
//
// Emite DOS cosas distintas a proposito: la foto de consumo (`usage_limits`, en cada turno) y, solo
// si el CLI ha RECHAZADO el turno, el aviso al usuario (`rate_limit`). Emitir el aviso con
// `status: "allowed"` encenderia el banner de "limite alcanzado" en cada turno normal.
function normalizeRateLimitEvent(raw: Record<string, unknown>): MageEvent[] {
  const info = RateLimitEventSchema.safeParse(raw).data?.rate_limit_info;
  const events: MageEvent[] = [];

  const fiveHour = toStreamWindow(info?.unifiedWindows?.five_hour);
  const sevenDay = toStreamWindow(info?.unifiedWindows?.seven_day);
  if (fiveHour !== null || sevenDay !== null) events.push({ kind: 'usage_limits', fiveHour, sevenDay });

  // El texto sigue aceptandose como antes: si el CLI manda uno, es un mensaje para el usuario y no
  // se reescribe. Sin texto, un `rejected` ya es motivo suficiente — y ahora con `resetsAt` de verdad.
  const candidates = [raw.message, raw.text, raw.summary, isRecord(raw.rate_limit) ? raw.rate_limit.message : undefined];
  const summary = candidates.find((value): value is string => typeof value === 'string' && value.trim().length > 0);
  const rejected = info?.status === 'rejected';
  if (summary !== undefined || rejected) {
    events.push({ kind: 'rate_limit', summary: summary ?? '', resetsAtMs: parseEpochMs(info?.resetsAt) });
  }
  return events;
}

// Una ventana del stream -> el tipo comun del panel de Uso. `utilization` fuera de 0..1 NO es lo
// medido: se descarta la ventana entera en vez de inventar un porcentaje (un 3600 % clamped a 100 %
// seria peor que no decir nada). Se redondea a entero para que cuadre con la granularidad del
// endpoint y no salga un 36.000000000000004 por el camino del float.
function toStreamWindow(window: { utilization?: number | null; resetsAt?: number | null } | null | undefined): UsageWindowInfo | null {
  const fraction = window?.utilization;
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
  return { utilization: Math.round(fraction * 100), resetsAt: parseEpochMs(window?.resetsAt) };
}

function normalizeResult(raw: Record<string, unknown>): MageEvent[] {
  const parsed = ResultSchema.parse(raw);
  const isError = parsed.is_error ?? parsed.subtype !== 'success';
  const origin = isRecord(raw.origin) && typeof raw.origin.kind === 'string' ? raw.origin.kind : undefined;
  return [
    {
      kind: 'result',
      result: {
        isError,
        subtype: parsed.subtype,
        numTurns: parsed.num_turns ?? null,
        ...(origin === undefined ? {} : { origin }),
      },
    },
  ];
}

// Extrae un ToolUse de un bloque de contenido, o null si no es un tool_use valido.
function toToolUse(block: unknown, parentToolUseId: string | null): ToolUse | null {
  if (!isRecord(block) || block.type !== 'tool_use') return null;
  if (typeof block.id !== 'string' || typeof block.name !== 'string') return null;
  const input = isRecord(block.input) ? block.input : {};
  return parentToolUseId === null
    ? { toolUseId: block.id, toolName: block.name, input }
    : { toolUseId: block.id, toolName: block.name, input, parentToolUseId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
