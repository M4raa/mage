// Contrato IPC tipado main<->renderer. Un unico sitio define nombres de canal y payloads.
// El preload expone estos canales como `window.mage.*`; si cambia una firma, el compilador
// rompe en ambos lados. El renderer NUNCA accede a Node/procesos: todo pasa por aqui.

import type { GitParams, GitSnapshot, GitSwitchParams } from './git';
import type { WorktreeCreateParams, WorktreeMergeBaseParams, WorktreeRemoveResult } from './worktree';
import type { GhAutoMergeParams, GhPrUpdate, GhRunActionParams, GhRunsParams, GhRunsSnapshot, GhSnapshot, GhWatchParams } from './gh';
import type { AccountCreateParams, AccountInfo, CliLoginStart, CodexLoginOutcome, EmbeddedLoginResult } from './accounts';
import type { ProviderModel } from './providers';
import type { AgyUsageSnapshot } from './usage';
import type { MageEvent, PermissionDecision, SlashCommandInfo } from './events';
import type { ArtifactRecord, ConversationPrefs } from './conversationIndex';
import type { UsageInfo } from './usage';
import type { StatusInfo } from './status';
import type { TranscriptBatch, TranscriptTailPosition } from './transcripts';
import type { MemoryFile } from './memory';
import type { ConversationSummary, DeleteConversationParams, MoveConversationParams, MoveConversationResult } from './conversations';
import type { ConversationPrivacy, PersistedWorkspace } from './state';
import type { AppSettings } from './settings';
import type { UpdateState } from './update';
import type { WidgetSnapshot } from './widget';
import type { FetchThemeParams, FetchedVscodeTheme, ThemeSearchItem } from './themeMarket';
import type { PanelLayoutState, PanelPlacement } from './panelLayout';
import type {
  McpCommonMutateParams,
  McpImportApplyParams,
  McpImportPreview,
  McpInventory,
  McpInventoryParams,
  McpRevealedSecrets,
  McpAuthParams,
  McpAuthResult,
  McpWriteResult,
  McpAgySyncPreview,
  McpAgySyncResult,
  McpAgySyncState,
  McpExtensionConfigParams,
  McpExtensionInstallPreview,
  McpExtensionList,
  McpScope,
  McpStatusCache,
} from './mcp';
// Varias ventanas (multi-ventana): mover una pestaña de una ventana a otra viaja su estado persistido.
import type { PersistedTab } from './state';

// Peticion de sondeo de un proveedor (D2). `baseUrl` solo la mandan los proveedores DEL USUARIO (la del
// formulario, que puede ir por delante de lo guardado); los de serie los resuelve main desde su ficha.
// Ninguna credencial viaja por IPC: la clave de un proveedor del usuario la saca main de su boveda.
export interface ProviderProbeParams {
  readonly providerId: string;
  readonly baseUrl: string | null;
}

// «Probar conexión» de un proveedor del runtime propio (P-032 R7). Sin clave: si el proveedor ya existe
// (`providerId`), main la saca de la boveda; si es nuevo, se prueba sin ella.
export interface RuntimeProbeParams {
  readonly providerId: string | null;
  readonly baseUrl: string;
}

// Modelos del endpoint y, del primero, ventana y herramientas. null = no se supo.
export interface RuntimeProbeResult {
  readonly models: readonly string[] | null;
  readonly contextWindow: number | null;
  readonly supportsTools: boolean | null;
  readonly warning: string | null;
  readonly error: string | null;
}

// Guardar la api key de un proveedor DEL USUARIO en la boveda de main. Sube una vez y no vuelve.
export interface ProviderApiKeySetParams {
  readonly providerId: string;
  readonly apiKey: string;
}

// Resultado del sondeo. `kind` dice a que apunta el proveedor: 'cli' = un ejecutable local (su ruta va
// en `endpoint`), 'http' = un endpoint OpenAI-compatible (su URL). `models === null` = no se pudo
// listar, y `error` dice POR QUE (la UI lo pinta; nunca se rellena una lista inventada).
export interface ProviderProbeResult {
  readonly kind: 'cli' | 'http';
  readonly endpoint: string | null;
  readonly models: readonly ProviderModel[] | null;
  readonly error: string | null;
}

// --- Canales renderer -> main (request/response via ipcRenderer.invoke) -----------------------

