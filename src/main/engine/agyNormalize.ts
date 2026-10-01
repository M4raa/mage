import { z } from 'zod';
import type { MageEvent, TurnUsage } from '@shared/events';
import { toolNames } from './normalize';

// Traduccion del NDJSON de `agy --output-format stream-json` al modelo de eventos COMUN de Mage (E3).
// Modulo PURO con esquemas Zod en la frontera, como normalize.ts/schemas.ts para Claude; la diferencia
// es que aqui el dialecto es propio de `agy` y solo lo consume su adapter, asi que esquemas y traduccion
// viven en el mismo fichero.
//
// Protocolo MEDIDO contra `agy` 1.1.11 el 2026-08-11 (4 turnos reales, ver informe de E3):
//   {"event":"init","conversation_id":"…","init":{"model","cwd","tools":[…56…],"permission_mode"}}
//   {"event":"step_update","step_update":{"conversation_id","step_index","state","step_type",
//      "text_delta"?,"tool_name"?,"tool_info"?,"duration_seconds"?,"usage"?}}
//   {"event":"result","result":{"conversation_id","status","response","error"?,"num_turns","usage"}}
// `step_type` observados: user_input · agent_response · tool · checkpoint · system_message · unknown.
// `state`: ACTIVE -> DONE | ERROR.

// Uso de tokens de `agy`. Enteros no negativos (tokens nunca son float). Todos los campos son
// opcionales a proposito: el uso es TELEMETRIA, y tumbar un turno entero porque el CLI dejo de
// reportar un contador seria peor que perder el contador. Lo que NO se hace es inventarlo: lo que no
// llega viaja como null hasta la UI.
const AgyUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    thinking_tokens: z.number().int().nonnegative().optional(),
    cache_read_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const AgyInitSchema = z.object({
  event: z.literal('init'),
  conversation_id: z.string(),
  init: z
    .object({
      model: z.string(),
      cwd: z.string(),
      tools: z.array(z.unknown()).optional(),
      permission_mode: z.string().optional(),
    })
    .passthrough(),
});

const AgyStepUpdateSchema = z.object({
  event: z.literal('step_update'),
  step_update: z
    .object({
      step_index: z.number().int().nonnegative(),
      state: z.string(),
      step_type: z.string(),
      text_delta: z.string().optional(),
      tool_name: z.string().optional(),
      tool_info: z
        .object({
          name: z.string().optional(),
          parameters: z.record(z.unknown()).optional(),
          // Por que fallo la herramienta. MEDIDO en 1.2.14: en una denegacion trae el COMANDO exacto
          // (`permission check failed for command "…"` o `Permission denied for command(…)`).
          error: z.object({ message: z.string().optional() }).passthrough().optional(),
        })
        .passthrough()
        .optional(),
      duration_seconds: z.number().optional(),
      usage: AgyUsageSchema.optional(),
    })
    .passthrough(),
});

const AgyResultSchema = z.object({
  event: z.literal('result'),
  result: z
    .object({
      conversation_id: z.string().optional(),
      status: z.string(),
      error: z.string().optional(),
      num_turns: z.number().int().nonnegative().optional(),
      usage: AgyUsageSchema.optional(),
      // Acciones denegadas por no tener a quien preguntar (medido en 1.2.14; sin el comando). Una regla
      // `deny` explicita NO aparece aqui.
      denied_actions: z
        .array(z.object({ action: z.string().optional(), display_name: z.string().optional() }).passthrough())
        .optional(),
    })
    .passthrough(),
});

// Estados y tipos de paso que el traductor reconoce por nombre.
const STATE_ACTIVE = 'ACTIVE';
const STATE_ERROR = 'ERROR';
const STEP_TOOL = 'tool';
const STEP_AGENT_RESPONSE = 'agent_response';
const RESULT_SUCCESS = 'SUCCESS';

// Prefijo del id sintetico de tool. `agy` no da un id por tool call: el par (conversacion, step_index)
// es lo unico estable, y step_index es monotono dentro de una conversacion (medido: 0..3 el turno 1,
// 4..8 el 2, 9..13 el 3), asi que basta para emparejar el ACTIVE con su DONE/ERROR.
const TOOL_ID_PREFIX = 'agy-step-';

// Traduce UNA linea ya JSON-parseada a 0..n eventos comunes.
// Contrato (igual que normalizeRawEvent de Claude): [] para lo que no nos interesa; LANZA Error si un
// evento que SI reconocemos llega con forma invalida (AgentSession lo convierte en evento 'error').
// `deniedReported`: el turno ya dijo QUE comando se denego (paso a paso), asi que el resumen generico
// del `result` sobra.
export function normalizeAgyEvent(raw: unknown, deniedReported = false): MageEvent[] {
  if (!isRecord(raw) || typeof raw.event !== 'string') return [];
  switch (raw.event) {
    case 'init':
      return normalizeInit(raw);
    case 'step_update':
      return normalizeStepUpdate(raw);
    case 'result':
      return normalizeResult(raw, deniedReported);
    default:
      return [];
  }
}

