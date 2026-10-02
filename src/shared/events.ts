// Modelo de eventos COMUN de Mage.
// Toda la UI habla ESTE modelo, nunca el dialecto de ningun proveedor. El adapter de cada
// proveedor (Claude en el MVP) normaliza su salida cruda a esta union en la frontera (ver
// src/main/engine/normalize.ts). Es la costura que hace el nucleo provider-agnostic.

import type { UsageWindowInfo } from './usage';
import type { ProviderModel } from './providers';
import type { SubagentRunInfo } from './subagentRun';

// Estado del worker de una sesion (espejo neutral de session_state_changed del CLI).
export type SessionState = 'idle' | 'running' | 'requires_action';

// Uso de tokens de UN turno, tal y como lo reporta el proveedor en su terminador (E3). Enteros: los
// tokens nunca son float. `null` en un campo = el proveedor NO lo reporta (que no es lo mismo que
// cero). Hoy solo lo trae `agy`, cuyo `result` publica input/output/thinking/cache_read/total; el CLI
// de Claude no da uso en su `result` (el suyo se lee del historial de la cuenta, ver panel de Uso).
export interface TurnUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly thinkingTokens: number | null;
  readonly cacheReadTokens: number | null;
  // true = el proveedor no dio el uso y Mage lo ESTIMO (runtime propio, ficha D14 de P-032).
  readonly estimated?: boolean;
}

// Resultado terminal de un turno (neutralizado desde el `result` del CLI).
export interface ResultInfo {
  readonly isError: boolean;
  readonly subtype: string; // 'success' | 'error_during_execution' | 'error_max_turns' | ...
  readonly numTurns: number | null;
  // Uso del turno cuando el proveedor lo reporta (E3, `agy`). Ausente = no lo reporta.
  readonly usage?: TurnUsage;
  // Quien abrio el turno (`origin.kind` del `result`). MEDIDO en 2.1.284: `'task-notification'` cuando
  // lo abrio el CLI solo, al terminar un subagente en segundo plano. Ausente en un turno del usuario.
  readonly origin?: string;
}

// Peticion de permiso normalizada (desde control_request{can_use_tool}).
export interface PermissionRequest {
  readonly requestId: string;
  readonly toolUseId: string;
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly description: string | null;
  // MEDIDO en el control_request: marca las peticiones que esperan una RESPUESTA humana (p.ej.
  // AskUserQuestion) y no un permiso. Se modela porque decide COMO se pinta. false si el CLI no lo manda.
  readonly requiresUserInteraction: boolean;
  // Nombre para humanos que da el CLI (`display_name`); null si no viene. Se prefiere a `toolName`.
  readonly displayName: string | null;
  // Solo el runtime propio: la peticion es por algo FUERA del proyecto o por red (su motivo va en
  // `description`). «Permitir siempre» no se ofrece ni se aplica a estas (D2 de P-033).
  readonly outsideProject?: boolean;
}

// Uso de una llamada a tool ya emitida por el asistente (para render de tool calls).
export interface ToolUse {
  readonly toolUseId: string;
  readonly toolName: string;
  readonly input: Readonly<Record<string, unknown>>;
  // `tool_use_id` del subagente (Task/Agent) que la lanzo; AUSENTE en el agente principal. MEDIDO (P-026
  // 3.4, CLI 2.1.283, `engine-spike --subagent`): los pasos de un subagente llegan como `assistant`
  // completos con `parent_tool_use_id`, sin deltas; es lo que permite atribuirle cada paso.
  readonly parentToolUseId?: string;
}

// Info del archivo afectado por una tool de fichero (Write/Edit), extraida del `tool_use_result`
// estructurado del CLI. Para previsualizar el contenido/diff y ofrecer abrir/guardar el archivo.
export interface ToolFileInfo {
  readonly path: string; // ruta absoluta del archivo
  readonly content: string | null; // contenido completo (Write/create); null si no disponible
  // Hunks del `structuredPatch` TAL CUAL los manda el CLI (Edit). Viaja sin interpretar a proposito:
  // aplanarlos aqui a `string[]` —como se hacia antes— tiraba `oldStart`/`newStart`, que es justo lo
  // que hace falta para numerar el diff. Quien lo interpreta es el UNICO parser del renderer
  // (`diffLines.ts`), el mismo que usa la ruta de la transcripcion.
  readonly structuredPatch: unknown;
}