export const IpcChannel = {
  SessionCreate: 'session:create',
  SessionSendMessage: 'session:sendMessage',
  SessionAnswerPermission: 'session:answerPermission',
  SessionInterrupt: 'session:interrupt',
  SessionSetModel: 'session:setModel',
  SessionSetPermissionMode: 'session:setPermissionMode',
  // Parar UN subagente en segundo plano (0.1.1 R2, punto 29, solo Claude).
  SessionStopTask: 'session:stopTask',
  SessionStop: 'session:stop',
  SessionGetScratchDir: 'session:getScratchDir',
  // La RAIZ de los borradores, sin crear nada (a diferencia de la de arriba, que acuña una carpeta).
  SessionGetScratchRoot: 'session:getScratchRoot',
  FsExistsDirs: 'fs:existsDirs',
  // ¿Esta instalado el CLI de Antigravity (E3)? Solo main puede mirar el disco/PATH.
  AgyInstalled: 'engine:agyInstalled',
  // Sondeo de un proveedor (D2): a donde apunta y que modelos ofrece DE VERDAD. Solo main puede mirar
  // el disco/PATH y salir a la red.
  ProviderProbe: 'engine:providerProbe',
  RuntimeProbe: 'runtime:probe',
  McpLoginOpen: 'runtime:mcpLoginOpen',
  // Clave de un proveedor del usuario: guardarla o borrarla en la boveda de main. No hay canal para
  // LEERLA: el renderer solo sabe si existe (`CustomProvider.hasApiKey`).
  ProviderApiKeySet: 'secrets:providerApiKeySet',
  ProviderApiKeyDelete: 'secrets:providerApiKeyDelete',
  FileReveal: 'file:reveal',
  FileSaveAs: 'file:saveAs',
  OpenPath: 'openWith:path',
  OpenExternal: 'openWith:external',
  // Ventana sin marco nativa (Ronda 3, item 9): recolorear los botones de sistema en caliente.
  TitleBarOverlay: 'window:titleBarOverlay',
  // Comandos de EDICION del webContents (2.9.b). Existen porque el menu de aplicacion propio sustituye
  // al `Menu` nativo, y con el se fueron los `role:` que daban deshacer/cortar/copiar/pegar.
  // `window:menuPopup` se BORRO en la misma fase: sin menu nativo no hay nada que desplegar, y dejar el
  // canal seria superficie IPC muerta.
  EditCommand: 'window:editCommand',
  OpenTerminal: 'openWith:terminal',
  OpenEditor: 'openWith:editor',
  EditorsList: 'openWith:editorsList',
  AccountsList: 'accounts:list',
  AccountsCreate: 'accounts:create',
  // Login por el CLI (Fase 9.2): tres pasos, porque el usuario tiene que pegar el *code* en medio.
  AccountsLoginStart: 'accounts:login:start',
  AccountsLoginSubmitCode: 'accounts:login:submit-code',
  AccountsLoginCancel: 'accounts:login:cancel',
  AccountsAdoptLogin: 'accounts:adopt-login',
  AccountsDelete: 'accounts:delete',
  // Alta de una cuenta de la matriz (grupo E): Claude por API, Codex y agy por clave.
  AccountsCreateFor: 'accounts:create-for',
  // Login de ChatGPT de una cuenta de Codex por su CLI (sin verificar).
  CodexLoginStart: 'accounts:codex-login:start',
  CodexLoginCancel: 'accounts:codex-login:cancel',
  CodexInstalled: 'engine:codexInstalled',
  // Uso de la suscripcion de agy («/usage», gratis).
  AgyUsageRead: 'usage:agy',
  // Modos de permiso que expone cada CLI (respuesta 18).
  PermissionModesList: 'engine:permissionModes',
  DialogPickDirectory: 'dialog:pickDirectory',
  UsageGet: 'usage:get',
  StatusGet: 'status:get',
  // Version de la app (la del package.json empaquetado). Constante durante toda la vida del proceso.
  AppVersionGet: 'app:version',
  // Datos de la pantalla «Acerca de»: versiones del runtime y los avisos de terceros (B.2/B.3 de la
  // revision legal). Bajo demanda: el texto son ~124 kB que no pinta nadie hasta abrir la seccion.
  AboutGet: 'app:about',
  // Opacidad de fondo: main activa/desactiva el material translucido de la ventana (Windows 11).
  WindowOpacitySet: 'window:opacity',
  TranscriptOpen: 'transcript:open',
  TranscriptCancel: 'transcript:cancel',
  MemoryRead: 'memory:read',
  // Ficheros que el agente CREA en la carpeta de la conversacion (2.10, panel "Ficheros"). Lectura y
  // escritura, las dos con la ruta validada contra ese cwd en main: es la unica via por la que el
  // renderer puede escribir un fichero del proyecto.
  ProjectFileRead: 'projectFile:read',
  ProjectFileWrite: 'projectFile:write',
  ProjectFileApproveOutside: 'projectFile:approveOutside',
  // Historial de conversaciones en disco de una cuenta (M2.6, sidebar = historial).
  ConversationsList: 'conversations:list',
  // Administracion de conversaciones (#2 de AJUSTES): borrar y mover entre secciones/cuentas.
  ConversationsDelete: 'conversations:delete',
  ConversationsMove: 'conversations:move',
  StateLoad: 'state:load',
  StateSave: 'state:save',
  SettingsLoad: 'settings:load',
  SettingsSave: 'settings:save',
  // Confianza por carpeta: solo CONSULTA. Conceder se hace guardando `trustedFolders` por SettingsSave.
  TrustIsFolderTrusted: 'trust:isFolderTrusted',
  // Git de la carpeta de una conversacion (P-026 3.5): estado, ramas y cambio de rama.
  GitStatus: 'git:status',
  GitBranches: 'git:branches',
  GitSwitch: 'git:switch',
  // PR y CI de la rama con el GitHub CLI (grupo D de la 0.1.2). Lectura, vigilancia y tres acciones que
  // escriben en GitHub (relanzar, cancelar y el auto-merge nativo), siempre con confirmacion en la UI.
  GhBranchPr: 'gh:branchPr',
  GhWatch: 'gh:watch',
  GhUnwatch: 'gh:unwatch',
  GhRuns: 'gh:runs',
  GhRunAction: 'gh:runAction',
  GhAutoMerge: 'gh:autoMerge',
  // Worktrees de Mage (grupo D, bloque 3): crear al empezar, recrear al reabrir, archivar y traer la base.
  WorktreeCreate: 'worktree:create',
  WorktreeRestore: 'worktree:restore',
  WorktreeRemove: 'worktree:remove',
  WorktreeMergeBase: 'worktree:mergeBase',
  PromptImprove: 'prompt:improve',
  PromptHandoff: 'prompt:handoff',
  NotifyShow: 'notify:show',
  // Widget flotante (M3): activar/desactivar la ventana y activar una pestana desde el widget.
  WidgetSetEnabled: 'widget:setEnabled',
  WidgetUpdate: 'widget:update',
  WidgetActivateTab: 'widget:activateTab',
  // Mercado de temas Open VSX (M3): buscar y traer un tema de color de VS Code.
  ThemeMarketSearch: 'themeMarket:search',
  ThemeMarketFetch: 'themeMarket:fetch',
  // Config compartida entre cuentas (D1 Fase 2): editor de mcp-common.json/settings-common.json.
  SharedConfigLoad: 'sharedConfig:load',
  SharedConfigSave: 'sharedConfig:save',
  // MCP y conectores (P-028 puntos 5 y 34): inventario de todas las fuentes, edicion de los comunes
  // (sin valores de env/headers hacia el renderer salvo «mostrar»), importacion con vista previa y
  // estado sin mensaje (`mcp_status`).
  McpInventoryLoad: 'mcp:inventory',
  McpCommonMutate: 'mcp:commonMutate',
  McpCommonReveal: 'mcp:commonReveal',
  McpImportPreview: 'mcp:importPreview',
  McpImportApply: 'mcp:importApply',
  McpStatusProbe: 'mcp:statusProbe',
  McpAuthenticate: 'mcp:authenticate',
  McpStatusCacheLoad: 'mcp:statusCache',
  // Extensiones .mcpb de Mage. La ruta del paquete la elige el dialogo nativo EN MAIN: el renderer solo
  // devuelve el token de la vista previa.
  McpExtensionsList: 'mcp:extensions',
  McpExtensionPick: 'mcp:extensionPick',
  McpExtensionInstall: 'mcp:extensionInstall',
  McpExtensionImportDesktop: 'mcp:extensionImportDesktop',
  McpExtensionSetEnabled: 'mcp:extensionSetEnabled',
  McpExtensionSetOnlyIn: 'mcp:extensionSetOnlyIn',
  McpExtensionSaveConfig: 'mcp:extensionSaveConfig',
  McpExtensionRemove: 'mcp:extensionRemove',
  McpPickFile: 'mcp:pickFile',
  // «Sincronizar con agy».
  McpAgySyncState: 'mcp:agyState',
  McpAgySyncPreview: 'mcp:agyPreview',
  McpAgySyncApply: 'mcp:agyApply',
  McpAgySyncSetAuto: 'mcp:agySetAuto',
  // Layout de paneles acoplables (F6 Fase 2): userData/panels-layout.json, global (no por
  // cuenta/conversacion, §5.3 del plan).
  PanelsLoad: 'panels:load',
  PanelsSave: 'panels:save',
  // Cache del catalogo de comandos "/" por cuenta (2.2): se lee al abrir una pestaña, cuando todavia
  // no hay sesion viva de la que sacarlo. La ESCRIBE main al recibir el catalogo de una sesion.
  CommandCatalogLoad: 'commandCatalog:load',
  // Catalogo de MODELOS cacheado de una cuenta (P-026 2.4). Lo escribe main con el sondeo de arranque y
  // con el `initialize` de cada sesion.
  ModelCatalogLoad: 'modelCatalog:load',
  // Indice propio de Mage por conversacion (2.1) y registro de artifacts (2.4, lo estrena la Fase G).
  ConversationPrefsLoad: 'conversationIndex:loadPrefs',
  ConversationPrefsSave: 'conversationIndex:savePrefs',
  ArtifactRecordSave: 'conversationIndex:recordArtifact',
  // Artifacts (2.4): abrir uno en una ventana con la sesion de SU cuenta, y saber cual fue esa cuenta.
  ArtifactOpen: 'artifact:open',
  // Vistas nuevas (2.9.b): el CLAUDE.md que aplica a la conversacion, y los hooks/reglas EFECTIVOS.
  InstructionsRead: 'instructions:read',
  // Pensamientos que guarda Mage porque el CLI los persiste vacios (medido).
  ThinkingRead: 'thinking:read',
  EffectiveSettingsRead: 'effectiveSettings:read',
  ArtifactPublisherLookup: 'artifact:publisher',
  // Varias ventanas del workbench sobre la MISMA instancia (peticion del usuario: la app en dos
  // pantallas). No es una duplicacion: ajustes/temas/permisos/carpetas de confianza son los mismos
  // objetos de main para todas; lo que cambia por ventana es el workspace (pestañas, paneles, cuenta
  // activa y conversaciones abiertas).
  WindowsOpen: 'windows:open',
  WindowsList: 'windows:list',
  // Mover una pestaña a otra ventana. El ARRASTRE es del renderer (DOM); esto es solo el transporte.
  WindowsMoveTab: 'windows:moveTab',
  // P-028, 36: abrir una ventana NUEVA con una pestaña esperandola (transporte "pull": el renderer
  // nuevo la recoge con WindowsTakePendingTabs cuando ya ha cargado sus cuentas).
  WindowsOpenWithTab: 'windows:openWithTab',
  WindowsTakePendingTabs: 'windows:takePendingTabs',
  // Se solto una pestaña (o una fila del historial) fuera de su ventana: main mira el cursor.
  WindowsDropTab: 'windows:dropTab',
  // Grupo B: la respuesta del dialogo propio de cierre (lo pide main por CLOSE_PROMPT_CHANNEL).
  CloseAnswer: 'close:answer',
  // Estado de la actualizacion (para una ventana que carga tarde) e instalarla ya descargada.
  UpdateGetState: 'update:getState',
  UpdateInstall: 'update:install',
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

// Niveles de esfuerzo del CLI (`--effort <level>`), confirmados en `claude --help` (M2.4). Optimizan
// el gasto de tokens/pensamiento por sesion. Vacio/undefined -> no se pasa el flag (default del CLI).
// Modos de permiso que expone cada CLI, leidos de el (respuesta 18). null = no contesto: la UI cae a la
// lista fija (`PERMISSION_MODES` en Claude). En Codex son perfiles de `permissionProfile/list`.
export interface PermissionModesByProviderView {
  readonly claude: readonly string[] | null;
  readonly codex: readonly string[] | null;
}

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

// Modos de permiso del CLI que Mage ofrece en el ciclo shift+tab (M2.6, ampliado en P-026 2.3 / D8),
// en el ORDEN del ciclo. MEDIDO contra el CLI 2.1.283 (`spike/init-spike.mjs`): `auto` entra con
// `set_permission_mode` en las cuentas del usuario, y `bypassPermissions` solo si la sesion se lanzo
// con `--allow-dangerously-skip-permissions` (lo pone `claudeAdapter`; el flag solo HABILITA, la sesion
// arranca en `default`). `dontAsk` NO se ofrece: con una UI delante solo deniega en silencio.
// `default` = pide permiso; `acceptEdits` = acepta ediciones en el cwd; `plan` = no ejecuta escrituras;
// `auto` = el CLI decide que pedir; `bypassPermissions` = ejecuta todo sin preguntar.
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

// El CLI puede reportar un modo que Mage no ofrece (`dontAsk`): la pestaña lo ENSEÑA, pero en las
// fronteras (arranque de sesion, estado persistido) solo viajan los conocidos.
export function isPermissionMode(value: string | undefined): value is PermissionMode {
  return PERMISSION_MODES.some((mode) => mode === value);
}

// Parametros de arranque de una sesion (en el MVP: cuenta por CLAUDE_CONFIG_DIR + modelo + cwd).
// `resumeSessionId` opcional (M2.5): reanuda una conversacion pasada con `claude --resume <id>` en
// vez de arrancar una fresca. Solo Claude lo soporta; otros proveedores lo ignoran (sesion nueva).
// `effort` opcional (M2.4): nivel de esfuerzo (--effort); si viene, debe ser un EffortLevel valido.
// `maxBudgetUsdCents` opcional (M2.4): tope de gasto (--max-budget-usd) en CENTAVOS ENTEROS (nunca
// float, estandar del proyecto); si viene, entero > 0. undefined -> sin tope.
export interface CreateSessionParams {
  readonly accountDir: string;
  readonly model: string;
  // Id de proveedor: 'claude' (motor nativo), uno de serie de BUILT_IN_PROVIDERS o uno del usuario
  // (E2, prefijo 'custom:'). String a proposito: el catalogo es DATO, no una union cerrada.
  readonly provider: string;
  readonly cwd: string;
  readonly resumeSessionId?: string;
  readonly effort?: string;
  readonly maxBudgetUsdCents?: number;
  // M2.6: 'private' lanza bajo el perfil privado (mage-private) de la cuenta; ausente/'shared' usa
  // la cuenta tal cual (historial en el pozo comun). Factura SIEMPRE la cuenta (mismo login).
  readonly privacy?: ConversationPrivacy;
  // M2.6: modo de permiso inicial (--permission-mode). Ausente -> 'default'. Solo Claude.
  readonly permissionMode?: PermissionMode;
}

// Resultado de crear una sesion: el id y el config dir EFECTIVO con el que se lanzo (la cuenta o su
// perfil privado). El renderer guarda el configDir en la pestana para localizar sus transcripciones.
export interface CreateSessionResult {
  readonly sessionId: string;
  readonly configDir: string;
}

export interface SendMessageParams {
  readonly sessionId: string;
  readonly text: string;
  // Imagenes adjuntas (2.12.1). `data` es base64 SIN el prefijo `data:`. AUSENTE o [] = mensaje de solo
  // texto, y entonces el adapter manda EXACTAMENTE el payload de siempre (`content` como string).
  readonly attachments?: readonly ImageAttachment[];
}

// Imagen adjunta a un mensaje del usuario. Vive en el contrato IPC porque cruza main<->renderer; la
// validacion (tipos permitidos y topes de tamaño) es del modulo puro `attachments.ts`, y se aplica en
// los DOS lados: el renderer para dar un error bonito, main porque es la frontera de verdad.
export interface ImageAttachment {
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  readonly data: string;
}

// Cambio de modelo en caliente (M2.4, solo Claude): aplica al siguiente turno de la sesion.
export interface SetModelParams {
  readonly sessionId: string;
  readonly model: string;
}

// Cambio de modo de permiso en caliente (M2.6, solo Claude): control_request set_permission_mode.
export interface SetPermissionModeParams {
  readonly sessionId: string;
  readonly mode: string; // el CLI decide si lo acepta (Claude: control_error si no; Codex: perfil del siguiente turno)
}

// Parar un subagente (0.1.1 R2, punto 29): `taskId` es el `agentId` del bloque del subagente.
export interface StopTaskParams {
  readonly sessionId: string;
  readonly taskId: string;
}

export interface AnswerPermissionParams {
  readonly sessionId: string;
  readonly requestId: string;
  readonly decision: PermissionDecision;
}

// Origen y destino de la adopcion de login (9.2). Los dos tienen que ser cuentas gestionadas.
export interface AdoptLoginParams {
  readonly sourceConfigDir: string;
  readonly targetConfigDir: string;
}

// Parametros del arranque del login (Fase 9.2). El login lo hace el CLI del proveedor: Mage lo
// spawnea, abre su URL en ventana privada y relaya el *code*. `email` solo prerrellena el formulario
// de Anthropic (`login_hint`), y es opcional.
export interface LoginStartParams {
  readonly configDir: string;
  readonly email: string | null;
}

// Identifica la transcripcion a abrir por los mismos datos con los que se arranco la sesion
// (nunca una ruta de fichero cruda desde el renderer): main resuelve el path real y lo valida.
// `agentId` opcional (M2.2.3b, drill-down): si viene, se abre el transcript del SUBAGENTE
// (`<sessionId>/subagents/agent-<agentId>.jsonl`) en vez del principal (`<sessionId>.jsonl`).
export interface OpenTranscriptParams {
  readonly accountDir: string;
  readonly cwd: string;
  readonly sessionId: string;
  readonly agentId?: string;
  // I5: reanuda desde esta posicion en vez de leer desde el principio (lectura incremental/tail).
  // Ausente o `TRANSCRIPT_TAIL_START` = comportamiento de siempre (todo el fichero).
  readonly resumeFrom?: TranscriptTailPosition;
}

// La memoria es por PROYECTO (cwd), no por sesión: se identifica por la cuenta activa + cwd (main
// resuelve <accountDir>/projects/<cwd-encoded>/memory/ y lo valida). Nunca una ruta cruda por IPC.
export interface ReadMemoryParams {
  readonly accountDir: string;
  readonly cwd: string;
}

// Guardado PARCIAL de las preferencias de una conversacion (2.1): lo que no venga se conserva; un
// campo con cadena vacia lo BORRA (paridad con `setActiveEffort`, que trata '' como "sin esfuerzo").
export interface SaveConversationPrefsParams {
  readonly sessionId: string;
  readonly prefs: ConversationPrefs;
}

// Registro de un artifact publicado (2.4). `record.accountDir` es el config dir EFECTIVO de la sesion
// que lo publico (para una conversacion privada, su perfil `mage-private`).
export interface RecordArtifactParams {
  readonly url: string;
  readonly record: ArtifactRecord;
}

export interface OpenArtifactParams {
  readonly url: string;
  // Cuenta con la que abrirlo. Omitido -> main mira el indice; si tampoco esta, LANZA y el renderer
  // ofrece el selector "abrir con...".
  readonly accountDir?: string;
}

// Mejora de prompt (M2.3): reescribe `draft` con un `claude -p` puntual en la cuenta `accountDir`.
export interface ImprovePromptParams {
  readonly draft: string;
  readonly accountDir: string;
}

// Prompt handoff (M2.3): genera un prompt autocontenido reanudando la sesion `sessionId`.
export interface HandoffPromptParams {
  readonly sessionId: string;
  // Config dir EFECTIVO de la conversación (cuenta o su perfil privado): sin él, una conversación
  // privada no se encuentra al reanudar.
  readonly accountDir: string;
  readonly model: string;
  // cwd de la conversación: `claude --resume <id>` busca la sesión bajo projects/<cwd-codificado>.
  readonly cwd: string;
}

// Editor detectado en el PATH (M2.3, "Abrir en <editor>"): bin = comando, label = nombre visible.
export interface EditorInfo {
  readonly bin: string;
  readonly label: string;
}

// Apertura de la carpeta `cwd` en el editor `bin` (uno de los devueltos por listEditors).
export interface OpenEditorParams {
  readonly bin: string;
  readonly cwd: string;
}

// Notificacion del SO (M2.3). main solo la muestra si la ventana NO tiene el foco (evita ruido).
export interface NotifyParams {
  readonly title: string;
  readonly body: string;
  // A donde lleva el clic (P-028 40). Ausente = solo enfoca la ventana.
  readonly target?: NotificationTarget;
}

// Conversacion que disparo la notificacion. `tabId` solo vale en la ventana que la pidio; `sessionId`
// la encuentra en cualquier otra (o en el historial, si la pestaña se cerro).
export interface NotificationTarget {
  readonly tabId?: string;
  readonly sessionId: string;
  // «Subagente terminado»: ademas de la pestaña, abre el panel de Actividad (decision b de 40).
  readonly opensActivity?: boolean;
}

// Config compartida entre cuentas (D1 Fase 2): los dos ficheros propios de Mage (fuera de cualquier
// CLAUDE_CONFIG_DIR) que se inyectan por flag al lanzar (--mcp-config/--settings, ver D1 Fase 1).
// De mcp-common.json NO viaja el texto (P-028: lleva los `env` de los servidores): solo sus avisos y
// nombres. Lo edita la seccion «MCP y conectores» por los canales `Mcp*`. De settings-common.json si
// viaja el texto crudo (hooks y reglas de permisos) para su editor.
export interface SharedConfigSnapshot {
  readonly settingsCommonText: string;
  readonly mcpCommonWarnings: readonly string[];
  readonly settingsCommonWarnings: readonly string[];
  readonly mcpCommonServerNames: readonly string[];
  // Colisiones de la importacion inicial de mcp-common.json (P-026 2.5), solo en la ejecucion que la
  // hizo. Vacio en las demas.
  readonly mcpCommonImportNotes: readonly string[];
  // Bytes EXACTOS observados en disco cuando se leyo (null = el fichero no existia). Es la base del
  // compare-and-swap al guardar, y NO es lo mismo que `*Text`: ese sustituye el fichero ausente por un
  // JSON valido de arranque para que el editor no muestre un aviso antes de que el usuario toque nada.
  readonly settingsCommonBaseline: string | null;
}

// Solo settings-common.json se guarda como texto; mcp-common.json va por `mutateMcpCommon`.
export type SharedConfigFile = 'settings-common';

export interface SaveSharedConfigParams {
  readonly file: SharedConfigFile;
  readonly text: string;
  // Lo que el editor leyo al cargar (el `*Baseline` del snapshot). Si el fichero en disco ya no
  // contiene esto, el guardado se RECHAZA en vez de pisar la edicion ajena.
  readonly expected: string | null;
}

// `saved`: los avisos son de la validacion TRAS guardar (claves descartadas por forma), que no
// bloquean el guardado. El guardado en si lanza si el texto ni siquiera es JSON valido.
// `stale`: el fichero cambio fuera de Mage desde que el editor lo cargo y NO se ha escrito nada.
export type SaveSharedConfigResult =
  | { readonly status: 'saved'; readonly warnings: readonly string[] }
  | { readonly status: 'stale'; readonly message: string };

// Layout de paneles acoplables (F6 Fase 2, PLAN-F6-PANELES.md §5.3/§7): el registro de paneles real
// (con `render` de React) vive SOLO en el renderer (panelRegistry.ts) — no puede cruzar a main (medido
// con tsc -p tsconfig.node.json). Por eso `loadPanelLayout` manda el catalogo (solo
// id/defaultAnchor/defaultZone de cada panel) como parametro: main reconcilia contra ESE catalogo,
// nunca contra uno propio hardcodeado.
export interface LoadPanelLayoutParams {
  readonly registry: readonly PanelPlacement[];
}

// --- Canal main -> renderer (push de eventos via webContents.send) ----------------------------

export const EVENT_CHANNEL = 'session:event';

export interface SessionEventPayload {
  readonly sessionId: string;
  readonly event: MageEvent;
}

// Canal DEDICADO para lotes de transcripcion (dominio distinto de EVENT_CHANNEL: transcripciones
// persistidas, no eventos de una sesion en vivo).
export const TRANSCRIPT_BATCH_CHANNEL = 'transcript:batch';

// Canales push del WIDGET FLOTANTE (M3). WIDGET_SNAPSHOT: main -> ventana del widget (estado a
// pintar). WIDGET_FOCUS_TAB: main -> renderer principal (activar la pestana clicada en el widget).
export const WIDGET_SNAPSHOT_CHANNEL = 'widget:snapshot';
export const WIDGET_FOCUS_TAB_CHANNEL = 'widget:focusTab';
// main -> renderer: el usuario pulso una notificacion de Mage; payload `NotificationTarget` (P-028 40).
export const NOTIFICATION_CLICKED_CHANNEL = 'notification:clicked';
// main -> renderer principal: la preferencia del widget cambio FUERA del renderer (toggle del tray o
// cierre inesperado de la ventana). El renderer (unico escritor de settings) actualiza y persiste.
export const WIDGET_ENABLED_CHANGED_CHANNEL = 'widget:enabledChanged';

// main -> renderer principal: el usuario pulso una entrada de la JUMP LIST de Windows (Ronda 3, item
// 10). Main resuelve la conversacion en disco antes de mandarla, asi que el renderer recibe el mismo
// `ConversationSummary` que ya consume desde el historial — no tiene que fiarse de un argv.
export const JUMP_LIST_OPEN_CHANNEL = 'jumpList:open';

// Datos de la pantalla «Acerca de». `notices` es el texto COMPLETO de `THIRD-PARTY-NOTICES.txt` (lo
// que conserva los avisos de copyright que el bundle borra) y `chromiumLicensesPath` es la ruta al
// fichero de avisos de Chromium que instala Electron, o null si no esta donde se le espera.
export interface AboutInfo {
  readonly versions: {
    readonly app: string;
    readonly electron: string;
    readonly chromium: string;
    readonly node: string;
  };
  readonly notices: string;
  readonly chromiumLicensesPath: string | null;
}

// Colores de la "non-client area" (botones de sistema) que el renderer manda a main al cambiar de
// tema. Hex #rrggbb: es el formato de todos los tokens de Mage, incluidos los de un tema importado.
export interface TitleBarOverlayColors {
  readonly color: string; // fondo de la franja de botones
  readonly symbolColor: string; // glifos de minimizar/maximizar/cerrar
}

// Las dos vistas nuevas leen por CONVERSACION: hace falta su carpeta y su config dir efectivo.
export interface ReadInstructionsParams {
  readonly cwd: string;
  readonly accountDir: string;
  // Proveedor de la pestaña. Con codex o agy la vista enseña los CLAUDE.md que Mage le PUENTEA (grupo H).
  readonly provider?: string;
}

// Un fichero del proyecto, tal como lo ve el panel "Ficheros" (2.10).
//   - `content: null` + `tooLarge: false` -> no existe (el agente lo creo y lo borro, o la conversacion
//     se reabrio en otra maquina). No es un error.
//   - `content: null` + `tooLarge: true`  -> existe pero pasa del tope; no se carga en el renderer.
//   - `mtimeMs` es el TESTIGO del compare-and-swap: se devuelve al guardar y se manda de vuelta en la
//     siguiente escritura, que se rechaza si el fichero cambio por fuera entre medias.
export interface ProjectFileContent {
  readonly path: string;
  readonly content: string | null;
  readonly mtimeMs: number | null;
  readonly tooLarge: boolean;
  // Fuera de la carpeta de la conversacion y sin aprobar (P-028, 15): `content` es null y el panel
  // ofrece abrirlo con `approveProjectFileOutside`. Ausente = dentro o ya aprobado.
  readonly outsideCwd?: boolean;
}

export interface ReadProjectFileParams {
  // Carpeta de la conversacion. El fichero tiene que estar DENTRO; main lo valida y lanza si no.
  readonly cwd: string;
  readonly path: string;
}

export interface WriteProjectFileParams extends ReadProjectFileParams {
  readonly content: string;
  // El mtime que el panel leyo (null = no existia). Si no coincide con el de disco, main RECHAZA la
  // escritura en vez de pisar lo que haya cambiado.
  readonly expectedMtimeMs: number | null;
}

export interface InstructionsFile {
  readonly scope: 'project' | 'user';
  readonly path: string;
  readonly content: string | null; // null = el fichero no existe (no es un error)
  // Solo en pestañas de codex o agy: como se lo pasa Mage (`target`) o, si el CLI tiene su propio
  // fichero en ese ambito (`ownFile`), que no se le pasa.
  readonly bridge?: { readonly target: 'AGENTS.md' | 'GEMINI.md'; readonly ownFile: string | null };
}

// De donde sale una regla o un hook. MEDIDO (2026-08-02): los hooks y `permissions.allow` se CONCATENAN
// entre fuentes, no se pisan -> la vista muestra la union etiquetada, nunca una precedencia inventada.
//
// `projectLocal` es `<cwd>/.claude/settings.local.json`, el fichero NO versionado del proyecto. Se lee
// porque es donde el propio CLI escribe lo que el usuario acepta con su "always allow": sin el, el panel
// de Permisos decia "no hay reglas" mientras el agente no preguntaba por nada (2.3b).
export type SettingsOrigin = 'account' | 'project' | 'projectLocal' | 'mageCommon';

export interface HookEntry {
  readonly event: string;
  readonly matcher: string | null;
  readonly command: string;
  readonly origin: SettingsOrigin;
}

export interface PermissionRule {
  readonly pattern: string;
  // `ask` es el tercer efecto de `permissions` del CLI: fuerza la pregunta aunque otra regla permita.
  // Estaba sin leer, asi que una conversacion con reglas `ask` se veia sin ninguna regla.
  readonly effect: 'allow' | 'deny' | 'ask';
  readonly origin: SettingsOrigin;
}

export interface EffectiveSettings {
  readonly hooks: readonly HookEntry[];
  readonly rules: readonly PermissionRule[];
  // Solo `mageCommon` es editable desde Mage: los otros dos ficheros son del usuario/proyecto y Mage no
  // los reescribe (misma politica que ya declara la seccion MCP y conectores).
  readonly editableOrigin: SettingsOrigin;
}

// Comandos de edicion nativos que el menu propio tiene que reponer (2.9.b).
export const EDIT_COMMANDS = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] as const;
export type EditCommandName = (typeof EDIT_COMMANDS)[number];