// Estado de UNA sesion persistente de agy encima del traductor puro:
//   - el `usage` de cada `result` es ACUMULADO por proceso (medido en 1.2.14: el turno 2 trae
//     input 24 513 ≈ 2 × 12 215, output 2 + 2), asi que se resta el del turno anterior;
//   - si un paso ya dijo que comando se denego, el resumen generico del `result` no se repite.
export class AgyTurnTracker {
  private previous: TurnUsage | null = null;
  private deniedReported = false;

  // Proceso nuevo (arranque o relanzado tras un corte): su contador empieza en cero (medido).
  resetProcess(): void {
    this.previous = null;
    this.deniedReported = false;
  }

  normalize(raw: unknown): MageEvent[] {
    const events = normalizeAgyEvent(raw, this.deniedReported);
    return events.map((event) => this.track(event));
  }

  private track(event: MageEvent): MageEvent {
    if (event.kind === 'error' && event.message.startsWith(DENIED_PREFIX)) this.deniedReported = true;
    if (event.kind !== 'result') return event;
    this.deniedReported = false;
    const cumulative = event.result.usage;
    if (cumulative === undefined) return event;
    const delta = subtractUsage(cumulative, this.previous);
    this.previous = cumulative;
    return { ...event, result: { ...event.result, usage: delta } };
  }
}

function subtractUsage(current: TurnUsage, previous: TurnUsage | null): TurnUsage {
  const minus = (now: number | null, before: number | null | undefined): number | null =>
    now === null ? null : Math.max(0, now - (before ?? 0));
  return {
    inputTokens: minus(current.inputTokens, previous?.inputTokens),
    outputTokens: minus(current.outputTokens, previous?.outputTokens),
    totalTokens: minus(current.totalTokens, previous?.totalTokens),
    thinkingTokens: minus(current.thinkingTokens, previous?.thinkingTokens),
    cacheReadTokens: minus(current.cacheReadTokens, previous?.cacheReadTokens),
  };
}

// `init` -> session_init. El `sessionId` que viaja es el `conversation_id` de AGY (no el de Mage): es
// lo que hay que devolverle en `--conversation` para que el siguiente proceso continue la conversacion.
// `mcpServers`/`slashCommands` van vacios: `agy` no los reporta en su init.
function normalizeInit(raw: Record<string, unknown>): MageEvent[] {
  const parsed = AgyInitSchema.parse(raw);
  return [
    {
      kind: 'session_init',
      sessionId: parsed.conversation_id,
      model: parsed.init.model,
      tools: toolNames(parsed.init.tools),
      mcpServers: [],
      slashCommands: [],
      skills: [],
      plugins: [],
      pluginErrors: [],
    },
  ];
}

// `step_update` -> deltas de texto, tool_use/tool_result y, si el paso murio, un error VISIBLE.
function normalizeStepUpdate(raw: Record<string, unknown>): MageEvent[] {
  const step = AgyStepUpdateSchema.parse(raw).step_update;
  const events: MageEvent[] = [];

  const denial = deniedCommandMessage(step.tool_info?.error?.message);
  if (step.step_type === STEP_TOOL && step.tool_name !== undefined) {
    events.push(...toolEvents(step, denial?.message ?? null));
  } else if (step.step_type === STEP_AGENT_RESPONSE && step.text_delta !== undefined && step.text_delta.length > 0) {
    // ponytail: cada `text_delta` se APILA (semantica de delta, la que mide el spike: un unico evento
    // por paso `agent_response`, ya en estado DONE). Techo: si una version futura emitiera tambien el
    // paso ACTIVE con el texto ACUMULADO, se duplicaria; se sube quedandose solo con el sufijo nuevo
    // por step_index (y eso exige estado, asi que dejaria de ser un traductor puro por linea).
    events.push({ kind: 'stream_delta', text: step.text_delta });
  }

  // Un paso en ERROR NO se traga: el `result` global de `agy` sigue diciendo SUCCESS aunque un paso
  // haya fallado (medido en 1.1.2 y 1.1.11), asi que si esto no se pinta el usuario ve datos falsos. Una
  // DENEGACION se dice siempre con su comando: medido en 1.2.14, su paso sale unas veces ERROR y otras
  // DONE, asi que el `state` no sirve de señal.
  if (denial !== null && step.state !== STATE_ACTIVE) {
    events.push({ kind: 'error', message: denial.message, ...(denial.command === undefined ? {} : { deniedCommand: denial.command }) });
  }
  else if (step.state === STATE_ERROR) events.push({ kind: 'error', message: describeFailedStep(step) });
  return events;
}

