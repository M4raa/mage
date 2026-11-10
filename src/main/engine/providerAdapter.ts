import type { ImageAttachment } from '@shared/ipc';
import type { MageEvent, PermissionDecision } from '@shared/events';
import type { ElicitationAnswer } from '@shared/elicitation';
import type { ResolvedMcpServer } from '../config/mcpResolved';

// Configuracion compartida de un lanzamiento. Lleva los valores de env/cabeceras de los MCP: solo
// existe en main y nunca se loguea.
export interface SharedLaunchConfig {
  readonly mcpServers: readonly ResolvedMcpServer[];
  // Fragmento de `--settings` de settings-common.json (hooks y permisos). Solo lo entiende Claude.
  readonly settingsFragment: Readonly<Record<string, unknown>> | null;
  // Conectores de claude.ai de la cuenta (C3-f). false -> `ENABLE_CLAUDEAI_MCP_SERVERS=false`.
  readonly claudeAiConnectors: boolean;
  // Identidad de esta sesion ante el servidor MCP `mage` (D-M6). `forwardToCodexMcp`: `mage` esta
  // registrado en el CODEX_HOME de la cuenta y Codex tiene que reenviarle la variable.
  readonly mageCaller?: { readonly credential: string; readonly forwardToCodexMcp: boolean };
  // Texto de sistema que Mage añade a la conversación (P-038): hoy, el aviso de que el MCP de Mage está apagado.
  readonly systemNotice?: string;
}

// Parametros para arrancar una sesion de agente (neutros de proveedor).
// `resume` (M2.5): si true, se reanuda la conversacion `sessionId` (`--resume`) en vez de crear una
// nueva (`--session-id`). El id es el mismo en ambos casos (misma transcripcion en disco).
export interface LaunchParams {
  readonly sessionId: string;
  readonly accountDir: string;
  readonly model: string;
  readonly cwd: string;
  readonly resume?: boolean;
  readonly effort?: string; // nivel --effort (M2.4); ya validado en la frontera. undefined -> sin flag
  readonly maxBudgetUsdCents?: number; // tope --max-budget-usd en centavos enteros (M2.4); undefined -> sin tope
  readonly permissionMode?: string; // modo de permiso inicial (--permission-mode, M2.6); undefined/'default' -> sin flag
  readonly projectInstructions?: string;
  // Lo COMUN a todas las cuentas para ESTE proveedor y cuenta, ya filtrado por «Solo en…». Neutro de
  // proveedor: cada adapter lo traduce a su CLI (mcpProviderTranslate.ts). undefined -> nada.
  readonly shared?: SharedLaunchConfig;
  // Id de conversacion que asigna el PROVEEDOR, no Mage (E3): el que emitio en su `session_init`. Solo
  // viaja en un RELANZADO (tras un corte o un cierre inesperado) para que el proceso nuevo continue la
  // misma conversacion: `agy --conversation <id>`, `thread/resume` de codex. Claude no lo necesita
  // (reanuda por `sessionId`). Medido en `agy` 1.1.11: un id arbitrario NO sirve (`warning:
  // conversation "…" not found` y arranca otra), hay que devolverle el que emitio.
  readonly conversationId?: string;
  // Divergir en Claude (medido en 2.1.311): `--resume <origen> --resume-session-at <at>
  // --fork-session --session-id <nuevo>`; la conversacion original no cambia (C-3b). Excluyente con `resume`.
  readonly forkFrom?: { readonly sessionId: string; readonly atUuid: string };
}

// Plan de spawn resuelto: comando, argumentos y entorno del proceso hijo.
export interface SpawnPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: NodeJS.ProcessEnv;
}

// Referencia minima de un permiso para construir la respuesta al CLI.
export interface PermissionRef {
  readonly requestId: string;
  readonly toolUseId: string;
}

// Lo que devuelve `encodeSteer`: un payload a escribir (null = el adapter lo manda por `takeOutgoing`) o
// el destino ya resuelto sin escribir nada (no hay turno al que entrar).
export type SteerEncoding =
  | { readonly kind: 'write'; readonly payload: unknown }
  | { readonly kind: 'resolved'; readonly outcome: 'no_active_turn' };