export interface JumpListOpenPayload {
  readonly accountDir: string;
  // Ausente => abrir el dialogo de conversacion NUEVA en esa cuenta (item de la categoria "Cuentas").
  readonly conversation?: ConversationSummary;
}

// Un mensaje del canal lleva O BIEN un lote (`batch`) O BIEN un `error` terminal (la lectura fallo:
// fichero inexistente, error de FS...). Mutuamente excluyentes; `error` cierra la lectura igual que
// un lote final. Sin `error`, la propagacion del fallo se quedaba solo en el log de main y el
// renderer colgaba en "Cargando…" para siempre.
export interface TranscriptBatchPayload {
  readonly transcriptId: string;
  readonly batch?: TranscriptBatch;
  readonly error?: string;
}

// --- Varias ventanas del workbench ------------------------------------------------------------

// main -> TODAS las ventanas MENOS la que lo origino: un ajuste cambio en otra ventana. Es lo que
// impide la discrepancia de configuracion entre ventanas ("si cambio los ajustes en una, en la otra
// tambien tiene que cambiar"). Se excluye al emisor a proposito: ya tiene el valor aplicado, y
// devolverselo pisaria una edicion en curso suya.
export const SETTINGS_CHANGED_CHANNEL = 'settings:changed';

// main -> UNA ventana: le llega una pestaña movida desde otra. La ventana de origen la quita de su
// estado; esta la adopta.
export const WINDOW_TAB_RECEIVED_CHANNEL = 'windows:tabReceived';

