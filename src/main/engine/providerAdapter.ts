import type { ImageAttachment } from '@shared/ipc';
import type { MageEvent, PermissionDecision } from '@shared/events';

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
  // Flags de configuracion COMUN a inyectar (D1 Fase 1: --mcp-config/--settings de mcp-common.json/
  // settings-common.json), ya resueltos por SharedConfigService. undefined/[] -> ningun flag.
  readonly sharedConfigArgs?: readonly string[];
  // Id de conversacion que asigna el PROVEEDOR, no Mage (E3). Solo lo usa el modo 'perTurn': ahi el
  // proceso muere al cerrar cada turno, asi que este id es lo UNICO que enlaza el contexto entre un
  // turno y el siguiente. Ausente en el primer turno (aun no existe). Medido en `agy` 1.1.11: un id
  // arbitrario NO sirve (`warning: conversation "…" not found` y arranca una conversacion nueva), hay
  // que capturar el que el CLI emite en su `init` y devolverselo.
  readonly conversationId?: string;
}

// Como se relaciona una sesion con el proceso del CLI:
//   - 'persistent' (default): UN proceso vivo entre turnos; los mensajes entran por stdin en NDJSON.
//     Es lo que hacen los CLI de Claude Code (nativo y por gateway).
//   - 'perTurn': el CLI NO acepta entrada estructurada (`agy` no tiene `--input-format`, medido): el
//     prompt va en argv y el proceso TERMINA al acabar el turno. Un proceso por turno no cuesta cache
//     porque `agy --conversation <id>` cachea en servidor entre procesos distintos (medido:
//     cache_read_tokens 24 410 en el turno 2 de la misma conversacion).
export type TurnMode = 'persistent' | 'perTurn';

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
  // Credencial de API que vive en el main y nunca entra en el entorno del hijo (gateway).
  | { readonly kind: 'api-key'; readonly keyLabel: string }
  // El proveedor gestiona su propia sesion fuera de Mage; no hay alta que ofrecer (`agy`).
  | { readonly kind: 'external'; readonly reason: string };

// Costura multi-proveedor. `AgentSession` es provider-agnostic y delega TODA la especificidad del
// proveedor (comando, formato NDJSON de entrada, protocolo de permisos, parseo) en un adapter.
// En el MVP solo existe ClaudeAdapter; el diseno ya permite anadir Gemini/OpenAI/locales en M2.
export interface ProviderAdapter {
  // Como autentica este proveedor. OBLIGATORIO (ver AuthModel): es la pregunta que un proveedor nuevo
  // no puede dejar sin contestar.
  readonly auth: AuthModel;
  // Modo de turno. Ausente = 'persistent' (los adapters existentes no tienen que declarar nada).
  readonly turnMode?: TurnMode;
  // Como lanzar el proceso del agente. En 'perTurn' no hay proceso que arrancar sin prompt: los
  // adapters de ese modo LANZAN aqui y construyen su plan en buildTurnSpawnPlan.
  buildSpawnPlan(params: LaunchParams): SpawnPlan;
  // Plan de spawn de UN turno, con el prompt ya dentro (argv). OBLIGATORIO si turnMode es 'perTurn';
  // ausente en 'persistent' (ahi el prompt viaja por stdin via encodeUserMessage).
  buildTurnSpawnPlan?(params: LaunchParams, prompt: string): SpawnPlan;
  // Objetos que se serializan como lineas NDJSON hacia stdin del hijo.
  // `attachments` (2.12.1): imagenes del mensaje. SIN adjuntos el payload no cambia ni un byte
  // respecto al de siempre — la forma minima con `content` string esta validada por el spike.
  encodeUserMessage(text: string, attachments?: readonly ImageAttachment[]): unknown;
  encodePermissionResponse(ref: PermissionRef, decision: PermissionDecision): unknown;
  encodeInterrupt(): unknown;
  // Cambio de modelo en caliente (M2.4): control_request set_model; aplica al siguiente turno.
  // Los adapters que no lo soportan lanzan Error (la UI solo lo ofrece para Claude).
  encodeSetModel(model: string): unknown;
  // Cambio de modo de permiso en caliente (M2.6): control_request set_permission_mode. Los adapters
  // que no lo soportan lanzan Error (la UI solo lo ofrece para Claude).
  encodeSetPermissionMode(mode: string): unknown;
  // Desglose de la ventana de contexto (D3): control_request get_context_usage. OPCIONAL a proposito:
  // solo Claude lo soporta, y asi los adapters por gateway no tienen que declarar un metodo que
  // lanzaria. Si no esta, AgentSession simplemente no lo pide.
  encodeGetContextUsage?(): unknown;
  // Registro de hooks al arrancar (D2): control_request initialize. OPCIONAL, como el anterior.
  encodeInitialize?(): unknown;
  // Respuesta a un control_request hook_callback del CLI (D2). Obligatoria si se registran hooks: el
  // CLI se queda esperandola hasta el timeout declarado.
  encodeHookResponse?(requestId: string): unknown;
  // Traduce una linea cruda de stdout (ya JSON-parseada) a 0..n eventos comunes.
  normalize(raw: unknown): MageEvent[];
}