// Peticion de Mage al motor con respuesta (rewind y fork, F4.4/F4.5). Cada proveedor entiende solo los
// `kind` de su CLI.
export type EngineRequest =
  | { readonly kind: 'rewind_conversation'; readonly targetUuid: string; readonly lastSeenUuid: string }
  | { readonly kind: 'rewind_files'; readonly userMessageUuid: string; readonly dryRun: boolean }
  | { readonly kind: 'thread_revert'; readonly beforeTurnId: string }
  | { readonly kind: 'thread_fork'; readonly lastTurnId: string }
  | { readonly kind: 'thread_turns'; readonly cursor: string | null };

// Layout en disco de las cuentas de un proveedor. Lo DECLARA el adapter y lo recibe `AccountService`
// inyectado, que asi deja de conocer ningun nombre de proveedor: hasta 9.1 tenia dentro
// `CONFIG_DIR_PATTERN = /^\.claude(-.*|\d*)$/` y `MAIN_DIR_NAME = '.claude'`, que es exactamente lo
// que dejaba a `agy` y al gateway sin multicuenta.
//
// El patron de descubrimiento NO se declara: se DERIVA de `mainDirName` (`<main>`, `<main>-<algo>`,
// `<main><digitos>`), que es la forma real de los dirs que crea el CLI. Un campo menos que mantener
// coherente con los otros dos.
export interface AccountLayout {
  // Variable de entorno con la que se le dice al CLI que config dir usar (p.ej. CLAUDE_CONFIG_DIR).
  readonly configDirEnvVar: string;
  // Directorio de la cuenta principal bajo HOME (p.ej. `.claude`). Tambien es el prefijo de las
  // cuentas alternativas (`.claude-<nombre>`) y la raiz de las carpetas compartidas.
  readonly mainDirName: string;
  // Fichero donde el CLI guarda el perfil OAuth (`oauthAccount`), del que salen email y organizacion.
  readonly stateFileName: string;
}

// Login por el propio CLI del proveedor: el binario hace el OAuth de punta a punta y Mage nunca ve el
// token (Fase 9). `loginArgs` es el subcomando de alta, medido contra el binario real.
export interface CliOauthLogin {
  readonly accounts: AccountLayout;
  readonly loginArgs: readonly string[];
}

// Como autentica un proveedor. Union CERRADA y campo OBLIGATORIO de `ProviderAdapter` a proposito:
// anadir un proveedor obliga a contestar como se dan de alta sus cuentas, y quien lo consuma resuelve
// con un `switch` exhaustivo — no con un `if (algo !== undefined)` que se olvida en silencio.
export type AuthModel =
  // El CLI del proveedor hace el login; Mage solo lo orquesta (claude).
  | { readonly kind: 'cli-oauth'; readonly login: CliOauthLogin }
  // Credencial de API que vive en el main y nunca entra en el entorno de un hijo.
  | { readonly kind: 'api-key'; readonly keyLabel: string }
  // El proveedor gestiona su propia sesion fuera de Mage; no hay alta que ofrecer (`agy`).
  | { readonly kind: 'external'; readonly reason: string };