// main -> TODAS las ventanas: el catalogo de modelos de un config dir cambio (P-026 2.4). Llega del
// sondeo de arranque, que termina cuando la ventana ya esta pintada.
export const MODEL_CATALOG_CHANGED_CHANNEL = 'modelCatalog:changed';
// Main -> todas las ventanas: lectura nueva de un PR vigilado (`GhPrUpdate`).
export const GH_PR_UPDATE_CHANNEL = 'gh:prUpdate';

// --- Dialogos propios de cierre y de actualizacion (grupo B) ----------------------------------

// main -> UNA ventana (la que se cierra): pinta el dialogo «¿Cerrar Mage?». La decision la sigue
// tomando main; el renderer solo pregunta y contesta por `IpcChannel.CloseAnswer`.
export const CLOSE_PROMPT_CHANNEL = 'close:prompt';

// Lo que contesta el dialogo de cierre. `remember` = «Recordar mi decisión» (con `cancel` no se guarda).
export interface CloseAnswer {
  readonly action: 'hide' | 'quit' | 'cancel';
  readonly remember: boolean;
}

// main -> TODAS las ventanas: cambio el estado de la actualizacion (indicador de la barra de estado).
export const UPDATE_STATE_CHANNEL = 'update:state';
// main -> UNA ventana (la enfocada): enseña el dialogo de «lista para instalar» de esa version.
export const UPDATE_PROMPT_CHANNEL = 'update:prompt';