// Resultado de una tool ya ejecutada (desde el mensaje `user` con bloque tool_result del CLI).
// `output` es el contenido aplanado a texto; `durationMs` lo mide AgentSession emparejando por
// toolUseId (null si no se pudo medir). El CLI no reporta exit_code ni duracion por-tool.
// `file` viene del `tool_use_result` estructurado (solo tools de fichero).
export interface ToolResult {
  readonly toolUseId: string;
  readonly isError: boolean;
  readonly output: string;
  readonly durationMs: number | null;
  readonly file?: ToolFileInfo;
  // Lo que cuenta el `tool_use_result` de un `Agent`/`Task` (P-028 37a). Ausente en el resto.
  readonly subagent?: SubagentRunInfo;
}

// Una categoria del desglose de la ventana de contexto que reporta el CLI (system prompt, tools,
// skills, memoria, mensajes, buffer de autocompactacion, espacio libre...). `isDeferred` marca lo que
// esta declarado pero aun no cargado (p.ej. tools MCP diferidas).
export interface ContextCategory {
  readonly name: string;
  readonly tokens: number;
  readonly isDeferred: boolean;
}

// Ocupacion REAL de la ventana de contexto (D3), tal y como la calcula el CLI. Mucho mas fiable que
// derivarla de la transcripcion: incluye system prompt, tools, skills y memoria (que suman decenas de
// miles de tokens antes del primer mensaje) y trae la ventana EFECTIVA del modelo, que no coincide con
// el 200k/1M que se adivina por el nombre.
export interface ContextUsage {
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly percentage: number;
  readonly categories: readonly ContextCategory[];
}

// Comando "/" descubierto en el arranque, con su descripcion real cuando el CLI la da (D2/D4).
export interface SlashCommandInfo {
  readonly name: string;
  readonly description: string;
  // Pista de texto del argumento que espera el comando (medido: 21 de 159 la traen). Se PINTA en el
  // popover; NO se inserta al completar, porque no es un valor sino una descripcion.
  readonly argumentHint: string | null;
  // Nombres alternativos del comando. Campo NO documentado en el esquema del SDK pero presente en la
  // respuesta real al `initialize`, asi que se valida de forma tolerante. Vacio si no vienen.
  readonly aliases: readonly string[];
}

// Subagente que el CLI declara en la respuesta al `initialize` (2.5/2.9.b).
export interface SubagentInfo {
  readonly name: string;
  readonly description: string;
  readonly model: string | null;
}

// Servidor MCP tal y como lo reporta el arranque de la sesion: nombre + estado de conexion. El
// `status` se deja como string a proposito (lo define el CLI y puede crecer; no lo cerramos a un
// enum que se quedaria corto en la siguiente version).
export interface McpServerStatus {
  readonly name: string;
  readonly status: string;
}

// Plugin cargado por la sesion (`system/init.plugins`): `source` es `nombre@marketplace`.
export interface SessionPlugin {
  readonly name: string;
  readonly source: string | null;
}