// Costura multi-proveedor. `AgentSession` es provider-agnostic y delega TODA la especificidad del
// proveedor (comando, formato NDJSON de entrada, protocolo de permisos, parseo) en un adapter. Hay una
// instancia POR SESION, asi que un adapter puede guardar estado del protocolo (codex: el hilo y el turno
// en curso; agy: el uso acumulado del proceso).
//
// Contrato de los `encode*`: devuelven el mensaje a escribir en stdin, o `null` si no hay nada que
// mandar AHORA (el adapter lo aplica mas tarde o lo encola en `takeOutgoing`).
export interface ProviderAdapter {
  // Como autentica este proveedor. OBLIGATORIO (ver AuthModel): es la pregunta que un proveedor nuevo
  // no puede dejar sin contestar.
  readonly auth: AuthModel;
  // Como lanzar el proceso del agente. Se llama una vez por proceso (arranque y cada relanzado): un
  // adapter con estado lo reinicia aqui.
  buildSpawnPlan(params: LaunchParams): SpawnPlan;
  // Objetos que se serializan como lineas NDJSON hacia stdin del hijo.
  // `attachments` (2.12.1): imagenes del mensaje. SIN adjuntos el payload no cambia ni un byte
  // respecto al de siempre — la forma minima con `content` string esta validada por el spike.
  // `messageId` (F4.4): con el, el adapter identifica el mensaje ante su CLI (Claude: `uuid`; Codex:
  // `clientUserMessageId`); sin el, el payload no cambia ni un byte.
  encodeUserMessage(text: string, attachments?: readonly ImageAttachment[], messageId?: string): unknown;
  // Mensaje directo en el turno en marcha (F4.1). OPCIONAL: solo Claude y codex lo tienen. `messageId` es
  // el id con el que el adapter emitira despues su `steer_result`.
  encodeSteer?(messageId: string, text: string, attachments?: readonly ImageAttachment[]): SteerEncoding;
  // Peticion de Mage al motor con respuesta (F4.4/F4.5). OPCIONAL: solo Claude y Codex. Lanza Error si el
  // proveedor no admite ese `kind`. La respuesta llega como evento `engine_response` con el mismo `requestId`.
  encodeEngineRequest?(requestId: string, request: EngineRequest): unknown;
  encodePermissionResponse(ref: PermissionRef, decision: PermissionDecision): unknown;
  encodeElicitationResponse?(answer: ElicitationAnswer): unknown;
  encodeInterrupt(): unknown;
  // true = el CLI no tiene interrupcion por protocolo: AgentSession corta matando el arbol y el siguiente
  // mensaje relanza reanudando la conversacion (`agy`). Entonces `encodeInterrupt` no se llama.
  readonly interruptsByKill?: boolean;
  // true = modelo, esfuerzo y modo de permiso son flags de ARRANQUE (`agy`): no hay cambio en caliente, asi que
  // AgentSession los guarda y relanza el CLI, reanudando la conversacion, en el siguiente mensaje con la sesion en reposo.
  readonly launchFlagSettings?: boolean;
  // Cambio de modelo en caliente (M2.4): control_request set_model; aplica al siguiente turno.
  // Los adapters que no lo soportan lanzan Error (la UI solo lo ofrece para Claude).
  encodeSetModel(model: string): unknown;
  encodeSetEffort?(effort: string): unknown;
  // Cambio de modo de permiso en caliente (M2.6): control_request set_permission_mode. Los adapters
  // que no lo soportan lanzan Error (la UI solo lo ofrece para Claude).
  encodeSetPermissionMode(mode: string): unknown;
  // Desglose de la ventana de contexto (D3): control_request get_context_usage. OPCIONAL a proposito:
  // solo Claude lo soporta, y asi agy y codex no tienen que declarar un metodo que
  // lanzaria. Si no esta, AgentSession simplemente no lo pide.
  encodeGetContextUsage?(): unknown;
  // Parar UN subagente en segundo plano (0.1.1 R2, punto 29): control_request stop_task. OPCIONAL como
  // el anterior: solo Claude lo tiene.
  encodeStopTask?(taskId: string): unknown;
  // Registro de hooks al arrancar (D2): control_request initialize. OPCIONAL, como el anterior.
  encodeInitialize?(): unknown;
  // Respuesta a un control_request hook_callback del CLI (D2). Obligatoria si se registran hooks: el
  // CLI se queda esperandola hasta el timeout declarado.
  encodeHookResponse?(requestId: string): unknown;
  // Mensajes que el adapter quiere mandar por su cuenta (respuestas y peticiones de JSON-RPC de codex).
  // AgentSession los drena tras lanzar el proceso, tras cada linea de stdout y tras cada `encode*`.
  takeOutgoing?(): readonly unknown[];
  // Traduce una linea cruda de stdout (ya JSON-parseada) a 0..n eventos comunes.
  normalize(raw: unknown): MageEvent[];
}