export interface ModelCatalogChange {
  readonly configDir: string;
  readonly models: readonly ProviderModel[];
}

// Una ventana abierta, tal como la ve el renderer que pregunta. `isCurrent` es la ventana desde la
// que se hizo la llamada (main lo resuelve por el `event.sender`, nunca se fia de un id del renderer).
// Id de la ventana principal. Es una constante y no un id generado porque es la unica que existe
// desde el arranque y la que conserva el estado persistido de siempre (workspace-state.json). Vive en
// shared porque el renderer tambien necesita saber si es la principal (las notas de version).
export const MAIN_WINDOW_ID = 'main';

export interface MageWindowInfo {
  readonly windowId: string;
  readonly isCurrent: boolean;
}

export interface MoveTabToWindowParams {
  readonly targetWindowId: string;
  // Estado persistido de la pestaña: lo mismo que se guarda en el workspace. No viaja el contenido de
  // la conversacion (vive en la transcripcion del CLI) ni nada de credenciales.
  readonly tab: PersistedTab;
}

// Que hizo main con una pestaña soltada fuera de su ventana (P-028, 36). 'moved' = ya esta en otra
// ventana (nueva o existente) y el ORIGEN tiene que cerrarla; 'none' = no se hizo nada (se solto
// dentro de la propia ventana, o el sistema no deja saber donde esta el cursor: Wayland).
export type DropTabOutcome = 'moved' | 'none';

// --- API tipada que el preload expone en window.mage ------------------------------------------