// Prefijo de los avisos de comando denegado: el tracker lo usa para no repetir el resumen del result.
const DENIED_PREFIX = 'agy denegó';
// Las dos formas medidas en 1.2.14: `permission check failed for command "<cmd>": …` (sin regla) y
// `Permission denied for command(<cmd>). Matches user-configured deny rule.` (regla deny).
const DENIED_COMMAND_PATTERNS: readonly RegExp[] = [/for command "((?:[^"\\]|\\.)*)"/, /for command\((.*)\)\./];
const DENY_RULE_HINT = 'deny rule';

// Aviso para el usuario a partir del error del paso, con el comando EXACTO (que la UI ofrece permitir en
// la conversacion siguiente: agy lee sus reglas al lanzar, medido). null = no es una denegacion.
function deniedCommandMessage(errorMessage: string | undefined): { readonly message: string; readonly command?: string } | null {
  if (errorMessage === undefined || !/permission/i.test(errorMessage)) return null;
  const command = DENIED_COMMAND_PATTERNS.map((pattern) => pattern.exec(errorMessage)?.[1]).find((match) => match !== undefined);
  const what = command === undefined ? 'una acción' : `el comando «${command}»`;
  const message = errorMessage.includes(DENY_RULE_HINT)
    ? `${DENIED_PREFIX} ${what}: lo prohíbe una regla deny.`
    : `${DENIED_PREFIX} ${what}: sin pantalla no tiene a quién pedir permiso y lo deniega.`;
  return command === undefined ? { message } : { message, command };
}

// ACTIVE -> tool_use (con sus parametros); DONE/ERROR -> tool_result. `output` vacio: `agy` no publica
// la salida de la tool en su stream (a diferencia del CLI de Claude), y fabricarla seria mentir. Una
// denegacion es un resultado con error aunque el paso diga DONE.
function toolEvents(step: z.infer<typeof AgyStepUpdateSchema>['step_update'], denial: string | null): MageEvent[] {
  const toolUseId = `${TOOL_ID_PREFIX}${step.step_index}`;
  if (step.state === STATE_ACTIVE) {
    return [{ kind: 'tool_use', tool: { toolUseId, toolName: step.tool_name ?? '', input: step.tool_info?.parameters ?? {} } }];
  }
  const isError = step.state === STATE_ERROR || denial !== null;
  const output = denial ?? (isError ? 'agy no pudo completar esta herramienta (state ERROR).' : '');
  // durationMs lo mide AgentSession emparejando tool_use -> tool_result
  return [{ kind: 'tool_result', result: { toolUseId, isError, output, durationMs: null } }];
}

// `result` -> result (con el uso del proceso, que el tracker convierte en el del turno) y, si `agy`
// reporta un fallo o denego acciones sin decir cuales, un aviso visible antes.
function normalizeResult(raw: Record<string, unknown>, deniedReported: boolean): MageEvent[] {
  const result = AgyResultSchema.parse(raw).result;
  const isError = result.status !== RESULT_SUCCESS;
  const events: MageEvent[] = [];
  if (isError) {
    const detail = result.error ?? `estado ${result.status}`;
    events.push({ kind: 'error', message: `agy termino el turno con error: ${detail}` });
  }
  const denied = result.denied_actions ?? [];
  if (denied.length > 0 && !deniedReported) {
    const names = [...new Set(denied.map((action) => action.display_name ?? action.action ?? '?'))].join(', ');
    events.push({ kind: 'error', message: `${DENIED_PREFIX} ${denied.length} acción(es) (${names}): sin pantalla no tiene a quién pedir permiso.` });
  }
  const usage = toTurnUsage(result.usage);
  events.push({
    kind: 'result',
    result: {
      isError,
      subtype: result.status.toLowerCase(),
      numTurns: result.num_turns ?? null,
      ...(usage === null ? {} : { usage }),
    },
  });
  return events;
}

// Uso del turno tal cual lo reporta `agy`, o null si no trae ninguno de los contadores. Lo que falte
// viaja como null (nunca como 0: "no lo reporto" y "gasto cero" no son lo mismo).
function toTurnUsage(usage: z.infer<typeof AgyUsageSchema> | undefined): TurnUsage | null {
  if (usage === undefined) return null;
  const fields = [usage.input_tokens, usage.output_tokens, usage.total_tokens, usage.thinking_tokens, usage.cache_read_tokens];
  if (fields.every((value) => value === undefined)) return null;
  return {
    inputTokens: usage.input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    thinkingTokens: usage.thinking_tokens ?? null,
    cacheReadTokens: usage.cache_read_tokens ?? null,
  };
}

// Mensaje del paso fallido: dice QUE paso y de que tipo, porque `agy` no adjunta ningun detalle del
// error en el propio step_update (medido: sus claves son fijas).
function describeFailedStep(step: z.infer<typeof AgyStepUpdateSchema>['step_update']): string {
  const what = step.tool_name !== undefined ? `la herramienta ${step.tool_name}` : `el paso ${step.step_type}`;
  return (
    `agy marco ${what} (paso ${step.step_index}) como fallida y aun asi puede reportar el turno como ` +
    `correcto: revisa si lo que pediste se hizo de verdad.`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
