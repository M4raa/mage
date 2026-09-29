import { z } from 'zod';

// Esquemas Zod del protocolo stream-json del CLI (la FRONTERA de confianza). Reimplementados
// desde el protocolo (spec), no copiados del fuente propietario. Solo validamos con rigor los
// mensajes de cuyos campos DEPENDEMOS (permisos, result, cancelacion); los stream_event —de forma
// muy variable— se extraen defensivamente en normalize.ts sin esquema estricto.

// system/init: banner de arranque de sesion.
export const InitSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  session_id: z.string(),
  model: z.string(),
  tools: z.array(z.unknown()).optional(),
  // Servidores MCP que la sesion REALMENTE cargo, con su estado. Forma verificada contra el stream
  // del CLI 2.1.220: [{ name, status }] con status 'connected' | 'pending' | ... Este evento es el
  // UNICO sitio donde el estado de MCP se puede observar de verdad (preguntarle al modelo si tiene
  // una herramienta o llamar a `claude mcp list` no observan la sesion: dan respuestas falsas).
  // Informativo, no crítico: si llega con forma rara se descarta a [] en vez de tumbar el arranque.
  mcp_servers: z
    .array(z.object({ name: z.string(), status: z.string() }))
    .catch([])
    .optional(),
  // Comandos '/' reales de la sesion (array de nombres), incluidos los del proyecto y los que
  // aportan plugins/skills. Misma tolerancia: es dato informativo.
  slash_commands: z.array(z.string()).catch([]).optional(),
  // Modo de permiso con el que arranco la sesion (P-026 2.3). Informativo: forma rara -> se ignora.
  permissionMode: z.string().optional().catch(undefined),
  // Skills y plugins cargados (P-026 2.6), medidos en 2.1.283. Informativos y tolerantes: una forma nueva
  // degrada el panel del Inspector, nunca el arranque. `plugin_errors` no esta medido (no llego sin
  // errores): se acepta cualquier elemento y se traduce a texto al normalizar.
  skills: z.array(z.string()).catch([]).optional(),
  plugins: z
    .array(z.object({ name: z.string(), source: z.string().optional() }).passthrough())
    .catch([])
    .optional(),
  plugin_errors: z.array(z.unknown()).catch([]).optional(),
});

// system/session_state_changed: estado del worker (idle/running/requires_action).
export const SessionStateSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('session_state_changed'),
  state: z.enum(['idle', 'running', 'requires_action']),
});

// system/compact_boundary: marca de compactacion del contexto (M2.4). El CLI lo emite tras
// compactar (manual via /compact o automatica). Laxo: compact_metadata/trigger con fallback.
export const CompactBoundarySchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('compact_boundary'),
  compact_metadata: z
    .object({ trigger: z.string().optional() })
    .passthrough()
    .optional(),
});

// control_request{can_use_tool}: peticion de permiso (CLI -> Mage).
export const CanUseToolSchema = z.object({
  type: z.literal('control_request'),
  request_id: z.string(),
  request: z
    .object({
      subtype: z.literal('can_use_tool'),
      tool_name: z.string(),
      input: z.record(z.unknown()),
      tool_use_id: z.string(),
      description: z.string().nullish(),
      // MEDIDO en el control_request de AskUserQuestion: marca las peticiones que esperan una
      // RESPUESTA humana y no un permiso. Opcional: la mayoria de las tools no lo traen.
      requires_user_interaction: z.boolean().optional(),
      // Nombre para humanos que da el CLI. `nullish`: viene ausente o null segun la tool.
      display_name: z.string().nullish(),
    })
    .passthrough(),
});

// control_cancel_request: cancela un permiso aun abierto.
export const CancelSchema = z.object({
  type: z.literal('control_cancel_request'),
  request_id: z.string(),
});

// Bloque tool_result dentro del content de un mensaje `user` (resultado de ejecutar una tool).
// `content` puede ser string (la mayoria de tools de texto) o array de bloques (imagenes/MCP).
export const ToolResultBlockSchema = z.object({
  type: z.literal('tool_result'),
  tool_use_id: z.string(),
  content: z.union([z.string(), z.array(z.unknown())]),
  is_error: z.boolean().optional(),
});

// Mensaje `user` de STDOUT: puede ser eco de tool_result(s) o un user normal. Validamos flojo (el
// content es variable) y filtramos los bloques tool_result en normalize.ts de forma defensiva.
export const ToolResultUserSchema = z.object({
  type: z.literal('user'),
  message: z
    .object({
      role: z.literal('user'),
      content: z.union([z.string(), z.array(z.unknown())]),
    })
    .passthrough(),
});

// control_response del control_request `get_context_usage` (D3). Forma VERIFICADA en vivo contra el
// CLI 2.1.220 (no solo contra el fuente: la respuesta real trae ademas `autocompactSource`, que no
// figura en el esquema del fuente leido). Se validan solo los campos que Mage usa; el resto
// (`gridRows`, colores de la TUI, `memoryFiles`, `mcpTools`) se ignora deliberadamente.
// `passthrough` en las categorias: el CLI puede anadir campos y eso no debe invalidar la respuesta.
export const ContextUsageSchema = z.object({
  totalTokens: z.number(),
  maxTokens: z.number(),
  percentage: z.number(),
  categories: z.array(
    z
      .object({
        name: z.string(),
        tokens: z.number(),
        isDeferred: z.boolean().optional(),
      })
      .passthrough(),
  ),
});