export interface MageApi {
  createSession(params: CreateSessionParams): Promise<CreateSessionResult>; // sessionId + configDir efectivo
  sendMessage(params: SendMessageParams): Promise<void>;
  answerPermission(params: AnswerPermissionParams): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  // Cambia el modelo de una sesion viva (M2.4, solo Claude); aplica al siguiente turno.
  setModel(params: SetModelParams): Promise<void>;
  // Cambia el modo de permiso de una sesion viva (M2.6, solo Claude): default/acceptEdits/plan.
  setPermissionMode(params: SetPermissionModeParams): Promise<void>;
  // Para UN subagente en segundo plano (0.1.1 R2, punto 29, solo Claude).
  stopTask(params: StopTaskParams): Promise<void>;
  stop(sessionId: string): Promise<void>;
  // Carpeta scratch temporal (cross-platform) para el cwd de la sesion de prueba (Fase B).
  getScratchDir(): Promise<string>;
  // Raiz de los directorios de borrador. NO crea nada: `getScratchDir` acuña una carpeta nueva en cada
  // llamada, asi que no vale para averiguar la raiz — devolveria un hermano, no el padre.
  getScratchRoot(): Promise<string>;
  // ¿Existe cada carpeta, en el mismo orden? Para no ofrecer proyectos recientes borrados (P-028, 16).
  existsDirs(paths: readonly string[]): Promise<readonly boolean[]>;
  // ¿Esta instalado el CLI `agy` (E3)? El renderer no puede mirar el PATH ni el disco, y ofrecer un
  // proveedor que no puede funcionar seria mentirle al usuario. ponytail: una sola pregunta para el
  // unico proveedor nativo que Mage no instala; techo: si hubiera mas, pasa a devolver un mapa por id.
  isAgyInstalled(): Promise<boolean>;
  // Sondea un proveedor para la seccion "Proveedores y modelos" (D2). Nunca rechaza por un fallo DEL
  // PROVEEDOR: eso viaja en `error` para que la UI lo pueda decir en vez de inventarse una lista.
  probeProvider(params: ProviderProbeParams): Promise<ProviderProbeResult>;
  probeRuntime(params: RuntimeProbeParams): Promise<RuntimeProbeResult>;
  // Abre en el navegador el login OAuth pendiente de un servidor MCP del runtime propio (D3 de P-033).
  openMcpLogin(loginId: string): Promise<void>;
  // Guarda (cifrada, en main) o borra la api key de un proveedor del usuario. Rechaza si el cifrado del
  // sistema no esta disponible: nunca se guarda en claro.
  setProviderApiKey(params: ProviderApiKeySetParams): Promise<void>;
  deleteProviderApiKey(providerId: string): Promise<void>;
  // Escala de la interfaz (80..150 %) via zoom de Chromium en ESTE frame. Sincrono: no hay IPC.
  setUiScale(percent: number): void;
  // Datos de «Acerca de» (versiones + avisos de terceros). Se pide al abrir la seccion, no al arrancar.
  getAbout(): Promise<AboutInfo>;
  // Revela un archivo en el gestor de archivos del SO.
  revealFile(path: string): Promise<void>;
  // Abre "Guardar como" y copia el archivo; devuelve false si el usuario cancela.
  saveFileAs(path: string): Promise<boolean>;
  // Abre una ruta (p.ej. la carpeta del proyecto) con la app por defecto del SO (M2.3, "Open with").
  openPath(path: string): Promise<void>;
  // Abre una URL en el navegador del usuario. Solo https (main rechaza cualquier otro esquema).
  openExternal(url: string): Promise<void>;
  // Recolorea los botones de sistema de la ventana con los colores del tema activo. No-op donde la
  // plataforma no soporta `titleBarOverlay` (macOS/Linux).
  setTitleBarOverlay(colors: TitleBarOverlayColors): Promise<void>;
  // Ejecuta un comando de edicion en el webContents con el foco (2.9.b): es literalmente lo que hacian
  // los `role:` del menu nativo que el menu propio sustituye.
  runEditCommand(command: EditCommandName): Promise<void>;
  // Abre una terminal del SO en el directorio dado (M2.3, "Open with").
  openTerminal(cwd: string): Promise<void>;
  // Editores detectados en el PATH (M2.3); vacio si no hay ninguno instalado.
  listEditors(): Promise<readonly EditorInfo[]>;
  // Abre la carpeta del proyecto en uno de los editores detectados (M2.3).
  openEditor(params: OpenEditorParams): Promise<void>;
  // Suscripcion a eventos; devuelve funcion para desuscribir.
  onSessionEvent(listener: (payload: SessionEventPayload) => void): () => void;
  // Cuentas: descubrir en disco, crear una nueva, y lanzar el login interactivo (terminal externa).
  listAccounts(): Promise<readonly AccountInfo[]>;
  createAccount(name: string): Promise<AccountInfo>;
  // Login por el CLI (Fase 9.2). Tres pasos porque el usuario pega el *code* en medio:
  //   startLogin  -> spawnea el CLI, abre su URL en ventana privada y dice COMO se abrio.
  //   submitLoginCode -> relaya el code por stdin y verifica con `auth status --json`.
  //   cancelLogin -> mata el CLI si el usuario cierra el dialogo.
  // Mage nunca ve el token: lo escribe el CLI. El resultado que cruza el IPC es SEGURO.
  startLogin(params: LoginStartParams): Promise<CliLoginStart>;
  submitLoginCode(code: string): Promise<EmbeddedLoginResult>;
  cancelLogin(): Promise<void>;
  // Copia la sesion de otra cuenta sobre la nueva (9.2): cero clics para quien ya usa ~/.claude.
  // Las dos quedan con la MISMA identidad de Anthropic; lo que no comparten es projects/ ni ajustes.
  adoptLogin(params: AdoptLoginParams): Promise<void>;
  // Elimina una cuenta (desenlaza compartidas + borra su dir). Nunca la principal.
  deleteAccount(configDir: string): Promise<void>;
  // Alta de una cuenta de la matriz (grupo E). La clave sube aqui UNA vez y no vuelve nunca.
  createProviderAccount(params: AccountCreateParams): Promise<AccountInfo>;
  // Login de ChatGPT de una cuenta de Codex: resuelve cuando el CLI lo da por hecho (o falla).
  startCodexLogin(configDir: string): Promise<CodexLoginOutcome>;
  cancelCodexLogin(): Promise<void>;
  isCodexInstalled(): Promise<boolean>;
  // Uso de la suscripcion de agy («/usage»): grupos y ventanas, o el motivo por el que no hay.
  readAgyUsage(): Promise<AgyUsageSnapshot>;
  // Modos de permiso leidos de cada CLI; null en el que no contesto (cae a la lista de Mage).
  listPermissionModes(): Promise<PermissionModesByProviderView>;
  // Selector de carpeta de proyecto (cwd de una pestana); null si el usuario cancela.
  pickDirectory(): Promise<string | null>;
  // Confia el usuario en `cwd` para lanzar un agente? Suma lo autorizado en Mage y lo que el usuario ya
  // autorizo en el CLI de esa cuenta, subiendo por los directorios padre en las dos.
  isFolderTrusted(params: { cwd: string; accountDir: string }): Promise<boolean>;
  // Git (P-026 3.5). Sin git, sin repo o sin confianza, el estado lo dice y no se ejecuta nada.
  gitStatus(params: GitParams): Promise<GitSnapshot>;
  gitBranches(params: GitParams): Promise<readonly string[]>;
  gitSwitch(params: GitSwitchParams): Promise<void>;
  // PR/CI (grupo D). Sin gh, sin sesion, sin repo de GitHub o sin confianza, el estado lo dice.
  ghBranchPr(params: GitParams): Promise<GhSnapshot>;
  ghWatch(params: GhWatchParams): Promise<void>;
  ghUnwatch(key: string): Promise<void>;
  ghRuns(params: GhRunsParams): Promise<GhRunsSnapshot>;
  ghRunAction(params: GhRunActionParams): Promise<void>;
  ghAutoMerge(params: GhAutoMergeParams): Promise<void>;
  onGhPrUpdate(listener: (update: GhPrUpdate) => void): () => void;
  // Worktrees (grupo D). `worktreeCreate` da null si la carpeta no es la raiz del repo.
  worktreeCreate(params: WorktreeCreateParams): Promise<{ readonly path: string; readonly branch: string } | null>;
  worktreeRestore(params: GitParams): Promise<void>;
  worktreeRemove(params: GitParams): Promise<WorktreeRemoveResult>;
  worktreeMergeBase(params: WorktreeMergeBaseParams): Promise<'merged' | 'conflict'>;
  // Uso de una cuenta (por configDir). Devuelve datos agregados SEGUROS (sin token). Cacheado en main.
  getUsage(configDir: string): Promise<UsageInfo>;
  // Estado del servicio de Claude (global, no por cuenta). Cacheado en main.
  getStatus(): Promise<StatusInfo>;
  // Version de Mage, para pintarla en la barra de estado. No cambia en caliente.
  getAppVersion(): Promise<string>;
  // Avisa a main del cambio de opacidad para que ajuste el material de la ventana.
  setWindowOpacity(percent: number): Promise<void>;
  // Abre una transcripcion persistida en streaming. El `transcriptId` lo GENERA el renderer y lo
  // fija en su estado ANTES de invocar: asi ningun lote/error (el error se emite de forma sincrona
  // si el fichero no existe) llega antes de que el store conozca el id y se descarte por la carrera.
  // No espera a terminar de leer: los lotes/errores llegan por onTranscriptBatch.
  openTranscript(transcriptId: string, params: OpenTranscriptParams): Promise<void>;
  // Cancela una lectura en curso (p.ej. al cerrar la pestana de logs antes de terminar).
  cancelTranscript(transcriptId: string): Promise<void>;
  // Suscripcion a lotes de transcripcion; devuelve funcion para desuscribir.
  onTranscriptBatch(listener: (payload: TranscriptBatchPayload) => void): () => void;
  // Lee los ficheros .md de la memoria de un proyecto (crudos; el parseo va en el renderer). Array
  // vacio si el proyecto no tiene memoria. Ficheros pequenos (KB) -> lectura sincrona de una vez.
  readMemory(params: ReadMemoryParams): Promise<readonly MemoryFile[]>;
  // Lista las conversaciones EN DISCO de una cuenta (M2.6, sidebar = historial): compartidas (pozo
  // comun) + privadas (perfil mage-private), mas recientes primero. Solo metadatos (sin contenido).
  listConversations(accountDir: string): Promise<readonly ConversationSummary[]>;
  deleteConversation(params: DeleteConversationParams): Promise<void>;
  moveConversation(params: MoveConversationParams): Promise<MoveConversationResult>;
  // Persistencia del workspace (M2.5): lista de pestanas + activa. null si nunca se guardo o el
  // fichero esta corrupto (arranque limpio). El contenido de las conversaciones NO se guarda aqui.
  loadWorkspace(): Promise<PersistedWorkspace | null>;
  saveWorkspace(state: PersistedWorkspace): Promise<void>;
  // Catalogo "/" cacheado de una cuenta (2.2). Vacio si nunca se midio: entonces el popover ofrece los
  // comandos curados de siempre. La cache la ESCRIBE main cuando una sesion reporta su catalogo.
  loadCommandCatalog(accountDir: string): Promise<readonly SlashCommandInfo[]>;
  // Modelos cacheados de una cuenta (P-026 2.4). Vacio si nunca se midio: el selector usa la reserva.
  loadModelCatalog(accountDir: string): Promise<readonly ProviderModel[]>;
  // Indice propio de Mage por conversacion (2.1): modelo/esfuerzo/modo de permiso que el CLI no
  // persiste. null si esa conversacion no tiene nada guardado.
  loadConversationPrefs(sessionId: string): Promise<ConversationPrefs | null>;
  saveConversationPrefs(params: SaveConversationPrefsParams): Promise<void>;
  // Registro de artifacts publicados (2.4): quien lo publico, para poder reabrirlo con ESA cuenta.
  recordArtifact(params: RecordArtifactParams): Promise<void>;
  // Abre el artifact en una ventana con la sesion de su cuenta. LANZA si no se sabe con cual (ni en el
  // parametro ni en el indice): abrirlo "con la que sea" es justo el fallo que 2.4 viene a arreglar.
  openArtifact(params: OpenArtifactParams): Promise<void>;
  // Cuenta que publico un artifact, o null si no consta (publicado fuera de Mage, o antes de 2.4).
  lookupArtifactPublisher(url: string): Promise<string | null>;
  // Instrucciones que aplican a la conversacion (2.9.b): CLAUDE.md de proyecto y de usuario. `content`
  // null = el fichero no existe (no es un error).
  readInstructions(params: ReadInstructionsParams): Promise<readonly InstructionsFile[]>;
  // Panel "Ficheros" (2.10): lee y guarda un fichero creado por el agente. `writeProjectFile` LANZA si
  // el fichero cambio en disco desde la lectura (compare-and-swap por mtime) o si la ruta cae fuera de
  // la carpeta de la conversacion.
  readProjectFile(params: ReadProjectFileParams): Promise<ProjectFileContent>;
  writeProjectFile(params: WriteProjectFileParams): Promise<ProjectFileContent>;
  // Pregunta con un dialogo nativo si abrir un fichero de fuera de la carpeta de la conversacion (la
  // ruta la resuelve y la ensena main). true = aprobado para leer y editar hasta cerrar Mage.
  approveProjectFileOutside(params: ReadProjectFileParams): Promise<boolean>;
  // Texto de los bloques de pensamiento de una conversacion, EN ORDEN. El CLI persiste sus bloques
  // `thinking` vacios, asi que este es el unico sitio donde existe el cuerpo al reanudar. Vacio para
  // una conversacion anterior a esto o sin pensamiento ninguno.
  readThinking(sessionId: string): Promise<readonly string[]>;
  // Hooks y reglas de permisos EFECTIVOS, de las tres fuentes, cada uno etiquetado con su origen.
  readEffectiveSettings(params: ReadInstructionsParams): Promise<EffectiveSettings>;
  // Configuracion de la app (M2.3): reglas de notificacion, etc. Defaults si nunca se guardo.
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  // Mejora un borrador de prompt (M2.3) con un `claude -p` puntual y modelo barato; devuelve el
  // prompt reescrito. Lanza si el CLI falla o la respuesta viene vacia.
  improvePrompt(params: ImprovePromptParams): Promise<string>;
  // Genera un prompt de handoff autocontenido (M2.3) reanudando la sesion; devuelve el prompt.
  generateHandoff(params: HandoffPromptParams): Promise<string>;
  // Muestra una notificacion del SO (M2.3); main la ignora si la ventana tiene el foco.
  notify(params: NotifyParams): Promise<void>;