// Union discriminada por `kind`. Cada variante es inmutable.
export type MageEvent =
  // Arranque de sesion. `mcpServers` y `slashCommands` son lo que la sesion cargo DE VERDAD (unica
  // fuente fiable: ni el modelo ni `claude mcp list` lo saben). Vacios si el CLI no los reporta.
  | {
      readonly kind: 'session_init';
      readonly sessionId: string;
      readonly model: string;
      // Nombres de las herramientas que la sesion cargo DE VERDAD, tal cual las declara el CLI
      // (`Read`, `Bash`, ..., y las de MCP como `mcp__<servidor>__<tool>`). Antes de esto solo se
      // guardaba el numero, que no lo leia nadie: el dato llegaba del CLI y se tiraba.
      readonly tools: readonly string[];
      readonly mcpServers: readonly McpServerStatus[];
      readonly slashCommands: readonly string[];
      // Lo que la sesion cargo de verdad (P-026 2.6). MEDIDO en 2.1.283 (`/rename`, sin coste): `skills` es
      // una lista de nombres y `plugins` de `{name, path, source}`; `plugin_errors` no llega si no hay.
      // Vacios si el CLI no los reporta (agy, versiones viejas).
      readonly skills: readonly string[];
      readonly plugins: readonly SessionPlugin[];
      readonly pluginErrors: readonly string[];
    }
  | { readonly kind: 'stream_delta'; readonly text: string }
  // Mensaje COMPLETO del asistente, una vez por mensaje (no por delta). El reducer del chat lo IGNORA a
  // proposito (los deltas ya lo pintaron; anadirlo lo duplicaria): existe para las reglas de
  // notificacion por regex del usuario, que necesitan el texto entero y no trozos sueltos.
  | { readonly kind: 'assistant_text'; readonly text: string }
  // Texto del pensamiento EN VIVO (2.5). Solo existe mientras el turno corre: el CLI persiste los
  // bloques `thinking` con texto VACIO (medido), asi que una conversacion reanudada no lo tiene.
  | { readonly kind: 'thinking_delta'; readonly text: string }
  // Subagentes declarados por el CLI al arrancar (2.5/2.9.b). Va en un evento propio y no ampliando
  // `commands_available` para no tocar su reducer ni sus tests, aunque los dos salgan del mismo
  // control_response.
  | { readonly kind: 'subagents_available'; readonly subagents: readonly SubagentInfo[] }
  // Catalogo de modelos de la CUENTA (P-026 2.4), del mismo control_response. MEDIDO en 2.1.283: 11
  // entradas en las cuentas del usuario y 5 en el perfil privado, asi que es por config dir.
  | { readonly kind: 'models_available'; readonly models: readonly ProviderModel[] }
  | { readonly kind: 'tool_use'; readonly tool: ToolUse }
  | { readonly kind: 'tool_result'; readonly result: ToolResult }
  | { readonly kind: 'permission_request'; readonly request: PermissionRequest }
  | { readonly kind: 'permission_cancelled'; readonly requestId: string }
  | { readonly kind: 'session_state'; readonly state: SessionState }
  // El proceso del agente murio sin que lo pidieramos y se va a relanzar reanudando la conversacion
  // (C1). `attempt` es 1-based y `delayMs` la espera antes del relanzado; sirve para que la UI diga
  // "reconectando" en vez de dejar la pestana muerta con un error.
  | { readonly kind: 'session_restarting'; readonly attempt: number; readonly delayMs: number }
  // Desglose de la ventana de contexto que reporta el propio CLI (D3), pedido al cerrar cada turno.
  | { readonly kind: 'context_usage'; readonly usage: ContextUsage }
  // Un hook REGISTRADO por Mage ha disparado en el CLI (D2): seguimiento fiable del ciclo de vida
  // (prompt enviado, turno cerrado, notificacion, compactacion...) sin adivinarlo del texto. `detail`
  // es el dato relevante del evento cuando lo hay (mensaje de la notificacion, nombre de la tool).
  // `requestId` lo consume AgentSession para contestarle al CLI; el CLI ESPERA esa respuesta.
  | {
      readonly kind: 'hook_fired';
      readonly requestId: string;
      readonly event: string;
      readonly detail: string | null;
    }
  // Comandos "/" con descripcion real, de la respuesta al `initialize` (D2/D4).
  | { readonly kind: 'commands_available'; readonly commands: readonly SlashCommandInfo[] }
  // El CLI ha RECHAZADO un control_request. Lleva el `requestId` porque quien decide si esto le importa
  // al usuario es AgentSession: si la peticion la hizo el usuario (cambiar de modelo, interrumpir) se
  // convierte en un error visible; si era telemetria nuestra (registrar hooks, pedir el desglose de
  // contexto) se queda en el log, porque ensuciar la conversacion con un fallo que el usuario no ha
  // provocado —y que en un CLI de otra version pasaria en CADA arranque— seria peor que el fallo.
  | { readonly kind: 'control_error'; readonly requestId: string; readonly message: string }
  // Compactacion de contexto completada (M2.4): system/compact_boundary del CLI. trigger:
  // 'manual' (/compact) o 'auto' (umbral del CLI); string laxo por si aparecen valores nuevos.
  | { readonly kind: 'compacted'; readonly trigger: string }
  // Cambio de modo de permiso (M2.6): system/status del CLI con `permissionMode`. Refleja el modo
  // actual venga de donde venga (nuestro set_permission_mode, ExitPlanMode, /plan, etc.).
  | { readonly kind: 'permission_mode'; readonly mode: string }
  // Limite de uso alcanzado. MEDIDO en una transcripcion real del usuario: el CLI lo manda como un
  // mensaje `assistant` con `error: "rate_limit"`, `isApiErrorMessage: true`, `apiErrorStatus: 429` y
  // un texto ya redactado para humanos ("You've hit your session limit · resets 3pm (Europe/Madrid)").
  // `summary` es ESE texto, tal cual: el CLI es el unico que sabe cuando se restablece y en que zona.
  // `resetsAtMs` queda en null mientras no se mida un campo con la marca de tiempo — deducirla del
  // texto seria inventarla.
  | { readonly kind: 'rate_limit'; readonly summary: string; readonly resetsAtMs: number | null }
  // Foto del consumo de la suscripcion que el CLI emite SOLO, sin que Mage pregunte a ningun
  // endpoint. MEDIDO el 2026-09-14 contra el CLI 2.1.270 (Fase 9, S3): llega en un turno normal
  // con `status: "allowed"`, asi que NO es un aviso de limite — eso sigue siendo `rate_limit`.
  // Es lo que alimenta el panel de Uso sin gastar una peticion propia.
  //
  // Una ventana viene null cuando el CLI no la manda o su `utilization` no encaja con lo medido
  // (fraccion 0..1). Null = "no se sabe", que NUNCA debe machacar lo que el endpoint si sabia.
  | {
      readonly kind: 'usage_limits';
      readonly fiveHour: UsageWindowInfo | null;
      readonly sevenDay: UsageWindowInfo | null;
    }
  // Progreso o fin de un subagente EN SEGUNDO PLANO (P-028 37a). MEDIDO en 2.1.284: el CLI emite
  // `system/task_progress` (`status` 'running', con `usage` y `last_tool_name`) mientras trabaja y
  // `system/task_notification` (`status` 'completed' | 'stopped' | …) al parar, los dos con el
  // `tool_use_id` del Agent que lo lanzo. Un interrupt del turno los mata (`stopped`).
  | {
      readonly kind: 'subagent_update';
      readonly toolUseId: string;
      readonly status: string;
      readonly tokens: number | null;
      readonly toolUses: number | null;
      readonly durationMs: number | null;
    }
  // El CLI empieza una peticion al modelo (`system/status` con `status: 'requesting'`, medido en
  // 2.1.284). Con la pestaña parada es el CLI abriendo un turno solo (la notificacion de una tarea en
  // segundo plano): cuenta como turno en marcha y la cola de Mage espera (0.1.1 R2, punto 30).
  | { readonly kind: 'request_started' }
  // Salida de un comando LOCAL del CLI (`/context`, `/mcp`, `/rename x`...), P-028 grupo C. MEDIDO en
  // 2.1.284: no manda deltas, solo un `assistant` sintetico, asi que sin este evento el chat se quedaba
  // vacio. `command` es el nombre sin barra (`rename`), o null si el sintetico no es un comando (un
  // error de API redactado por el CLI). `text` es el texto del CLI TAL CUAL.
  | { readonly kind: 'local_command_output'; readonly command: string | null; readonly args: string; readonly text: string }
  // `/clear` (P-028): el CLI empieza una conversacion NUEVA en el mismo proceso, con otro id y otro
  // `.jsonl`; la anterior sigue en disco. A partir de aqui main etiqueta la sesion con `newSessionId`.
  | { readonly kind: 'conversation_reset'; readonly newSessionId: string }
  // Aviso del runtime propio de Mage (P-032) que va al hilo como linea de sistema: p.ej. «este modelo
  // no admite herramientas». Los CLI no lo emiten: sus avisos llegan por sus propios eventos.
  | { readonly kind: 'notice'; readonly text: string }
  | { readonly kind: 'result'; readonly result: ResultInfo }
  // `deniedCommand`: la linea EXACTA de un comando que agy denego (grupo E, fase 2), para ofrecer permitirlo
  // en la conversacion siguiente. Solo cuando el CLI la dice.
  | { readonly kind: 'error'; readonly message: string; readonly deniedCommand?: string };

// Decision del usuario ante un permiso (viaja renderer -> main -> CLI).
//
// `updatedInput` REESCRIBE el input de la tool: es el canal por el que viajan las respuestas de
// AskUserQuestion (`answers`). AUSENTE => el adapter manda `{}`, que el CLI interpreta como "usa el
// input original" (comprobado en su fuente; los clientes moviles mandan eso). Un `{}` explicito y un
// campo ausente son, por tanto, lo mismo: no hay ambiguedad que resolver.
export type PermissionDecision =
  | { readonly behavior: 'allow'; readonly updatedInput?: Readonly<Record<string, unknown>> }
  | { readonly behavior: 'deny'; readonly message: string };