// `rate_limit_event` del stream (Fase 9, S3). LAXO a proposito, como el resto de la frontera: el
// protocolo no es un contrato estable, asi que solo se exige el tipo de lo que se consume y todo lo
// demas pasa. Un campo que llegue con otra forma deja su ventana fuera; nunca tumba el turno.
//
// `unifiedWindows` NO aparece en la documentacion publicada del protocolo: se descubrio midiendo, y es donde
// vive de verdad el `utilization` (ver normalize.ts).
const RateLimitWindowSchema = z
  .object({
    utilization: z.number().nullish(),
    resetsAt: z.number().nullish(),
  })
  .passthrough();

export const RateLimitEventSchema = z
  .object({
    rate_limit_info: z
      .object({
        status: z.string().nullish(),
        rateLimitType: z.string().nullish(),
        resetsAt: z.number().nullish(),
        unifiedWindows: z
          .object({
            five_hour: RateLimitWindowSchema.nullish(),
            seven_day: RateLimitWindowSchema.nullish(),
          })
          .passthrough()
          .nullish(),
      })
      .passthrough()
      .nullish(),
  })
  .passthrough();

// control_request `hook_callback`: el CLI avisa de que un hook REGISTRADO por nosotros ha disparado
// (D2). Forma verificada en vivo contra el CLI 2.1.220. `input` varia por evento (trae session_id,
// cwd, prompt, last_assistant_message, message...), asi que solo se exige `hook_event_name` y el resto
// pasa tal cual: es dato de seguimiento, no un contrato del que dependamos campo a campo.
// IMPORTANTE: el CLI ESPERA una respuesta a este control_request; si no llega, la sesion se bloquea
// hasta el timeout que se declaro al registrar el hook.
export const HookCallbackSchema = z.object({
  type: z.literal('control_request'),
  request_id: z.string(),
  request: z.object({
    subtype: z.literal('hook_callback'),
    callback_id: z.string(),
    input: z
      .object({
        hook_event_name: z.string(),
        message: z.string().optional(),
        tool_name: z.string().optional(),
      })
      .passthrough(),
  }),
});

// Respuesta del control_request `initialize`: trae los comandos "/" reales CON descripcion (el
// `system/init` solo da los nombres) y los SUBAGENTES declarados. El resto (output_style...) se sigue
// ignorando. Tolerante en los dos arrays: `.catch([])` es lo que impide que un campo nuevo o con forma
// rara del CLI tumbe el catalogo entero — el caso que de verdad hay que evitar aqui es perder los 159
// comandos porque `agents` cambio de forma en una version del CLI.
export const InitializeResponseSchema = z.object({
  commands: z
    .array(
      z
        .object({
          name: z.string(),
          description: z.string().optional(),
          argumentHint: z.string().optional(),
          // No documentado en el esquema del SDK pero presente en la respuesta real: validacion laxa.
          aliases: z.array(z.string()).optional(),
        })
        .passthrough(),
    )
    .catch([]),
  agents: z
    .array(
      z
        .object({
          name: z.string(),
          description: z.string().optional(),
          model: z.string().nullish(),
        })
        .passthrough(),
    )
    .catch([]),
  // Modo de permiso en el que esta la sesion (MEDIDO en 2.1.283: `default` sin `--permission-mode`, o
  // el de la cuenta). Llega ANTES de cualquier turno, asi que es lo que adopta una pestaña nueva.
  current_permission_mode: z.string().optional().catch(undefined),
  // Catalogo de modelos de la cuenta (P-026 2.4). MEDIDO en 2.1.283: `value`, `displayName`,
  // `description`, `resolvedModel`, `supportsEffort`… y NINGUN `disabled`. Tolerante como los demas.
  models: z
    .array(z.object({ value: z.string().min(1), displayName: z.string().optional() }).passthrough())
    .catch([]),
});

// result: terminador autoritativo del turno.
export const ResultSchema = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean().optional(),
  num_turns: z.number().nullish(),
});

// Comando LOCAL del CLI (P-028, grupo C). MEDIDO contra 2.1.284 (`/rename`, `/context`, `/mcp`...): no
// hay deltas; llega UN `assistant` con `message.model: "<synthetic>"`, el texto en `content` y
// `local_command_run: {command, args}`. Tolerante: es render, nunca tumba la conversacion.
export const LocalCommandRunSchema = z
  .object({ command: z.string().catch(''), args: z.string().catch('') })
  .passthrough()
  .catch({ command: '', args: '' });

// `conversation_reset` (P-028, `/clear`). MEDIDO contra 2.1.284 con `spike/engine-spike.mjs --clear`:
// `{type, new_conversation_id, trigger: "clear", user_message_uuid, timestamp, uuid, session_id}`, con
// `session_id` todavia el VIEJO; despues llegan un `system/init` y un `result` con el id nuevo, y el CLI
// escribe un `.jsonl` nuevo. Estricto en el id: sin el, Mage seguiria leyendo la transcripcion vieja.
export const ConversationResetSchema = z
  .object({ type: z.literal('conversation_reset'), new_conversation_id: z.string().min(1) })
  .passthrough();

export type InitEvent = z.infer<typeof InitSchema>;
export type CanUseToolEvent = z.infer<typeof CanUseToolSchema>;
export type ResultEvent = z.infer<typeof ResultSchema>;