  // --- Widget flotante (M3) -------------------------------------------------------------------
  // Abre/cierra la ventana del widget (segun `enabled`). La preferencia se persiste aparte via
  // saveSettings; esto solo controla la ventana.
  setWidgetEnabled(enabled: boolean): Promise<void>;
  // Empuja el snapshot a la ventana del widget (fire-and-forget). No-op en main si no esta abierta.
  // Lo llama el renderer PRINCIPAL (fuente de verdad del estado).
  pushWidgetSnapshot(snapshot: WidgetSnapshot): void;
  // Activa una pestana desde el widget: main enfoca la ventana principal y le reenvia el tabId.
  activateWidgetTab(tabId: string): void;
  // Suscripcion al snapshot (la usa la ventana del WIDGET). Devuelve funcion para desuscribir.
  onWidgetSnapshot(listener: (snapshot: WidgetSnapshot) => void): () => void;
  // Suscripcion al "activar pestana" (la usa el renderer PRINCIPAL). Devuelve funcion para desuscribir.
  onWidgetFocusTab(listener: (tabId: string) => void): () => void;
  // El usuario pulso una notificacion de Mage de ESTA ventana (P-028 40).
  onNotificationClicked(listener: (target: NotificationTarget) => void): () => void;
  // Jump list de Windows (Ronda 3, item 10). En el resto de plataformas nunca se emite.
  onJumpListOpen(listener: (payload: JumpListOpenPayload) => void): () => void;
  // Suscripcion al cambio de preferencia hecho fuera del renderer (toggle del tray / cierre de la
  // ventana). El renderer principal actualiza su estado y persiste (unico escritor de settings).
  onWidgetEnabledChanged(listener: (enabled: boolean) => void): () => void;

  // --- Mercado de temas Open VSX (M3) ---------------------------------------------------------
  // Busca temas de color de VS Code en Open VSX. Lanza si la red falla.
  // `offset` salta las N primeras coincidencias: es lo que deja EXPLORAR mas alla de la primera
  // pagina en vez de quedarse siempre en los mas descargados.
  searchThemes(query: string, offset?: number): Promise<readonly ThemeSearchItem[]>;
  // Resuelve un tema concreto (manifest + fichero del tema) con los colores CRUDOS de VS Code.
  fetchTheme(params: FetchThemeParams): Promise<FetchedVscodeTheme>;

  // --- Config compartida entre cuentas (D1 Fase 2) --------------------------------------------
  // Snapshot actual de mcp-common.json/settings-common.json (texto crudo + avisos + nombres de
  // servidor comunes). Se relee cada vez que se abre la seccion de Configuracion o el Inspector.
  loadSharedConfig(): Promise<SharedConfigSnapshot>;
  // Guarda el texto de UNO de los dos ficheros. Lanza si no es JSON valido con la forma esperada.
  // Devuelve `stale` (sin escribir nada) si el fichero cambio en disco desde que el editor lo cargo:
  // estos dos ficheros los lee CUALQUIER lanzamiento de CUALQUIER cuenta y el usuario los edita a mano,
  // asi que pisar en silencio una edicion externa es la peor de las opciones.
  saveSharedConfig(params: SaveSharedConfigParams): Promise<SaveSharedConfigResult>;

  // --- MCP y conectores (P-028 puntos 5 y 34) --------------------------------------------------
  // Todas las fuentes que conoce la maquina, con NOMBRES de clave y nunca valores.
  loadMcpInventory(params: McpInventoryParams): Promise<McpInventory>;
  // Añade/edita/quita/desactiva un comun. `expected` es el `commonVersion` que se leyo: si el fichero
  // cambio desde entonces devuelve `stale` sin escribir. Lanza si el borrador no es valido.
  mutateMcpCommon(params: McpCommonMutateParams): Promise<McpWriteResult>;
  // «Mostrar»: los valores de env/headers de UN comun. Unica via por la que un valor llega aqui.
  revealMcpCommon(name: string): Promise<McpRevealedSecrets>;
  previewMcpImport(params: McpInventoryParams): Promise<McpImportPreview>;
  applyMcpImport(params: McpImportApplyParams): Promise<McpWriteResult>;
  // Estado de los MCP de cada cuenta con login, sin turno (un CLI por cuenta, en serie). Devuelve la
  // cache entera ya actualizada (lo sondeado sustituye a lo guardado de esas cuentas).
  probeMcpStatus(): Promise<McpStatusCache>;
  // Ultimo estado guardado de cada cuenta, con su fecha (sin sondear).
  loadMcpStatusCache(): Promise<McpStatusCache>;
  // --- Extensiones .mcpb ---
  listMcpExtensions(): Promise<McpExtensionList>;
  // Abre el dialogo nativo y valida el paquete elegido. null = cancelado. Lanza si no es instalable.
  pickMcpExtension(): Promise<McpExtensionInstallPreview | null>;
  installMcpExtension(token: string): Promise<void>;
  importDesktopMcpExtension(dirName: string): Promise<void>;
  setMcpExtensionEnabled(id: string, enabled: boolean): Promise<void>;
  setMcpExtensionOnlyIn(id: string, onlyIn: McpScope): Promise<void>;
  // Los sensibles suben una vez y nunca vuelven: el formulario solo sabe si hay valor.
  saveMcpExtensionConfig(params: McpExtensionConfigParams): Promise<void>;
  removeMcpExtension(id: string): Promise<void>;
  // Dialogo nativo de fichero para un campo `file` de user_config. null = cancelado.
  pickMcpFile(): Promise<string | null>;
  // --- Sincronizar con agy ---
  loadMcpAgySync(): Promise<McpAgySyncState>;
  // `secretsConfirmed`: servidores con valores de la boveda que se aceptan copiar en claro a agy.
  previewMcpAgySync(secretsConfirmed?: readonly string[]): Promise<McpAgySyncPreview>;
  applyMcpAgySync(expected: string | null, secretsConfirmed: readonly string[]): Promise<McpAgySyncResult>;
  setMcpAgyAutoSync(auto: boolean): Promise<McpAgySyncState>;
  // OAuth de un MCP con el CLI de esa cuenta: abre el navegador y espera el callback (tope 5 min).
  authenticateMcp(params: McpAuthParams): Promise<McpAuthResult>;

  // --- Layout de paneles acoplables (F6 Fase 2) ------------------------------------------------
  // Carga el layout persistido ya reconciliado contra `params.registry` (el catalogo real del
  // renderer, sin `render`). Nunca lanza ni devuelve null: fichero ausente/corrupto -> el layout por
  // defecto construido desde ese mismo registro (§3.3/§5.3).
  loadPanelLayout(params: LoadPanelLayoutParams): Promise<PanelLayoutState>;
  // Guarda el layout de forma atomica. Lanza si `state` no encaja con el esquema (error de
  // programacion, no un fichero de usuario: el estado ya deberia venir reconciliado).
  savePanelLayout(state: PanelLayoutState): Promise<void>;

  // --- Varias ventanas del workbench ----------------------------------------------------------
  // Abre una ventana NUEVA de Mage (misma instancia, mismo main, mismos ajustes) y devuelve su id.
  openWindow(): Promise<string>;
  // Ventanas abiertas, en el orden en que se abrieron, con `isCurrent` marcando la que pregunta.
  listWindows(): Promise<readonly MageWindowInfo[]>;
  // Entrega una pestaña a otra ventana. LANZA si esa ventana ya no existe (no se pierde en silencio).
  // El renderer de ORIGEN es quien la quita de su workspace tras resolverse la promesa.
  moveTabToWindow(params: MoveTabToWindowParams): Promise<void>;
  // Abre una ventana nueva con esta pestaña (P-028, 36). Devuelve su id.
  openWindowWithTab(tab: PersistedTab): Promise<string>;
  // Pestañas que esperaban a ESTA ventana al abrirse. Una sola vez: una segunda llamada da [].
  takePendingTabs(): Promise<readonly PersistedTab[]>;
  // Una pestaña se solto fuera de su ventana: main decide por el cursor (otra ventana, nueva o nada).
  dropTabOutside(tab: PersistedTab): Promise<DropTabOutcome>;
  // Un ajuste cambio en OTRA ventana: llega ya guardado en disco, listo para aplicar y reflejar.
  // Devuelve funcion para desuscribir.
  onSettingsChanged(listener: (settings: AppSettings) => void): () => void;
  // El catalogo de modelos de una cuenta cambio (sondeo de arranque o sesion). Devuelve desuscribir.
  onModelCatalogChanged(listener: (change: ModelCatalogChange) => void): () => void;
  // Llega una pestaña movida desde otra ventana. Devuelve funcion para desuscribir.
  onTabReceived(listener: (tab: PersistedTab) => void): () => void;

  // --- Dialogos propios de cierre y de actualizacion (grupo B) ---------------------------------
  // main pide el dialogo de cierre a ESTA ventana. Devuelve funcion para desuscribir.
  onClosePrompt(listener: () => void): () => void;
  // Respuesta al dialogo de cierre. Lanza si esta ventana no tenia una pregunta pendiente.
  answerClose(answer: CloseAnswer): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
  onUpdateState(listener: (state: UpdateState) => void): () => void;
  // main pide a ESTA ventana el dialogo de «lista para instalar» de la version dada.
  onUpdatePrompt(listener: (version: string) => void): () => void;
  // Reinicia e instala la actualizacion descargada. Lanza si no hay ninguna lista.
  installUpdate(): Promise<void>;
}
