import { randomUUID } from 'node:crypto';
import { execFile, spawn, spawnSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  closeSync,
  createReadStream,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { isUnderCliScratchpad as isUnderCliScratchpadPure } from './files/cliScratchpad';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  session,
  globalShortcut,
  shell,
  dialog,
  Notification,
  nativeTheme,
  screen,
} from 'electron';
import {
  EVENT_CHANNEL,
  IpcChannel,
  JUMP_LIST_OPEN_CHANNEL,
  MODEL_CATALOG_CHANGED_CHANNEL,
  NOTIFICATION_CLICKED_CHANNEL,
  SETTINGS_CHANGED_CHANNEL,
  TRANSCRIPT_BATCH_CHANNEL,
  WIDGET_ENABLED_CHANGED_CHANNEL,
  WIDGET_FOCUS_TAB_CHANNEL,
  WINDOW_TAB_RECEIVED_CHANNEL,
} from '@shared/ipc';
import type {
  AnswerPermissionParams,
  ModelCatalogChange,
  CreateSessionParams,
  CreateSessionResult,
  HandoffPromptParams,
  JumpListOpenPayload,
  EditCommandName,
  TitleBarOverlayColors,
  ImprovePromptParams,
  LoadPanelLayoutParams,
  AdoptLoginParams,
  LoginStartParams,
  NotifyParams,
  OpenEditorParams,
  OpenTranscriptParams,
  ReadInstructionsParams,
  ReadMemoryParams,
  OpenArtifactParams,
  RecordArtifactParams,
  SaveConversationPrefsParams,
  SaveSharedConfigParams,
  SaveSharedConfigResult,
  SendMessageParams,
  SetModelParams,
  SetPermissionModeParams,
  StopTaskParams,
  SharedConfigSnapshot,
  MageWindowInfo,
  MoveTabToWindowParams,
} from '@shared/ipc';
import { buildAboutInfo } from './about/aboutService';
import type { MemoryFile } from '@shared/memory';
import type { MageEvent, SlashCommandInfo } from '@shared/events';
import type { ImageAttachment, ProviderProbeParams } from '@shared/ipc';
import { base64ByteLength, validateAttachmentSet } from '@shared/attachments';
import type { EffectiveSettings, InstructionsFile, ProjectFileContent, ReadProjectFileParams, WriteProjectFileParams } from '@shared/ipc';
import type { ConversationPrefs } from '@shared/conversationIndex';
import type { ConversationSummary, DeleteConversationParams, MoveConversationParams, MoveConversationResult } from '@shared/conversations';
import type { PersistedWorkspace } from '@shared/state';
import type { AppSettings } from '@shared/settings';
import type { PanelLayoutState } from '@shared/panelLayout';
import type { MenuItemConstructorOptions } from 'electron';
import { DebugChannel } from '@shared/debug';
import type { RendererLogInput } from '@shared/debug';
import type { AccountInfo, CliLoginStart, EmbeddedLoginResult } from '@shared/accounts';
import { BASE_ARGS as CLAUDE_BASE_ARGS, ClaudeAdapter } from './engine/claudeAdapter';
import { probeModelCatalogs, type ProbeProcess } from './engine/modelProbe';
import { registerMcpIpc } from './config/mcpIpc';
import { resolveClaudeDesktopDirs, type McpAccountLocation } from './config/mcpInventory';
import { probeMcpStatuses } from './config/mcpStatusProbe';
import { authenticateMcp } from './config/mcpAuthFlow';
import { FAKE_AUTH_URL, spawnFakeMcpCli } from './config/mcpFakeCli';
import type { ProviderAuthSummary, ProviderModel } from '@shared/providers';
import { GatewayAdapter } from './engine/gatewayAdapter';
import { AgyAdapter } from './engine/agyAdapter';
import { defaultProbeDeps, probeProvider } from './engine/providerProbe';
import { findAgyBinary } from './os/agyBinaryResolver';
import { AGY_PROVIDER_ID, BUILT_IN_PROVIDERS, hasAdapter } from '@shared/providers';
import { providerAuthSummary } from './engine/providerAuth';
import { setCustomProviderLoader, setGatewayLogger, startGateway, stopGateway } from './engine/proxy/gateway';
import { defaultKillTreeDeps, killProcessTree } from './os/processTree';
import { SessionManager } from './engine/sessionManager';
import type { AccountLayout, ProviderAdapter } from './engine/providerAdapter';
import {
  defaultSharedConfigDeps,
  mcpCommonServerNames,
  parseMcpCommonJson,
  parseSettingsCommonJson,
  resolveSharedConfigArgs,
  SharedConfigService,
} from './config/sharedConfigService';
import { AccountService } from './accounts/accountService';
import { ConversationsService } from './conversations/conversationsService';
import { ConversationAdminService } from './conversations/conversationAdminService';
import { CliLoginService, type CliLoginProcess } from './accounts/cliLoginService';
import { writeCredentials } from './accounts/credentialsStore';
import { TokenRefreshService } from './accounts/tokenRefreshService';
import { parseStoredOauth } from './accounts/oauthFlow';
import { defaultLinkDeps, LinkService } from './os/linkService';
import { resolveClaudeBinary } from './os/claudeBinaryResolver';
import { scrubAgentEnv } from './os/agentEnv';
import { OpenWithService } from './os/openWithService';
import { buildJumpListCategories, parseJumpListArgs } from './os/jumpList';
import { UsageService } from './usage/usageService';
import { StatusService } from './status/statusService';
import { claudeUserAgent } from './os/claudeVersion';
import { LogBus } from './debug/logBus';
import { DebugWindowController } from './debug/debugWindow';
import { TranscriptService } from './transcripts/transcriptService';
import { resolveSubagentTranscriptPath, resolveTranscriptPath } from './transcripts/transcriptPath';
import { MemoryService, resolveMemoryDir } from './memory/memoryService';
import { WorkspaceStore } from './state/workspaceStore';
import { CommandCatalogStore } from './state/commandCatalogStore';
import { openArtifactWindow } from './artifacts/artifactWindow';
import { InstructionsService } from './instructions/instructionsService';
import { EffectiveSettingsService } from './config/effectiveSettingsService';
import { ConversationIndexStore } from './state/conversationIndexStore';
import { ProjectFileService, resolveProjectFilePath } from './files/projectFileService';
import { writeAtomic, type AtomicWriteDeps } from './os/atomicFile';
import { SettingsStore } from './state/settingsStore';
import { expiredScratchDirs, SWEEP_INTERVAL_MS } from './state/scratchRetention';
import { ThinkingBuffer, ThinkingStore } from './state/thinkingStore';
import { isTrusted, readCliTrustedFolders } from './os/workspaceTrust';
import { findGitBinary } from './os/gitBinaryResolver';
import { execCapturingStdout } from './os/execCapture';
import { createGitService, findRepoRootWith, type GitService } from './git/gitService';
import type { GitParams, GitSnapshot, GitSwitchParams } from '@shared/git';
import { PanelLayoutStore } from './state/panelLayoutStore';
import { PromptService } from './prompt/promptService';
import { WidgetWindowController } from './widget/widgetWindow';
import type { WidgetSnapshot } from '@shared/widget';
import { ThemeMarketService } from './theme/themeMarketService';
import type { FetchThemeParams } from '@shared/themeMarket';
import { startAutoUpdate } from './update/autoUpdate';
import { pathEquals } from './os/pathUtils';
import { isWindowId, MAIN_WINDOW_ID, WindowManager, type WindowPlacement } from './windows/windowManager';
import { resolveDropTarget } from './windows/dropTarget';
import { PERSISTED_TAB_SCHEMA } from '@shared/stateSchema';
import type { PersistedTab } from '@shared/state';
import type { DropTabOutcome } from '@shared/ipc';
import { CLOSE_DIALOG_BUTTONS, CLOSE_DIALOG_CANCEL_INDEX, interpretCloseDialog, resolveCloseAction } from './windows/closePolicy';
import type { CloseBehavior } from '@shared/settings';
import { fitSavedBounds, WindowBoundsStore, type SavedWindowBounds } from './windows/windowBounds';
import { NotificationCenter } from './notifications/notificationCenter';

// __dirname no existe en modulos ESM: lo derivamos de import.meta.url.
const currentDir = dirname(fileURLToPath(import.meta.url));

// Cada cuanto puede refrescarse la jump list como mucho (P1). El disparador es el foco de ventana, y
// un alt-tab seguido la llamaria varias veces por segundo sobre un escaneo de disco de cientos de ms.
// Un minuto es de sobra: lo que muestra son conversaciones recientes, no algo que cambie por segundo.
// ¿La ruta cuelga del home del usuario? Se compara segmento a segmento con `pathEquals`, que en
// win32 ignora mayusculas y en POSIX no (donde SI son directorios distintos).
function isInsideHome(resolved: string): boolean {
  const home = homedir();
  return resolved.length > home.length + 1 && pathEquals(resolved.slice(0, home.length), home) && resolved[home.length] === sep;
}

const JUMP_LIST_MIN_INTERVAL_MS = 60_000;

// Cada cuanto se vuelve a sondear si `agy` esta instalado (P12).
const AGY_PROBE_TTL_MS = 60_000;

// Entorno de desarrollo (no empaquetado): habilita la ventana de debug y una CSP relajada para HMR.
const isDev = !app.isPackaged;
const preloadPath = join(currentDir, '../preload/index.mjs');
const rendererDir = join(currentDir, '../renderer');

// Dimensiones iniciales de la ventana (sin magic numbers dispersos).
const WINDOW = { width: 1200, height: 800, minWidth: 900, minHeight: 600 } as const;

// Ventanas del workbench (peticion del usuario: la app en dos pantallas). UNA instancia, N ventanas:
// todo lo que vive en main —ajustes, temas, permisos, carpetas de confianza, cuentas, sesiones— es el
// mismo objeto para todas, asi que no puede haber discrepancia de configuracion. Lo que cambia por
// ventana es el workspace del renderer (pestañas, paneles, cuenta activa y conversaciones abiertas).
// La configuracion de la ventana (webPreferences incluidas) vive SOLO en `createWorkbenchWindow`.
const windowManager = new WindowManager<BrowserWindow, PersistedTab>({
  createWindow: (windowId, placement) => createWorkbenchWindow(windowId, placement),
  discardState: (windowId) => discardWindowState(windowId),
});

// La app esta saliendo (`before-quit`). Lo lee el `close` de cada ventana para no interponer el dialogo
// de cierre en una salida ya decidida: «Salir» de la bandeja, Cmd+Q y, sobre todo, `quitAndInstall`
// del autoupdater, que se quedaria sin instalar si una ventana cancelara la salida.
let isQuitting = false;
// Un solo dialogo de cierre a la vez (dos clics seguidos en la X no abren dos).
let closePromptOpen = false;

// La ventana principal SOLO si sigue viva. Su X puede ocultarla (segundo plano) o destruirla (ver
// `onWorkbenchClose`) y Mage sigue en el tray. Quien quiera ENSEÑARLA usa `focusMainWindow()`, que ademas
// la recrea; esto es para los que solo la usan si esta.
function liveMainWindow(): BrowserWindow | null {
  return windowManager.get(MAIN_WINDOW_ID);
}

// Ventana que origino un mensaje IPC. Es como main sabe QUIEN habla (para servirle SU workspace o
// para excluirla de una difusion) sin fiarse de un id que mande el renderer.
function senderWindowId(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent): string {
  return windowManager.windowIdOf(event.sender.id) ?? MAIN_WINDOW_ID;
}
// Notificaciones del SO con clic que lleva a la conversacion (P-028 40).
const notificationCenter = new NotificationCenter({
  isSupported: () => Notification.isSupported(),
  create: (options) => new Notification(options),
  isWindowFocused: (windowId) => windowManager.get(windowId)?.isFocused() === true,
  focusWindow: (windowId) => {
    if (windowManager.focus(windowId)) return windowId;
    focusMainWindow();
    return MAIN_WINDOW_ID;
  },
  sendClicked: (windowId, target) => windowManager.get(windowId)?.webContents.send(NOTIFICATION_CLICKED_CHANNEL, target),
});

// AppUserModelID de Windows: sin el, las notificaciones salen como «electron.app.Mage» y el Centro de
// actividades no las asocia a la app. Es el `appId` de electron-builder.yml (el acceso directo del
// instalador lo lleva). En desarrollo no hay acceso directo con ese id: se usa el del ejecutable, que es
// lo que Electron recomienda para que se vean.
const WINDOWS_APP_USER_MODEL_ID = 'com.m4raa.mage';

let tray: Tray | null = null;
// Controlador del widget flotante (M3): lazy (necesita app.whenReady para userData/preload).
let widgetWindow: WidgetWindowController | null = null;

// Tope de una peticion PUNTUAL al CLI (mejora de prompt / handoff). No es una sesion: si tarda mas
// que esto, algo va mal y se termina el arbol de procesos.
const PROMPT_RUN_TIMEOUT_MS = 60_000;
const killTreeDeps = defaultKillTreeDeps();

// Bus central de logs (dev): unico punto por el que pasan main + motor + renderer, con redaccion
// de credenciales antes de emitir. La ventana de debug se suscribe a el.
const logBus = new LogBus();
const mainLog = logBus.loggerFor('main');
let debugWindow: DebugWindowController | null = null;

// Config comun de Mage (D1 Fase 1): dos ficheros propiedad de Mage, FUERA de cualquier
// CLAUDE_CONFIG_DIR (ver PLAN-D1-CONFIGURACION.md). Lazy: app.getPath('userData') solo esta
// disponible tras app.whenReady, igual que SettingsStore/WorkspaceStore (mas abajo).
const SHARED_CONFIG_DIR_NAME = 'shared-config';
const MCP_COMMON_FILE = 'mcp-common.json';
const SETTINGS_COMMON_FILE = 'settings-common.json';

let sharedConfigServiceSingleton: SharedConfigService | null = null;
function getSharedConfigService(): SharedConfigService {
  if (sharedConfigServiceSingleton === null) {
    sharedConfigServiceSingleton = new SharedConfigService(defaultSharedConfigDeps((level, message) => mainLog(level, message)));
  }
  return sharedConfigServiceSingleton;
}

// Rutas fijas de los dos ficheros (lazy: dependen de app.getPath('userData'), tras whenReady).
function mcpCommonPath(): string {
  return join(app.getPath('userData'), SHARED_CONFIG_DIR_NAME, MCP_COMMON_FILE);
}
function settingsCommonPath(): string {
  return join(app.getPath('userData'), SHARED_CONFIG_DIR_NAME, SETTINGS_COMMON_FILE);
}

// Importacion inicial de mcp-common.json (P-026 2.5, D10): Mage pasa a ser la fuente de verdad de los
// MCP compartidos. Solo si el fichero no existe: se crea con `~/.claude/mcp-shared.json` (el que
// regeneraba el script del usuario) + los MCP de ambito usuario del `.claude.json` de cada cuenta. Las
// notas (colisiones de nombre) se enseñan en Ajustes -> MCP y conectores en esta ejecucion.
const LEGACY_SHARED_MCP_FILE = 'mcp-shared.json';
let mcpImportNotes: readonly string[] = [];

function importSharedMcpOnce(): void {
  const readIfExists = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);
  const { mainDirName, stateFileName } = cliLogin.accounts;
  try {
    const accounts = accountService.listAccounts().map((account) => ({
      label: account.name,
      // La principal guarda su estado en HOME, no dentro de `~/.claude` (mismo criterio que AccountService).
      text: readIfExists(account.isMain ? join(homedir(), stateFileName) : join(account.configDir, stateFileName)),
    }));
    const shared = { label: LEGACY_SHARED_MCP_FILE, text: readIfExists(join(homedir(), mainDirName, LEGACY_SHARED_MCP_FILE)) };
    const notes = getSharedConfigService().importMcpCommonIfMissing(mcpCommonPath(), shared, accounts);
    if (notes === null) return;
    mcpImportNotes = notes;
    mainLog('info', 'mcp-common.json creado con la importacion inicial', { colisiones: notes.length });
  } catch (err) {
    // No tumba el arranque: sin importacion, Mage sigue como antes (sin MCP comunes).
    mainLog('warn', `No se pudo importar mcp-common.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Fuentes FALSAS para `verify:gui` (P-028): con MAGE_MCP_FAKE_SOURCES=<dir>, el inventario lee el
// `.claude.json` de cada cuenta como `<dir>/<nombre de la cuenta>.json`, Claude Desktop como `<dir>/Claude`
// y el legado como `<dir>/mcp-shared.json`. Nunca se lee lo real de la maquina en una verificacion.
function mcpFakeSourcesPath(name: string): string | null {
  const dir = process.env.MAGE_MCP_FAKE_SOURCES;
  return dir === undefined || dir.length === 0 ? null : join(dir, name);
}

// `.claude.json` de cada cuenta de Claude (la principal lo guarda en HOME, como en importSharedMcpOnce).
function mcpAccountLocations(): readonly McpAccountLocation[] {
  const { stateFileName } = cliLogin.accounts;
  return accountService.listAccounts().map((account) => ({
    configDir: account.configDir,
    label: account.name.replace(/^\./, ''),
    stateFile:
      mcpFakeSourcesPath(`${account.name}.json`) ?? (account.isMain ? join(homedir(), stateFileName) : join(account.configDir, stateFileName)),
  }));
}

// Sondeo de estado de MCP (mcp_status, sin turno): como el de modelos, pero CON la config comun, que es
// lo que carga una sesion real de Mage. Plazo holgado: los MCP tardan en pasar de `pending`.
const MCP_STATUS_TIMEOUT_MS = 20_000;
const MCP_STATUS_POLL_MS = 1_000;
// «Autenticar» (punto 18): el CLI tiene que seguir vivo hasta que el usuario acabe en el navegador.
const MCP_AUTH_TIMEOUT_MS = 5 * 60_000;
const MCP_AUTH_POLL_MS = 2_000;
// verify:gui: CLI falso en proceso (config/mcpFakeCli.ts). Nunca se spawnea nada ni se abre el navegador.
const MCP_FAKE_CLI = process.env.MAGE_MCP_FAKE_CLI === '1';

// Mismo proceso que el sondeo de modelos, pero con --mcp-config/--settings: es lo que carga una sesion.
function spawnMcpStatusProbe(configDir: string): ProbeProcess {
  if (MCP_FAKE_CLI) return spawnFakeMcpCli(configDir);
  return spawnModelProbe(configDir, loadSharedConfigArgs());
}

// La URL de autorizacion va al navegador del sistema por OpenWithService (solo https, multiplataforma).
function openMcpAuthUrl(url: string): Promise<void> {
  if (MCP_FAKE_CLI) {
    mainLog('info', 'MCP falso: no se abre el navegador', { esLaFalsa: url === FAKE_AUTH_URL });
    return Promise.resolve();
  }
  return openWithService.openExternal(url);
}

// Se re-lee en CADA lanzamiento (nunca se cachea el resultado): son ficheros que el usuario puede
// editar entre una sesion y la siguiente (editor propio en Configuracion, D1 Fase 2).
function loadSharedConfigArgs(): readonly string[] {
  const service = getSharedConfigService();
  const mcpCommon = service.loadMcpCommon(mcpCommonPath());
  const settingsCommon = service.loadSettingsCommon(settingsCommonPath());
  return resolveSharedConfigArgs(mcpCommon, settingsCommon);
}

// Gestor de sesiones del motor. adapterFactory: hay dos motores NATIVOS (Claude y `agy`, E3, cada uno
// con su propio CLI y su propia suscripcion); cualquier otro proveedor —de serie o anadido por el
// usuario (E2)— va por el mismo GatewayAdapter parametrizado, que solo necesita el id (el gateway
// resuelve su endpoint). defaults resuelve cuenta/cwd por defecto contra el FS real; el logger del
// motor va al LogBus.
const sessionManager = new SessionManager(
  (provider) => buildAdapter(provider),
  {
    homedir: homedir(),
    fileExists: existsSync,
    listHome: () => readdirSync(homedir()),
    resolveSharedConfigArgs: loadSharedConfigArgs,
  },
  logBus.loggerFor('engine'),
);

// Adapter de un proveedor. Guard clauses, un caso por motor nativo; el resto, gateway.
// Layout de cuentas de un proveedor. Solo lo tiene quien autentica por CLI con config dir propio;
// pedirselo a un proveedor por api-key o externo es un error de programacion, no un caso a tragar.
function accountLayoutOf(adapter: ProviderAdapter): AccountLayout {
  if (adapter.auth.kind !== 'cli-oauth') {
    throw new Error(`El proveedor no gestiona cuentas por config dir (auth: ${adapter.auth.kind})`);
  }
  return adapter.auth.login.accounts;
}

function buildAdapter(provider: string): ProviderAdapter {
  if (provider === 'claude') return new ClaudeAdapter();
  if (provider === AGY_PROVIDER_ID) return new AgyAdapter();
  return new GatewayAdapter(provider);
}

// Servicio "abrir con": revelar en el gestor de archivos y guardar-como (copiar) los ficheros que
// generan las tools. Toda la especificidad de SO/electron queda inyectada aqui (DI, testable).
const openWithService = new OpenWithService({
  reveal: (path) => shell.showItemInFolder(path),
  showSaveDialog: async (defaultName) => {
    const options = { defaultPath: defaultName };
    const parent = liveMainWindow();
    const result = parent !== null ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  },
  copyFile: (src, dest) => copyFileSync(src, dest),
  fileExists: existsSync,
  openPath: (path) => shell.openPath(path),
  openExternal: (url) => shell.openExternal(url),
  platform: process.platform,
  // Solo se leen de aqui las rutas de instalacion de navegadores (ventana privada del alta, 9.2).
  env: process.env,
  // detached + unref: la terminal sobrevive a Mage; stdio ignorado. `cwd` fija el directorio inicial.
  spawnDetached: (command, args, cwd) => {
    const child = spawn(command, [...args], { detached: true, stdio: 'ignore', cwd });
    child.unref();
  },
  // Detecta si un comando existe en el PATH con where (Windows) / which (POSIX). Sincrona y rapida;
  // solo se consulta al listar editores (accion puntual del usuario, no en caliente).
  isCommandAvailable: (bin) => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(finder, [bin], { stdio: 'ignore', windowsHide: true, timeout: 5_000 });
    return result.status === 0;
  },
});

// Servicios de cuentas: LinkService (enlaces por SO), AccountService (descubre/crea cuentas en disco;
// solo expone datos seguros). DI con FS real y reloj del sistema. readJson tolera fichero ausente/JSON
// invalido (frontera segura).
// El log va al LogBus: una carpeta compartida que dejo de estar enlazada (p.ej. porque una sesion
// del CLI la recreo como dir real) tiene que ser VISIBLE, no un no-op silencioso.
const linkService = new LinkService(defaultLinkDeps(mainLog));
const accountService = new AccountService({
  // El layout de cuentas ya no vive dentro de AccountService: lo declara el ProviderAdapter (9.1).
  // Hoy el unico proveedor con multicuenta gestionada por Mage es Claude; cuando otro la tenga,
  // aqui se elegira el suyo y AccountService no cambia una linea.
  layout: accountLayoutOf(new ClaudeAdapter()),
  homedir: homedir(),
  listHome: () => readdirSync(homedir()),
  listDir: (path) => (existsSync(path) ? readdirSync(path) : []),
  isDirectory: (path) => tryIsDirectory(path),
  exists: existsSync,
  readJson: (path) => tryReadJson(path),
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  // Escritura PLANA a proposito (NO writeFileAtomic): trunca in situ y preserva los hard links del
  // settings.json compartido entre instalaciones. Ver la invariante en AccountService.seedSettings.
  writeFile: (path, content) => writeFileSync(path, content),
  rmrf: (path) => rmSync(path, { recursive: true, force: true }),
  // Convergencia de credenciales cuenta <-> perfil privado (grupo G). Antes esto era un hard link,
  // sobre la premisa de que el CLI reescribe el fichero in-place sobre el mismo inode: se comprobo en
  // disco que es FALSO (tmp+rename -> inode nuevo -> el enlace muere en silencio y los dos lados
  // divergen). Ahora se COPIA el lado con el token vigente; ver credentialsConvergence.ts.
  copyCredentialsFile: (from, to) => copyCredentialsFile(from, to),
  now: () => Date.now(),
  linkService,
  log: mainLog,
});
// Historial de conversaciones en disco (M2.6). Lee prefijos de los .jsonl bajo projects/ (comun) y
// mage-private/projects/ (privado) de la cuenta. Solo FS de lectura.
const conversationsService = new ConversationsService({
  exists: existsSync,
  listDir: (path) => readdirSync(path),
  isDirectory: (path) => tryIsDirectory(path),
  statFile: (path: string) => {
    const stat = statSync(path);
    return { mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
  },
  readPrefix: (path, maxBytes) => readFilePrefix(path, maxBytes),
  readSuffix: (path, maxBytes) => readFileSuffix(path, maxBytes),
});

// FS del fichero de credenciales, compartido por los DOS escritores del token: el login y la
// renovacion de sesion. 0600 en el tmp ANTES del rename (no tras publicar el fichero final): cierra la
// ventana TOCTOU en la que el token OAuth quedaba mundo-legible en POSIX entre el write y el chmod600.
const credentialsDeps = {
  readJson: (path: string) => tryReadJson(path),
  writeFileAtomic: (path: string, content: string) => writeFileAtomic(path, content, 0o600),
  chmod600,
  exists: existsSync,
};

// Login OAuth EMBEBIDO (M3, Decision 9): ventana propia dentro de Mage + captura del callback en un
// servidor local; TODA la red (exchange/profile/roles) ocurre aqui en main. DI con FS/red/crypto
// reales. SEGURIDAD: es el UNICO writer del token en disco (.credentials.json 0600 + oauthAccount de
// .claude.json), replicando el formato del CLI; nunca loguea/emite el token (el resultado es SAFE).
// Login por el CLI (Fase 9.2): Mage spawnea `claude auth login`, abre su URL en ventana privada y
// relaya el *code*. **Mage ya no toca el token**: lo escribe el CLI, que es lo que exige la pagina
// legal de Anthropic (su puerto seguro esta redactado alrededor del binario sin modificar).
//
// El subcomando y la variable de config dir NO estan cableados aqui: los declara el adapter del
// proveedor en su `AuthModel` (9.1), y estan MEDIDOS contra el binario real.
// Ruta que no existe en ningun SO. `BROWSER` apuntando aqui SUPRIME que el CLI abra el navegador
// (medido el 2026-09-11 y re-medido el 2026-09-14), que es lo que deja a Mage abrir la URL en
// ventana PRIVADA en su lugar.
const NO_BROWSER_PATH =
  process.platform === 'win32' ? 'C:\\mage-no-browser\\nope.exe' : '/nonexistent/mage-no-browser';
const claudeAuth = new ClaudeAdapter().auth;
const cliLogin =
  claudeAuth.kind === 'cli-oauth'
    ? claudeAuth.login
    : (() => {
        throw new Error(`El proveedor de cuentas no autentica por CLI (auth: ${claudeAuth.kind})`);
      })();
// Config dir del login en curso: al confirmarse, se sondean los modelos de esa cuenta (P-026 2.4).
let loginConfigDir: string | null = null;
const cliLoginService = new CliLoginService({
  log: (level, message) => mainLog(level, message),
  spawnLogin: (configDir, email) => spawnCliLogin(configDir, email),
  readAuthStatus: (configDir) => readCliAuthStatus(configDir),
  openPrivate: (url) => openWithService.openPrivate(url),
  validateConfigDir: (configDir) => isManagedAccountConfigDir(configDir),
});

// Entorno del CLI de login: el config dir de la cuenta y NADA de credenciales heredadas. Se usa el
// mismo saneo que para un agente (`scrubAgentEnv`), porque el riesgo es el mismo: un
// `ANTHROPIC_AUTH_TOKEN` o un `ANTHROPIC_BASE_URL` del entorno desactivarian el OAuth o
// redirigirian el Bearer a otro sitio.
//
// `BROWSER` apunta a una ruta inexistente A PROPOSITO (medido el 2026-09-11 y el 2026-09-14): eso
// SUPRIME la apertura del navegador por parte del CLI y deja que Mage abra la URL en ventana
// PRIVADA. Sin esto el CLI abriria el navegador por defecto, donde una sesion ya iniciada daria de
// alta la cuenta equivocada.
function cliLoginEnv(configDir: string): NodeJS.ProcessEnv {
  return {
    ...scrubAgentEnv(process.env),
    [cliLogin.accounts.configDirEnvVar]: configDir,
    BROWSER: NO_BROWSER_PATH,
  };
}

function spawnCliLogin(configDir: string, email: string | null): CliLoginProcess {
  const args = [...cliLogin.loginArgs, ...(email === null ? [] : ['--email', email])];
  const child = spawn(resolveClaudeBinary(), args, {
    env: cliLoginEnv(configDir),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  return {
    // La URL puede salir por cualquiera de los dos: se escuchan ambos.
    onOutput: (listener: (chunk: string) => void) => {
      child.stdout.on('data', listener);
      child.stderr.on('data', listener);
    },
    onExit: (listener: (code: number | null) => void) => {
      child.on('exit', listener);
    },
    writeLine: (text: string) => {
      child.stdin.write(`${text}\n`);
    },
    kill: () => child.kill(),
  };
}

// `auth status --json` contra un config dir concreto. MEDIDO: responde sin TTY y trae
// {loggedIn, email, orgName}. Nunca lanza hacia fuera: una salida vacia ya significa "no se sabe",
// y el servicio la trata como fallo explicito.
function readCliAuthStatus(configDir: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(resolveClaudeBinary(), ['auth', 'status', '--json'], {
      env: cliLoginEnv(configDir),
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (output += chunk));
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(output));
  });
}

// Renovacion de sesion para el panel de Uso. Quien renueva normalmente es el CLI al correr un turno;
// esto cubre la cuenta inactiva, que es justo la que quieres consultar y la unica que da 401.
const tokenRefreshService = new TokenRefreshService({
  fetch,
  readOauthBlock: (configDir) => readOauthBlock(configDir),
  writeOauthBlock: (configDir, oauth) => writeCredentials(configDir, oauth, credentialsDeps),
  now: () => Date.now(),
  log: (level, message) => mainLog(level, message),
});

// Servicios de uso/estado (M1.3). SEGURIDAD: UsageService es el UNICO que lee el token OAuth, y solo
// para el header Authorization del endpoint de uso; nunca lo loguea/emite. readAccessToken se llama en
// cada miss de cache (el CLI puede refrescar el fichero). El User-Agent lleva la version del CLI
// (imprescindible o el endpoint devuelve 429); se resuelve una vez y cachea. fetch es el global de
// Node 22 (toda la red va en main: la CSP del renderer es connect-src 'self').
const usageService = new UsageService({
  fetch,
  readAccessToken: (configDir) => readAccessToken(configDir),
  now: () => Date.now(),
    // Getter, no valor: `claudeUserAgent()` hace un `execFileSync` del binario para leer su version
    // (27-39 ms medidos) y se evaluaba al CONSTRUIR el servicio, o sea antes de `whenReady`. Con el
    // getter se paga en la primera consulta de uso, y la propia funcion ya cachea.
    get userAgent() {
      return claudeUserAgent();
    },
  // Un 401 (sesion caducada) no falla: se intenta renovar una vez y, si no cuaja, se sirve el ultimo
  // uso conocido. Sin traza, esa degradacion seria invisible — y es justo la que explica por que el
  // panel no se actualiza.
  log: (level, message) => mainLog(level, message),
  refreshSession: (configDir) => tokenRefreshService.refresh(configDir),
});
const statusService = new StatusService({ fetch, now: () => Date.now() });

// Mercado de temas Open VSX (M3): busca/trae temas de color de VS Code. Solo lee datos de tema
// (colores); nunca ejecuta codigo de la extension. La red va en main (CSP del renderer 'self').
const themeMarketService = new ThemeMarketService({ fetch });

// Servicio de transcripciones (M2.2.1): lee ~/.claude*/projects/**/*.jsonl en streaming. No
// conoce IPC ni cancelacion por transcriptId: eso lo orquesta registerIpcHandlers con un
// AbortController por lectura en curso (openTranscriptControllers).
const transcriptService = new TranscriptService({
  exists: existsSync,
  sizeOf: (path) => (existsSync(path) ? statSync(path).size : -1),
  createReadStream: (path, start) => createReadStream(path, { encoding: 'utf8', ...(start === undefined ? {} : { start }) }),
});
// Un AbortController por transcriptId en curso; se limpia solo al terminar o al cancelar.
const openTranscriptControllers = new Map<string, AbortController>();

// Servicio de memoria (M2.2.4): lee los .md de <cuenta>/projects/<cwd-encoded>/memory/. Solo FS; el
// parseo (frontmatter/wikilinks) vive en el renderer (memoryView.ts).
const memoryService = new MemoryService({
  exists: existsSync,
  readdir: (dir) => readdirSync(dir),
  readFile: (path) => readFileSync(path, 'utf8'),
});
// Nombres de dir de config de Claude bajo HOME: .claude, .claude-<algo>, .claude<digitos> (mismo
// patron que accountService.CONFIG_DIR_PATTERN; duplicado aqui a proposito: es el whitelisting de
// IPC, una frontera de seguridad distinta de la logica de cuentas).
const ACCOUNT_DIR_PATTERN = /^\.claude(-.*|\d*)$/;

// Nombre del dir de perfil privado (M2.6); mismo valor que AccountService.PRIVATE_PROFILE_DIR,
// duplicado aqui a proposito (frontera de seguridad IPC, no logica de cuentas).
const PRIVATE_PROFILE_SEGMENT = 'mage-private';

// Verifica que una ruta (transcripcion o carpeta de memoria) cae bajo <cuenta>/projects/ (compartido)
// o <cuenta>/mage-private/projects/ (perfil privado, M2.6) de alguna cuenta gestionada bajo HOME
// (nunca una ruta arbitraria via IPC). No exige que exista (eso lo validan los servicios al leer).
function isUnderManagedProjects(targetPath: string): boolean {
  const resolved = resolve(targetPath);
  // Comparacion por `pathEquals` y no por `startsWith` crudo (B13f): en Windows las rutas no
  // distinguen mayusculas, asi que una ruta con la unidad en minusculas se rechazaba con
  // `bad_request_invalid_config_dir`. `pathEquals` ya resuelve eso, y solo en win32.
  if (!isInsideHome(resolved)) return false;
  const segments = resolved.slice(homedir().length).split(sep).filter(Boolean);
  if (segments.length < 2 || !ACCOUNT_DIR_PATTERN.test(segments[0] ?? '')) return false;
  if (segments[1] === 'projects') return true;
  return segments[1] === PRIVATE_PROFILE_SEGMENT && segments[2] === 'projects';
}

// Verifica que una ruta cae bajo <cuenta>/plans/ (o <cuenta>/mage-private/plans/) de alguna cuenta
// gestionada bajo HOME. Es donde el CLI escribe los PLANES del modo plan, que no viven bajo el cwd de
// ninguna conversacion: sin esta raiz, el panel de Ficheros listaba el plan y luego se negaba a abrirlo
// ("el fichero está fuera de la carpeta de la conversación" — reporte del usuario).
//
// SOLO `plans`, nunca el config dir entero: ahi tambien vive `.credentials.json`, y abrir un canal de
// lectura de fichero arbitrario sobre el directorio de la cuenta seria regalar las credenciales.
function isUnderManagedPlans(targetPath: string): boolean {
  const rest = segmentsInsideManagedConfigDir(targetPath);
  return rest !== null && rest[0] === 'plans' && rest.length >= 2;
}

// Tercera raiz (P-028, 15): la MEMORIA del CLI, `<cuenta>/projects/<slug>/memory/…` (y la del perfil
// privado). Un tercio de los ficheros que el panel no abria eran estos `.md`. Anclada por estructura
// como `plans`: solo el subdirectorio `memory` de un proyecto, nunca `projects` entero (ahi viven las
// transcripciones de todas las conversaciones).
function isUnderManagedMemory(targetPath: string): boolean {
  const rest = segmentsInsideManagedConfigDir(targetPath);
  return rest !== null && rest[0] === 'projects' && rest[2] === 'memory' && rest.length >= 4;
}

// Segmentos de la ruta DENTRO del config dir de una cuenta gestionada (saltando `mage-private` si
// esta), o null si no cuelga de ninguna. Es la base comun de las raices ancladas por estructura.
function segmentsInsideManagedConfigDir(targetPath: string): readonly string[] | null {
  const resolved = resolve(targetPath);
  if (!isInsideHome(resolved)) return null;
  const segments = resolved.slice(homedir().length).split(sep).filter(Boolean);
  if (!ACCOUNT_DIR_PATTERN.test(segments[0] ?? '')) return null;
  return segments[1] === PRIVATE_PROFILE_SEGMENT ? segments.slice(2) : segments.slice(1);
}

// Ficheros de fuera del cwd que el usuario aprobo abrir EN ESTA EJECUCION (P-028, 15). En memoria a
// proposito: la aprobacion es por fichero y por ejecucion. Clave canonica (8.3 resuelto y, en win32,
// sin mayusculas), la misma que se consulta al leer.
const approvedOutsidePaths = new Set<string>();

// Nombres que nunca se aprueban, se pregunte lo que se pregunte: son las credenciales y el estado
// (`oauthAccount`, `userID`) de una cuenta del CLI. Un clic de mas en el dialogo no puede sacarlos.
const NEVER_APPROVED_FILE_NAMES: ReadonlySet<string> = new Set(['.credentials.json', '.claude.json']);

function approvalKey(targetPath: string): string {
  const canonical = canonicalPath(targetPath);
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function isApprovedOutside(targetPath: string): boolean {
  return approvedOutsidePaths.has(approvalKey(targetPath));
}

// Pregunta con un dialogo nativo si abrir un fichero de fuera de la carpeta de la conversacion. La
// ruta que se ENSEÑA y la que se APRUEBA es la que resuelve main, nunca un texto del renderer.
async function approveOutsideFile(event: Electron.IpcMainInvokeEvent, params: ReadProjectFileParams): Promise<boolean> {
  if (params.cwd.trim().length === 0 || params.path.trim().length === 0) {
    throw new Error(`Carpeta o ruta vacia al aprobar un fichero: ${JSON.stringify(params)}`);
  }
  const path = resolveProjectFilePath(params);
  if (NEVER_APPROVED_FILE_NAMES.has(basename(path).toLowerCase())) {
    throw new Error(`Mage no abre ficheros de credenciales del CLI: ${path}`);
  }
  if (isApprovedOutside(path)) return true;
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    message: 'Este fichero está fuera de la carpeta de la conversación',
    detail: `${path}\n\nSi lo abres, podrás leerlo y editarlo desde Mage hasta que cierres la aplicación.`,
    buttons: ['Abrir', 'Cancelar'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const parent = BrowserWindow.fromWebContents(event.sender);
  const { response } = parent === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(parent, options);
  if (response !== 0) return false;
  approvedOutsidePaths.add(approvalKey(path));
  return true;
}

// Lleva una ruta a su forma CANONICA del sistema de ficheros. En Windows la misma carpeta se escribe
// de dos maneras —`C:\Users\USUARIO\…` (8.3) y `C:\Users\usuario\…`— segun quien la imprima, y el
// CLI reporta una mientras Electron da la otra: compararlas en crudo da un "fuera del sitio" que no lo
// es. `realpathSync.native` resuelve el 8.3, pero EXIGE QUE LA RUTA EXISTA, y aqui llegan tambien
// ficheros que aun no existen (un guardado nuevo), asi que se canonicaliza el ancestro mas profundo que
// SI exista y se le vuelve a pegar el resto. El bucle esta acotado por la profundidad de la ruta.
function canonicalPath(target: string): string {
  const resolved = resolve(target);
  const tail: string[] = [];
  let current = resolved;
  for (;;) {
    try {
      return join(realpathSync.native(current), ...tail);
    } catch {
      // No existe todavia: se sube un nivel y se reintenta con el padre.
    }
    const parent = dirname(current);
    // Raiz alcanzada sin encontrar nada que exista: se devuelve lo resuelto, que es lo mejor que hay.
    if (parent === current) return resolved;
    tail.unshift(basename(current));
    current = parent;
  }
}

// Segunda raiz permitida fuera del cwd, junto a los planes: el SCRATCHPAD del CLI (reporte del usuario
// del 2026-09-21). La decision de que forma vale vive en `files/cliScratchpad.ts`, que es puro y tiene
// sus pruebas; aqui solo se aporta el temp real y la canonicalizacion.
function isUnderCliScratchpad(targetPath: string): boolean {
  return isUnderCliScratchpadPure(canonicalPath(app.getPath('temp')), canonicalPath(targetPath));
}

// Verifica que una ruta es un dir de cuenta gestionado (directamente bajo HOME, patron .claude*),
// para el listado de conversaciones (M2.6). Frontera IPC: nunca listar una ruta arbitraria.
function isManagedAccountConfigDir(dir: string): boolean {
  const resolved = resolve(dir);
  // Comparacion por `pathEquals` y no por `startsWith` crudo (B13f): en Windows las rutas no
  // distinguen mayusculas, asi que una ruta con la unidad en minusculas se rechazaba con
  // `bad_request_invalid_config_dir`. `pathEquals` ya resuelve eso, y solo en win32.
  if (!isInsideHome(resolved)) return false;
  const segments = resolved.slice(homedir().length).split(sep).filter(Boolean);
  return segments.length === 1 && ACCOUNT_DIR_PATTERN.test(segments[0] ?? '');
}

// Lee solo los primeros `maxBytes` de un fichero (para derivar cwd/titulo de una transcripcion sin
// cargar 9MB). fd + read acotado; cierra siempre.
function readFilePrefix(path: string, maxBytes: number): string {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

// Los ultimos `maxBytes` de un fichero (o el fichero entero si es mas pequeño). La primera linea suele
// venir partida: el parser de metadatos la ignora por ser JSON invalido.
function readFileSuffix(path: string, maxBytes: number): string {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    const bytesRead = readSync(fd, buffer, 0, length, size - length);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

// Lee y parsea un JSON del FS; devuelve null si no existe o es invalido (la validacion de forma la
// hace AccountService con guardas de campo). No lanza: es la lectura tolerante de config local.
function tryReadJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// Lee <configDir>/.credentials.json -> claudeAiOauth.accessToken. Se relee en cada consulta de uso
// (el CLI refresca el fichero); el token NUNCA se cachea en memoria ni se loguea. Lanza Error (sin el
// token) si falta el fichero o el campo, para que el renderer muestre "sin login/credenciales".
// Bloque claudeAiOauth completo (incluido el refreshToken) para renovar la sesion. Solo lo consume
// TokenRefreshService, en main; nada de esto cruza el IPC.
function readOauthBlock(configDir: string): ReturnType<typeof parseStoredOauth> {
  return parseStoredOauth(tryReadJson(join(configDir, '.credentials.json')));
}

function readAccessToken(configDir: string): string {
  const credPath = join(configDir, '.credentials.json');
  const parsed = tryReadJson(credPath);
  const token =
    parsed !== null && typeof parsed === 'object'
      ? (parsed as { claudeAiOauth?: { accessToken?: unknown } }).claudeAiOauth?.accessToken
      : undefined;
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`Sin token OAuth valido en la cuenta (falta .credentials.json o login): ${configDir}`);
  }
  return token;
}

function tryIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// Escritura ATOMICA (tmp + rename): evita dejar un .credentials.json/.claude.json a medias si el
// proceso muere a mitad. El tmp lleva un sufijo unico para no colisionar entre escrituras concurrentes.
// `mode`, si se pasa, se aplica al tmp ANTES del rename (evita la ventana en que el fichero final
// existe con permisos por defecto, mundo-legible en POSIX; mismo patron que copyCredentialsFile).
function writeFileAtomic(path: string, content: string, mode?: number): void {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  if (mode !== undefined) chmodSync(tmp, mode);
  renameSync(tmp, path);
}

// Copia un .credentials.json de forma ATOMICA y con permisos restringidos: se escribe en un tmp de
// nombre unico, se le aplican los permisos ANTES de publicarlo y se renombra. Asi nunca queda un
// fichero de credenciales a medias (que dejaria la cuenta sin login) ni una ventana con permisos
// abiertos. Multiplataforma: copyFileSync/renameSync y chmod600 (no-op documentado en win32).
function copyCredentialsFile(from: string, to: string): void {
  if (from === to) throw new Error(`Copia de credenciales con origen y destino iguales: ${from}`);
  const tmp = `${to}.${randomUUID()}.tmp`;
  copyFileSync(from, tmp);
  chmod600(tmp);
  renameSync(tmp, to);
}

// Restringe permisos a 0600 (solo el usuario). En win32 es un no-op documentado: los permisos POSIX no
// aplican y el CLI se comporta igual (los ACL de Windows ya limitan el acceso al perfil del usuario).
function chmod600(path: string): void {
  if (process.platform === 'win32') return;
  chmodSync(path, 0o600);
}

// SettingsStore compartido (M3): lo usan el IPC de settings y createMainWindow (para el tema de
// arranque). Lazy: app.getPath('userData') solo esta disponible tras app.whenReady.
let settingsStoreSingleton: SettingsStore | null = null;
function getSettingsStore(): SettingsStore {
  if (settingsStoreSingleton === null) {
    settingsStoreSingleton = new SettingsStore({
      filePath: join(app.getPath('userData'), 'app-settings.json'),
      exists: existsSync,
      readFile: (path) => readFileSync(path, 'utf8'),
      writeFile: (path, data) => writeFileSync(path, data, 'utf8'),
      rename: renameSync,
      tempSuffix: () => randomUUID(),
      mtimeMs: (path) => statSync(path).mtimeMs,
    });
  }
  return settingsStoreSingleton;
}

// Cache del catalogo de comandos "/" (2.2) e indice propio por conversacion (2.1). Lazy por el mismo
// motivo que los otros dos: `app.getPath('userData')` solo vale tras `whenReady`.
let commandCatalogStoreSingleton: CommandCatalogStore | null = null;
function getCommandCatalogStore(): CommandCatalogStore {
  if (commandCatalogStoreSingleton === null) {
    commandCatalogStoreSingleton = new CommandCatalogStore({
      filePath: join(app.getPath('userData'), 'command-catalog.json'),
      ...fileSystemDeps(),
    });
  }
  return commandCatalogStoreSingleton;
}

// Pensamientos del agente (peticion del usuario: "es Mage quien deberia guardar lo que no guarda el
// CLI"). Un fichero por sesion bajo userData/thinking/: se escribe en cada turno y puede pesar, asi que
// no entra en `conversation-index.json`, que esta pensado para lo que se escribe poco.
// Git de la carpeta de cada conversacion (P-026 3.5). Perezoso: el binario se busca la primera vez que
// una pestaña lo pide, y la confianza es la MISMA que decide si arranca un agente.
const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER_BYTES = 8 * 1024 * 1024;
let gitServiceSingleton: GitService | null = null;
function getGitService(): GitService {
  gitServiceSingleton ??= createGitService({
    findBin: () => findGitBinary(),
    run: (bin, args, options) => execCapturingStdout(bin, args, { ...options, timeoutMs: GIT_TIMEOUT_MS, maxBufferBytes: GIT_MAX_BUFFER_BYTES }),
    isTrusted: isFolderTrusted,
    findRepoRoot: (cwd) => findRepoRootWith(cwd, existsSync),
    baseEnv: process.env,
    now: Date.now,
  });
  return gitServiceSingleton;
}

// Frontera de los canales de git: una ruta absoluta y una cuenta gestionada, como el resto de canales
// con ruta. La cuenta solo se usa para la confianza, pero sin validarla cualquiera podria señalar un
// config dir ajeno que «autoriza» la carpeta.
function assertGitParams(params: GitParams): void {
  if (typeof params?.cwd !== 'string' || !isAbsolute(params.cwd)) throw new Error(`Carpeta no valida para git: ${String(params?.cwd)}`);
  if (typeof params.accountDir !== 'string' || !isManagedAccountConfigDir(params.accountDir)) {
    throw new Error(`Cuenta no valida para git: ${String(params.accountDir)}`);
  }
}

function registerGitHandlers(): void {
  ipcMain.handle(IpcChannel.GitStatus, (_e, params: GitParams): Promise<GitSnapshot> => {
    assertGitParams(params);
    return getGitService().status(params.cwd, params.accountDir);
  });
  ipcMain.handle(IpcChannel.GitBranches, (_e, params: GitParams): Promise<readonly string[]> => {
    assertGitParams(params);
    return getGitService().branches(params.cwd, params.accountDir);
  });
  ipcMain.handle(IpcChannel.GitSwitch, (_e, params: GitSwitchParams): Promise<void> => {
    assertGitParams(params);
    if (typeof params.name !== 'string') throw new Error(`Rama no valida: ${String(params.name)}`);
    return getGitService().switchBranch(params.cwd, params.accountDir, params.name);
  });
}

let thinkingStoreSingleton: ThinkingStore | null = null;
function getThinkingStore(): ThinkingStore {
  if (thinkingStoreSingleton === null) {
    thinkingStoreSingleton = new ThinkingStore({
      dir: join(app.getPath('userData'), 'thinking'),
      join,
      exists: existsSync,
      mkdir: (path) => mkdirSync(path, { recursive: true }),
      appendFile: (path, data) => appendFileSync(path, data, 'utf8'),
      readFile: (path) => readFileSync(path, 'utf8'),
      removeFile: (path) => rmSync(path, { force: true }),
      // ATOMICA: la compactacion REESCRIBE el fichero entero, y un corte a mitad se llevaria todo el
      // pensamiento de esa conversacion. Aqui no hay hard links ajenos que preservar (es un fichero de
      // userData, solo de Mage), asi que el aviso de `atomicFile` sobre `rename` no aplica.
      writeFile: (path, data) => writeAtomic(fileSystemDeps(), path, data),
    });
  }
  return thinkingStoreSingleton;
}

let conversationIndexStoreSingleton: ConversationIndexStore | null = null;
function getConversationIndexStore(): ConversationIndexStore {
  if (conversationIndexStoreSingleton === null) {
    conversationIndexStoreSingleton = new ConversationIndexStore({
      filePath: join(app.getPath('userData'), 'conversation-index.json'),
      ...fileSystemDeps(),
    });
  }
  return conversationIndexStoreSingleton;
}

// Dependencias de FS que comparten todos los stores con escritura atomica.
function fileSystemDeps(): Omit<AtomicWriteDeps, never> {
  return {
    exists: existsSync,
    readFile: (path: string) => readFileSync(path, 'utf8'),
    writeFile: (path: string, data: string) => writeFileSync(path, data, 'utf8'),
    rename: renameSync,
    tempSuffix: () => randomUUID(),
  };
}

// Valida los adjuntos que llegan por IPC. Lanza con el motivo (el renderer lo pinta): un adjunto que se
// cae en silencio es peor que un error, porque el usuario cree que mando algo que no mando.
function validateAttachments(attachments: readonly ImageAttachment[] | undefined): readonly ImageAttachment[] {
  if (attachments === undefined || attachments.length === 0) return [];
  validateAttachmentSet(
    [],
    attachments.map((attachment) => ({ mediaType: attachment.mediaType, byteLength: base64ByteLength(attachment.data) })),
  );
  return attachments;
}

// Escribe la cache del catalogo de una cuenta. Best-effort: un fallo de disco aqui NO puede tumbar la
// sesion (es una cache que se regenera al siguiente turno), pero tampoco se traga en silencio.
// Ultimo catalogo escrito por cuenta, serializado. El catalogo se re-pide al final de CADA turno y
// casi nunca cambia (solo al instalar un plugin), pero se reescribia entero igual: 74 kB con read +
// parse + Zod + stringify + write + rename, todo SINCRONO, justo cuando el usuario espera el
// resultado del turno.
const lastCommandCatalogJson = new Map<string, string>();

// Buffer de pensamiento por sesion. A nivel de modulo y no en el store: es estado en vuelo de un turno
// (lo que aun no se ha cerrado), no algo que deba sobrevivir a un reinicio.
const thinkingBuffers = new Map<string, ThinkingBuffer>();

function captureThinking(sessionId: string, event: MageEvent): void {
  const buffer = thinkingBuffers.get(sessionId) ?? new ThinkingBuffer();
  thinkingBuffers.set(sessionId, buffer);
  const closed = buffer.accept(event);
  if (closed !== null) {
    try {
      getThinkingStore().append(sessionId, closed);
    } catch (err) {
      // Nunca rompe el turno: perder un pensamiento degrada una vista, y el evento tiene que llegar al
      // renderer pase lo que pase.
      const detail = err instanceof Error ? err.message : String(err);
      mainLog('warn', `No se pudo guardar el pensamiento de la sesion: ${detail}`);
    }
  }
  // Fin de turno: el buffer ya quedo vacio en el `accept` de arriba (`result` no es un delta, asi que
  // cierra el bloque), pero la ENTRADA del Map sigue ahi. Se suelta para que no crezca una entrada por
  // sesion durante toda la vida del proceso.
  if (event.kind === 'result') thinkingBuffers.delete(sessionId);
}

// Catalogo de modelos (P-026 2.4). Mismo criterio que el de comandos: solo se escribe si cambia (el
// `initialize` se repite al final de cada turno), y ademas se AVISA a las ventanas, porque el sondeo de
// arranque termina cuando el selector ya esta pintado.
const lastModelCatalogJson = new Map<string, string>();

function cacheModelCatalog(configDir: string, models: readonly ProviderModel[]): void {
  const json = JSON.stringify(models);
  if (lastModelCatalogJson.get(configDir) === json) return;
  lastModelCatalogJson.set(configDir, json);
  try {
    getCommandCatalogStore().saveModels(configDir, models, Date.now());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    mainLog('warn', `No se pudo cachear el catalogo de modelos de "${configDir}": ${detail}`);
  }
  const change: ModelCatalogChange = { configDir, models };
  windowManager.broadcast(MODEL_CATALOG_CHANGED_CHANNEL, change);
}

// Sondeo del catalogo de modelos SIN turno (D7): al arrancar Mage y al añadir una cuenta. Un proceso por
// cuenta, en serie. Tiempos MEDIDOS en S1 (2.1.283): 0,6–1,6 s hasta la respuesta.
const MODEL_PROBE_START_DELAY_MS = 5_000; // tras abrir la ventana, para no competir con el arranque
const MODEL_PROBE_TIMEOUT_MS = 5_000; // ~3× lo medido; si vence, se mata y se queda la cache anterior
const MODEL_PROBE_EXIT_GRACE_MS = 3_000; // tras cerrar la entrada, antes de matar el arbol

function spawnModelProbe(configDir: string, extraArgs: readonly string[] = []): ProbeProcess {
  const child = spawn(resolveClaudeBinary(), [...CLAUDE_BASE_ARGS, ...extraArgs], {
    // HOME como cwd: el sondeo no es de ningun proyecto, y asi no lee la configuracion de una carpeta
    // cualquiera (la del ejecutable de Mage).
    cwd: homedir(),
    env: { ...scrubAgentEnv(process.env), CLAUDE_CONFIG_DIR: configDir },
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });
  child.stdout.setEncoding('utf8');
  // Un EPIPE al escribir en un CLI que ya murio no puede tumbar main: la salida ya lo trata como fallo.
  child.stdin.on('error', (err) => mainLog('debug', 'Sondeo del CLI: stdin cerrado', { error: err.message }));
  return {
    onStdout: (listener) => child.stdout.on('data', listener),
    onExit: (listener) => {
      child.on('exit', listener);
      child.on('error', listener);
    },
    writeLine: (line) => child.stdin.write(`${line}\n`),
    endInput: () => child.stdin.end(),
    killTree: () => void killProcessTree(child, killTreeDeps),
  };
}

// En segundo plano: un sondeo fallido no se enseña como error, se registra en el log de depuracion.
function probeModelsInBackground(configDirs: readonly string[]): void {
  const deps = { spawnProbe: spawnModelProbe, timeoutMs: MODEL_PROBE_TIMEOUT_MS, exitGraceMs: MODEL_PROBE_EXIT_GRACE_MS };
  void probeModelCatalogs(deps, configDirs, (configDir, models) => {
    if (models === null || models.length === 0) {
      mainLog('debug', 'Sondeo de modelos sin resultado: se queda la cache anterior', { configDir });
      return;
    }
    cacheModelCatalog(configDir, models);
  });
}

function probeLoggedInAccounts(): void {
  const dirs = accountService
    .listAccounts()
    .filter((account) => account.loginStatus === 'logged_in')
    .map((account) => account.configDir);
  probeModelsInBackground(dirs);
}

function cacheCommandCatalog(accountDir: string, commands: readonly SlashCommandInfo[]): void {
  // Si el catalogo es identico al ultimo escrito, no se toca el disco (P12). Solo cambia al instalar
  // o quitar un plugin; el resto de los turnos reescribia 74 kB para dejarlos igual.
  const json = JSON.stringify(commands);
  if (lastCommandCatalogJson.get(accountDir) === json) return;
  lastCommandCatalogJson.set(accountDir, json);
  try {
    getCommandCatalogStore().save(accountDir, commands, Date.now());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    mainLog('warn', `No se pudo cachear el catalogo de comandos de "${accountDir}": ${detail}`);
  }
}

// WorkspaceStore: lo usan el IPC de estado y la jump list (Ronda 3, item 10 — las "cuentas mas
// usadas" se aproximan contando `accountId` en las pestañas persistidas, que es la unica señal de uso
// que existe hoy). Lazy, mismo motivo que SettingsStore.
//
// UN fichero de workspace POR VENTANA. La principal conserva `workspace-state.json` tal cual: nadie
// pierde sus pestañas al estrenar la multi-ventana, y el fichero no cambia de FORMA (ni migracion ni
// esquema tolerante que mantener). Las secundarias usan `workspace-state-<windowId>.json`, y como el
// id es estable (se reasigna el hueco libre mas bajo), la segunda ventana recupera lo que tenia la
// segunda ventana la vez anterior en vez de dejar un fichero huerfano por apertura.
const workspaceStoresByWindow = new Map<string, WorkspaceStore>();
function workspaceFilePath(windowId: string): string {
  // Guarda: el id acaba en un nombre de fichero. Todos los ids los acuña el WindowManager, pero esta
  // es la frontera y un id que no reconoce cae a la ventana principal en vez de a una ruta rara.
  const safeId = isWindowId(windowId) ? windowId : MAIN_WINDOW_ID;
  const name = safeId === MAIN_WINDOW_ID ? 'workspace-state.json' : `workspace-state-${safeId}.json`;
  return join(app.getPath('userData'), name);
}
// Tamaño y posicion de cada ventana (P-028, 29 bug 3): un solo fichero con una entrada por id.
let windowBoundsStoreSingleton: WindowBoundsStore | null = null;
function getWindowBoundsStore(): WindowBoundsStore {
  windowBoundsStoreSingleton ??= new WindowBoundsStore({
    filePath: join(app.getPath('userData'), 'window-bounds.json'),
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, data) => writeFileSync(path, data, 'utf8'),
    rename: renameSync,
    tempSuffix: () => randomUUID(),
  });
  return windowBoundsStoreSingleton;
}

// Bounds guardados de esa ventana si siguen cayendo en una pantalla conectada; null = por defecto.
// Un fallo de lectura no puede impedir abrir la ventana: se traza y se abre con el tamaño de siempre.
function restoredWindowBounds(windowId: string): SavedWindowBounds | null {
  try {
    const workAreas = screen.getAllDisplays().map((display) => display.workArea);
    return fitSavedBounds(getWindowBoundsStore().load(windowId), workAreas, { width: WINDOW.minWidth, height: WINDOW.minHeight });
  } catch (err) {
    mainLog('warn', 'No se pudieron leer los bounds de la ventana', { windowId, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// Se guarda al CERRAR (tambien al salir: `app.quit()` cierra cada ventana, oculta o no). Con la
// ventana maximizada se guardan sus bounds NORMALES, que son a los que vuelve al desmaximizar.
function saveWindowBounds(window: BrowserWindow, windowId: string): void {
  if (window.isDestroyed()) return;
  const normal = window.getNormalBounds();
  const bounds: SavedWindowBounds = {
    x: Math.round(normal.x),
    y: Math.round(normal.y),
    width: Math.round(normal.width),
    height: Math.round(normal.height),
    maximized: window.isMaximized(),
  };
  try {
    getWindowBoundsStore().save(windowId, bounds);
  } catch (err) {
    mainLog('warn', 'No se pudieron guardar los bounds de la ventana', { windowId, error: err instanceof Error ? err.message : String(err) });
  }
}

// Olvida pestañas y disposicion de paneles guardadas de una ventana (ver `WindowManagerDeps.discardState`).
// `force` = no lanza si no existian; cualquier otro fallo (EBUSY...) si, y sube al llamador.
function discardWindowState(windowId: string): void {
  const safeId = isWindowId(windowId) ? windowId : MAIN_WINDOW_ID;
  const suffix = safeId === MAIN_WINDOW_ID ? '' : `-${safeId}`;
  for (const base of ['workspace-state', 'panels-layout']) rmSync(join(app.getPath('userData'), `${base}${suffix}.json`), { force: true });
}

function getWorkspaceStore(windowId: string = MAIN_WINDOW_ID): WorkspaceStore {
  const cached = workspaceStoresByWindow.get(windowId);
  if (cached !== undefined) return cached;
  const store = new WorkspaceStore({
    filePath: workspaceFilePath(windowId),
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, data) => writeFileSync(path, data, 'utf8'),
    rename: renameSync,
    tempSuffix: () => randomUUID(),
  });
  workspaceStoresByWindow.set(windowId, store);
  return store;
}

// PanelLayoutStore compartido (F6 Fase 2): lo usa el IPC de panels. Lazy, mismo motivo que
// SettingsStore/WorkspaceStore (app.getPath('userData') solo tras app.whenReady). El registro contra
// el que reconcilia NO vive aqui (ver cabecera de panelLayoutStore.ts): lo manda el renderer en cada
// llamada a `load`.
// POR VENTANA, igual que el workspace y por el mismo motivo: el usuario pidio que la disposicion de
// paneles sea de cada ventana (lo compartido son ajustes, temas, permisos y carpetas de confianza).
// La principal conserva `panels-layout.json`; las secundarias usan `panels-layout-<windowId>.json`.
const panelLayoutStoresByWindow = new Map<string, PanelLayoutStore>();
function getPanelLayoutStore(windowId: string = MAIN_WINDOW_ID): PanelLayoutStore {
  const cached = panelLayoutStoresByWindow.get(windowId);
  if (cached !== undefined) return cached;
  const safeId = isWindowId(windowId) ? windowId : MAIN_WINDOW_ID;
  const fileName = safeId === MAIN_WINDOW_ID ? 'panels-layout.json' : `panels-layout-${safeId}.json`;
  const store = new PanelLayoutStore({
    filePath: join(app.getPath('userData'), fileName),
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, data) => writeFileSync(path, data, 'utf8'),
    rename: renameSync,
    tempSuffix: () => randomUUID(),
    log: (level, message) => mainLog(level, message),
  });
  panelLayoutStoresByWindow.set(windowId, store);
  return store;
}

// Color de fondo de la ventana segun el tema persistido: evita el flash al tema equivocado antes de que
// el renderer aplique data-theme. Resuelve 'system' con nativeTheme y fija themeSource (UI nativa:
// menus, scrollbars, dialogos del SO coherentes con el tema de la app). Neutro por tema (M3).
function resolveWindowBackground(): string {
  const pref = getSettingsStore().load().theme;
  nativeTheme.themeSource = pref; // 'system' | 'light' | 'dark'
  return resolveThemeBackgroundColor();
}

// Solo el color de fondo neutro por tema (sin fijar themeSource): lo usa la ventana del widget, que
// debe adoptar el fondo del tema actual pero no re-configurar la UI nativa (ya lo hace la principal).
function resolveThemeBackgroundColor(): string {
  const pref = getSettingsStore().load().theme;
  const dark = pref === 'system' ? nativeTheme.shouldUseDarkColors : pref === 'dark';
  return dark ? '#141414' : '#f4f4f5';
}

// Alto de la cabecera propia, compartido con TitleBar.tsx (la franja de botones del SO debe medir lo
// MISMO que la cabecera del DOM o queda un escalon).
const TITLE_BAR_HEIGHT_PX = 32;

// Colores de arranque de la franja de botones. Solo conoce los dos temas base: en cuanto el renderer
// aplica el tema real (incluido uno importado) manda los suyos por IPC y estos se sustituyen.
function titleBarOverlayFromTheme(): { color: string; symbolColor: string; height: number } {
  const dark = resolveThemeBackgroundColor() === '#141414';
  return {
    color: dark ? '#131313' : '#ececed', // --color-mg-rail de cada tema base
    symbolColor: dark ? '#9a9a9a' : '#6b6b73', // --color-mg-sec
    height: TITLE_BAR_HEIGHT_PX,
  };
}

// Crea UNA ventana del workbench con el aislamiento de seguridad obligatorio: contextIsolation
// activado y sin nodeIntegration -> el renderer no toca Node/procesos. Es la UNICA fabrica de
// ventanas del workbench: la principal y las secundarias salen de aqui, asi que comparten
// literalmente las mismas `webPreferences` (no hay forma de abrir una ventana menos aislada).
function createWorkbenchWindow(windowId: string, placement?: WindowPlacement): BrowserWindow {
  // Una ventana abierta al soltar una pestaña nace bajo el cursor con el tamaño por defecto; las demas
  // recuperan sus bounds guardados.
  const saved = placement === undefined ? restoredWindowBounds(windowId) : null;
  const window = new BrowserWindow({
    ...windowGeometry(saved, placement),
    minWidth: WINDOW.minWidth,
    minHeight: WINDOW.minHeight,
    show: false,
    // Icono de la marca (circulo de invocacion). En Windows se usa el .ico MULTI-TAMAÑO (los tamaños
    // pequeños llevan un glifo simplificado y grueso, nitido a 16px); en el resto, el PNG de 256. En
    // prod el icono del bundle lo pone electron-builder desde resources/brand/icon-1024.png.
    icon: join(
      currentDir,
      process.platform === 'win32' ? '../../resources/brand/icon.ico' : '../../resources/brand/icon-256.png',
    ),
    backgroundColor: resolveWindowBackground(),
    // Cabecera propia (Ronda 3, item 9): la barra de titulo NATIVA no se puede tematizar — vive fuera
    // del DOM, la pinta el gestor de ventanas. Con `hidden` la dibuja la app (ver TitleBar.tsx) y en
    // Windows/Linux queda solo la franja de botones de sistema, que SI admite color y se recolorea en
    // caliente al cambiar de tema (setTitleBarOverlay, canal window:titleBarOverlay).
    // Contrapartida asumida: en Windows esto oculta ademas la barra de MENU clasica; por eso la
    // cabecera propia trae su propio boton "Editar", que despliega el MISMO Menu nativo con .popup()
    // (conserva los aceleradores del SO en vez de reimplementarlos).
    titleBarStyle: 'hidden',
    // macOS dibuja sus semaforos y no admite overlay: alli basta con `hidden` + el hueco que deja
    // TitleBar.tsx a la izquierda.
    ...(process.platform === 'darwin' ? {} : { titleBarOverlay: titleBarOverlayFromTheme() }),
    webPreferences: {
      preload: join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // el preload necesita 'require' de electron; sigue sin exponer Node al renderer
    },
  });

  window.on('ready-to-show', () => {
    if (saved?.maximized === true) window.maximize();
    window.show();
  });
  window.on('close', (event) => onWorkbenchClose(window, windowId, event));
  // La jump list muestra conversaciones recientes: se refresca cuando CUALQUIER ventana recupera el
  // foco, no solo la principal (el propio `refreshJumpList` ya se limita con su intervalo minimo).
  window.on('focus', refreshJumpList);
  // En dev, electron-vite sirve el renderer por URL; en prod, se carga el HTML compilado.
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(join(currentDir, '../renderer/index.html'));
  }
  return window;
}

// Geometria inicial: bajo el cursor (arrastre), la guardada, o el tamaño por defecto centrado.
function windowGeometry(saved: SavedWindowBounds | null, placement: WindowPlacement | undefined): Electron.Rectangle | { width: number; height: number } {
  if (placement !== undefined) return { x: placement.x, y: placement.y, width: WINDOW.width, height: WINDOW.height };
  if (saved !== null) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  return { width: WINDOW.width, height: WINDOW.height };
}

// Una pestaña que llega por IPC se valida con el MISMO esquema con que se lee el workspace: lo que
// cruza a otra ventana acaba persistido en su fichero.
function parsePersistedTab(value: unknown): PersistedTab {
  const result = PERSISTED_TAB_SCHEMA.safeParse(value);
  if (!result.success) throw new Error(`Pestaña no valida para otra ventana: ${result.error.message}`);
  return result.data as PersistedTab;
}

// Cuanto se desplaza la ventana nueva respecto al cursor: que el puntero caiga sobre su barra de
// pestañas y no en la esquina exacta, donde el SO pone el tirador de redimension.
const DROP_WINDOW_OFFSET_PX = { x: 60, y: 16 } as const;

// Se solto una pestaña fuera de su ventana (P-028, 36). Sobre otra ventana visible de Mage -> se le
// entrega; fuera de todas -> ventana nueva bajo el cursor; dentro de la propia -> nada. En Wayland no
// hay posicion global del cursor fiable fuera de la app: se deja el menu contextual (D36-5).
function dropTabOutside(senderId: string, tab: PersistedTab): DropTabOutcome {
  if (process.platform === 'linux' && process.env['XDG_SESSION_TYPE'] === 'wayland') return 'none';
  const cursor = screen.getCursorScreenPoint();
  const windows = windowManager
    .list()
    .map((windowId) => ({ windowId, window: windowManager.get(windowId) }))
    .filter((entry) => entry.window?.isVisible() === true)
    .map((entry) => ({ windowId: entry.windowId, bounds: (entry.window as BrowserWindow).getBounds() }));
  const target = resolveDropTarget(cursor, windows, senderId);
  if (target.kind === 'self') return 'none';
  if (target.kind === 'window') {
    windowManager.sendTo(target.windowId, WINDOW_TAB_RECEIVED_CHANNEL, tab);
    windowManager.focus(target.windowId);
    return 'moved';
  }
  windowManager.openWith(tab, { x: cursor.x - DROP_WINDOW_OFFSET_PX.x, y: cursor.y - DROP_WINDOW_OFFSET_PX.y });
  return 'moved';
}

// Ventanas del workbench a la vista (una oculta en segundo plano no cuenta; una minimizada si).
function visibleWorkbenchWindowCount(): number {
  return windowManager.list().filter((windowId) => windowManager.get(windowId)?.isVisible() === true).length;
}

// La X de una ventana (P-028, 17). La decision es pura (`resolveCloseAction`); aqui solo se ejecuta.
function onWorkbenchClose(window: BrowserWindow, windowId: string, event: Electron.Event): void {
  saveWindowBounds(window, windowId);
  const action = resolveCloseAction({
    behavior: getSettingsStore().load().closeBehavior,
    isQuitting,
    isMainWindow: windowId === MAIN_WINDOW_ID,
    visibleWindowCount: visibleWorkbenchWindowCount(),
    platform: process.platform,
  });
  if (action === 'close') return;
  event.preventDefault();
  if (action === 'hide') {
    window.hide();
    return;
  }
  if (action === 'quit') {
    app.quit();
    return;
  }
  void askCloseBehavior(window);
}

// Dialogo nativo de cierre. «Recordar mi decisión» lo guarda main (es el unico que lo sabe) y lo
// difunde a TODAS las ventanas, la que pregunto incluida: ninguna lo tiene aplicado todavia.
async function askCloseBehavior(window: BrowserWindow): Promise<void> {
  if (closePromptOpen) return;
  closePromptOpen = true;
  try {
    const answer = await dialog.showMessageBox(window, {
      type: 'question',
      message: '¿Cerrar Mage?',
      detail:
        'En segundo plano, Mage sigue en la bandeja del sistema y los agentes siguen trabajando. ' +
        'Cerrar Mage los para. Puedes cambiarlo después en Configuración › Almacenamiento.',
      buttons: [...CLOSE_DIALOG_BUTTONS],
      defaultId: 0,
      cancelId: CLOSE_DIALOG_CANCEL_INDEX,
      checkboxLabel: 'Recordar mi decisión',
      noLink: true,
    });
    const outcome = interpretCloseDialog(answer);
    if (outcome.remember !== null) rememberCloseBehavior(outcome.remember);
    if (outcome.action === 'hide' && !window.isDestroyed()) window.hide();
    if (outcome.action === 'quit') app.quit();
  } finally {
    closePromptOpen = false;
  }
}

function rememberCloseBehavior(closeBehavior: CloseBehavior): void {
  const store = getSettingsStore();
  const next: AppSettings = { ...store.load(), closeBehavior };
  store.save(next);
  windowManager.broadcast(SETTINGS_CHANGED_CHANNEL, next);
}

// Menu de aplicacion MINIMO propio (D5 §6, prerrequisito): sustituye el menu POR DEFECTO de Electron,
// que trae sus propios acceleradores ocultos (Ctrl+R, Ctrl+Shift+R, Ctrl+Shift+I/F12, Ctrl+W, Ctrl+M,
// Ctrl+Z/X/C/V/A) y podia chocar en silencio con el catalogo de atajos de la app (ver PLAN-D5-KEYBINDINGS.md
// §1.2). Solo "Editar" (deshacer/cortar/copiar/pegar siguen haciendo falta en campos de texto nativos)
// + los roles que macOS espera siempre presentes (appMenu/windowMenu). El diseño completo del menu
// (estilo JetBrains) es un encargo aparte, todavia sin ejecutar (`PROMPT-F6-PANELES-ACOPLABLES.md`):
// esto solo quita la colision, no lo sustituye.
// Menu de aplicacion NATIVO. Desde 2.9.b, Mage pinta su propio menu dentro de la ventana (AppMenu.tsx),
// generado del catalogo de acciones; el nativo se queda SOLO en macOS y solo por una razon concreta:
// alli la barra de menus es del SISTEMA OPERATIVO, no se puede sustituir por una barra dentro de la
// ventana, y sin `role: 'editMenu'` los Cmd+C/Cmd+V dejan de funcionar en campos nativos.
//
// En Windows/Linux se quita del todo (`null`): Chromium maneja Ctrl+C/V/X/A/Z dentro de campos
// editables sin necesidad de acelerador de menu — y eso NO se da por supuesto, lo mide la comprobacion
// "copiar y pegar siguen funcionando en el prompt sin el menu nativo" de `pnpm verify:gui`.
//
// macOS queda SIN VERIFICAR (no hay maquina; decision ya registrada en el ROADMAP).
function buildApplicationMenu(): Menu | null {
  if (process.platform !== 'darwin') return null;
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' as const },
    { role: 'editMenu' as const },
    { role: 'windowMenu' as const },
  ];
  return Menu.buildFromTemplate(template);
}

// Tray con el glifo de la marca; cerrar la ventana no mata la app (patron de app de escritorio).
// En macOS se usa una imagen TEMPLATE (negra) que la barra de menus invierte segun su tema; en el
// resto, el glifo blanco. El @2x lo resuelve Electron solo (busca el fichero hermano @2x).
function createTray(): Tray {
  const brandDir = join(currentDir, '../../resources/brand');
  const isMac = process.platform === 'darwin';
  const icon = nativeImage.createFromPath(join(brandDir, isMac ? 'tray-template.png' : 'tray-32.png'));
  if (isMac) icon.setTemplateImage(true);
  const trayInstance = new Tray(icon);
  trayInstance.setToolTip('Mage');
  trayInstance.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir Mage', click: () => focusMainWindow() },
      // Widget flotante (M3): alterna la ventana y sincroniza la preferencia via el renderer.
      { label: 'Mostrar/ocultar widget flotante', click: () => toggleWidgetFromTray() },
      // Entrada de debug solo en desarrollo (la ventana no existe en produccion).
      ...(isDev
        ? [{ label: 'Ventana de debug (Ctrl+Shift+L)', click: () => openDebugWindow() }]
        : []),
      { type: 'separator' as const },
      { label: 'Salir', click: () => app.quit() },
    ]),
  );
  trayInstance.on('click', () => focusMainWindow());
  return trayInstance;
}

// Alterna el widget desde el tray y avisa al renderer del nuevo estado (para sincronizar el checkbox
// de Configuracion y que lo persista; el renderer es el unico escritor de settings).
function toggleWidgetFromTray(): void {
  const enabled = getWidgetWindow().toggle();
  notifyWidgetEnabledChanged(enabled);
}

// Confia el usuario en esta carpeta? Suman DOS fuentes, y las dos son decisiones suyas:
//  - `trustedFolders` de los ajustes de Mage: lo que contesto en el dialogo de Mage.
//  - `projects[<ruta>].hasTrustDialogAccepted` del config del CLI de esa cuenta: lo que ya contesto en
//    el CLI. Solo se LEE (ese fichero lo reescribe el CLI mientras corre y ademas guarda credenciales);
//    esta ahi para no volver a preguntar lo que el usuario ya autorizo.
// La comprobacion sube por los directorios padre en las dos, igual que hace el CLI.
function isFolderTrusted(cwd: string, accountDir: string): boolean {
  const own = getSettingsStore().load().trustedFolders;
  if (isTrusted(cwd, own)) return true;
  const fromCli = readCliTrustedFolders(accountDir, { exists: existsSync, readFile: (path) => readFileSync(path, 'utf8') });
  return isTrusted(cwd, fromCli);
}

// Cuantas rutas acepta `existsDirs` de una vez: el renderer pide las tarjetas de proyectos recientes
// (6) y el ultimo proyecto (1). Un tope holgado impide que un mensaje IPC ponga a main a hacer stat
// de miles de rutas.
const EXISTS_DIRS_MAX = 64;

// ¿Existe cada carpeta? Solo dice si/no (ni contenido ni metadatos) y solo de rutas ABSOLUTAS.
function existsDirs(paths: unknown): readonly boolean[] {
  if (!Array.isArray(paths) || paths.length > EXISTS_DIRS_MAX || !paths.every((p) => typeof p === 'string')) {
    throw new Error(`existsDirs espera hasta ${EXISTS_DIRS_MAX} rutas de texto: ${JSON.stringify(paths)?.slice(0, 200)}`);
  }
  return (paths as readonly string[]).map((path) => isAbsolute(path) && existsSync(path) && statSync(path).isDirectory());
}

// Raiz de los directorios de borrador. Un solo sitio: si la calculan dos, un dia divergen y la fila de
// informacion deja de reconocer el scratchpad sin que nada falle.
function scratchRoot(): string {
  return join(app.getPath('temp'), 'mage-scratch');
}

// Barrido de scratchpads (auditoria B.4.2). La POLITICA la elige el usuario y por defecto es 'never':
// esto borra ficheros de su disco, asi que no puede pasar sin que lo haya pedido. Quien decide QUE
// sobra es el modulo puro; aqui solo se lee el directorio y se borra.
//
// Nunca lanza: un barrido que falla (un antivirus reteniendo un handle en Windows, permisos) no puede
// impedir que la app arranque ni que se cierre. Lo que no se pudo borrar se intenta al siguiente pase.
function sweepScratchDirs(): void {
  const retention = getSettingsStore().load().scratchRetention;
  if (retention === 'never') return;
  const root = scratchRoot();
  if (!existsSync(root)) return;
  try {
    const entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const path = join(root, entry.name);
        // `mtimeMs` de la carpeta: cambia al crear o borrar algo dentro, que es lo que se quiere medir
        // ("¿se uso esto?"). Un stat que falle deja NaN y el modulo puro CONSERVA la carpeta.
        try {
          return { name: entry.name, mtimeMs: statSync(path).mtimeMs };
        } catch {
          return { name: entry.name, mtimeMs: Number.NaN };
        }
      });
    const expired = expiredScratchDirs(entries, retention, Date.now());
    for (const name of expired) rmSync(join(root, name), { recursive: true, force: true });
    if (expired.length > 0) mainLog('info', 'Scratchpads barridos', { retention, borrados: expired.length });
  } catch (err) {
    mainLog('warn', 'No se pudieron barrer los scratchpads', { error: err instanceof Error ? err.message : String(err) });
  }
}

// webContents a los que ya se engancho el `destroyed` (uno por ventana, no uno por sesion).
const sessionOwnersWatched = new Set<number>();

// Las sesiones mueren con la ventana que las creo (P-028, raiz de 17 y 36). Sin esto, cerrar una
// ventana dejaba sus CLI vivos y mudos: los eventos se tiraban (`sender.isDestroyed()`), un permiso
// pendiente se quedaba colgado y reabrir la pestaña chocaba con "ya esta abierta en otra pestaña".
function stopSessionsWhenDestroyed(sender: Electron.WebContents): void {
  if (sessionOwnersWatched.has(sender.id)) return;
  sessionOwnersWatched.add(sender.id);
  const ownerId = sender.id;
  sender.once('destroyed', () => {
    sessionOwnersWatched.delete(ownerId);
    const stopped = sessionManager.stopOwnedBy(ownerId);
    if (stopped > 0) mainLog('info', 'Sesiones paradas al cerrarse su ventana', { stopped });
  });
}

// Registro de handlers IPC: puentean el renderer con el SessionManager. Los eventos del motor se
// empujan al webContents que creo la sesion (guardando contra un renderer ya destruido).
function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.SessionCreate, (event, params: CreateSessionParams): CreateSessionResult => {
    const sender = event.sender;
    // FRONTERA DE CONFIANZA. Lanzar el CLI en una carpeta ejecuta lo que esa carpeta traiga (hooks,
    // `.claude/settings.json`, servidores MCP del repo), asi que abrir un repositorio ajeno es ejecutar
    // codigo ajeno. La guarda va AQUI y no en el selector de carpeta porque este es el unico punto por
    // el que pasan TODOS los arranques: pestana nueva, `--resume`, restaurar el workspace al abrir la
    // app y dividir el panel. El renderer pregunta antes para que el usuario vea un dialogo y no un
    // error; esto es lo que lo hace cierto aunque el renderer se salte el paso.
    // Y la CUENTA se valida como en el resto de canales con ruta (`UsageGet`, `ConversationsList`…):
    // este es el unico que LANZA UN PROCESO, asi que un `accountDir` arbitrario seria un CLI corriendo
    // contra un config dir ajeno —con sus credenciales y sus hooks— por un solo mensaje IPC.
    if (!isManagedAccountConfigDir(params.accountDir)) {
      throw new Error(`Cuenta no valida para lanzar un agente: ${params.accountDir}`);
    }
    if (!isFolderTrusted(params.cwd, params.accountDir)) {
      throw new Error(`Carpeta no autorizada para lanzar un agente: ${params.cwd}`);
    }
    // M2.6: una conversacion privada se lanza bajo el perfil privado de la cuenta (mismo login,
    // projects propio). Compartida (default) usa la cuenta tal cual. El config dir efectivo vuelve al
    // renderer para localizar transcripciones/memoria de la conversacion.
    const configDir =
      params.privacy === 'private' ? accountService.ensurePrivateProfile(params.accountDir) : params.accountDir;
    const effectiveParams = configDir === params.accountDir ? params : { ...params, accountDir: configDir };
    const sessionId = sessionManager.create(effectiveParams, (payload) => {
      // Cache del catalogo "/" (2.2): la sesion es la UNICA fuente del catalogo real, y una
      // conversacion recien abierta no tiene sesion. Se escribe con el config dir EFECTIVO (para una
      // conversacion privada, el perfil `mage-private`), nunca con el de la cuenta: si no, la cache de
      // una cuenta acabaria con el catalogo de otra.
      if (payload.event.kind === 'commands_available') {
        cacheCommandCatalog(configDir, payload.event.commands);
      }
      // Y el de modelos (P-026 2.4), del mismo `initialize` y con el mismo config dir efectivo.
      if (payload.event.kind === 'models_available') {
        cacheModelCatalog(configDir, payload.event.models);
      }
      // Pensamiento: el CLI lo emite en vivo y luego lo persiste VACIO en su transcripcion (medido), asi
      // que si no lo guarda Mage aqui, se pierde al reanudar. Se acumula por sesion y se cierra el
      // bloque en cuanto llega un evento que no es un delta de pensamiento.
      captureThinking(payload.sessionId, payload.event);
      // Uso por stream (9.3): el CLI regala la foto de consumo en cada turno, sin que Mage gaste una
      // peticion. Va al config dir EFECTIVO, igual que el catalogo: el perfil privado y su cuenta
      // comparten login, asi que comparten uso, pero cada dir guarda el suyo y nadie pisa a nadie.
      if (payload.event.kind === 'usage_limits') {
        // Con la clave de la CUENTA, no con el config dir efectivo: `UsageGet` solo sirve cuentas
        // gestionadas (rechaza `mage-private`), asi que guardarlo bajo el perfil privado era escribir
        // en una entrada que nadie lee jamas. Y es correcto compartirlo: mismo login, mismo uso.
        usageService.recordStreamUsage(params.accountDir, {
          fiveHour: payload.event.fiveHour,
          sevenDay: payload.event.sevenDay,
        });
      }
      if (!sender.isDestroyed()) sender.send(EVENT_CHANNEL, payload);
    }, sender.id);
    stopSessionsWhenDestroyed(sender);
    return { sessionId, configDir };
  });
  ipcMain.handle(IpcChannel.SessionSendMessage, (_e, params: SendMessageParams) =>
    // Los adjuntos se validan tambien AQUI (el renderer valida por cortesia; esta es la frontera de
    // verdad). El adapter vuelve a validarlos antes de codificarlos: es barato y es el ultimo punto
    // donde se puede impedir que algo raro llegue al CLI.
    sessionManager.sendMessage(params.sessionId, params.text, validateAttachments(params.attachments)),
  );
  ipcMain.handle(IpcChannel.SessionAnswerPermission, (_e, params: AnswerPermissionParams) =>
    sessionManager.answerPermission(params.sessionId, params.requestId, params.decision),
  );
  ipcMain.handle(IpcChannel.SessionInterrupt, (_e, sessionId: string) =>
    sessionManager.interrupt(sessionId),
  );
  ipcMain.handle(IpcChannel.SessionSetPermissionMode, (_e, params: SetPermissionModeParams) =>
    sessionManager.setPermissionMode(params.sessionId, params.mode),
  );
  ipcMain.handle(IpcChannel.SessionSetModel, (_e, params: SetModelParams) =>
    sessionManager.setModel(params.sessionId, params.model),
  );
  ipcMain.handle(IpcChannel.SessionStopTask, (_e, params: StopTaskParams) => sessionManager.stopTask(params.sessionId, params.taskId));
  ipcMain.handle(IpcChannel.SessionStop, (_e, sessionId: string) => sessionManager.stop(sessionId));
  // Carpeta scratch AISLADA por conversacion (subdir unico y vacio): asi crear un archivo nuevo
  // funciona a la primera, sin el "read first" de Claude Code por ficheros preexistentes. Fase B;
  // en M1.2 el cwd sera un proyecto real elegido por el usuario. Cross-platform.
  ipcMain.handle(IpcChannel.SessionGetScratchDir, () => {
    const dir = join(scratchRoot(), randomUUID());
    mkdirSync(dir, { recursive: true });
    return dir;
  });
  // La RAIZ, sin crear nada. Existe porque `getScratchDir` no sirve para saberla: acuña un
  // subdirectorio NUEVO en cada llamada, asi que preguntarla para averiguar la raiz devolvia un
  // hermano del que se buscaba —y de paso dejaba una carpeta vacia por cada arranque—. La usa la fila
  // de informacion del chat para saber si la conversacion vive en el scratchpad.
  ipcMain.handle(IpcChannel.SessionGetScratchRoot, () => scratchRoot());
  ipcMain.handle(IpcChannel.FsExistsDirs, (_e, paths: unknown): readonly boolean[] => existsDirs(paths));
  // ¿Esta instalado el CLI de Antigravity (E3)? Se resuelve en cada consulta (el usuario puede
  // instalarlo con Mage abierto) y solo viaja el booleano: la ruta del binario no le hace falta al
  // renderer.
  // `findAgyBinary` lanza un `where`/`which` SINCRONO: medido, 71-93 ms de main bloqueado por
  // consulta, y se consulta al abrir "Nueva conversacion". Con TTL sigue detectandose una
  // instalacion hecha con Mage abierto (que es la razon de no cachearlo de por vida), pero deja de
  // pagarse el proceso en cada apertura del dialogo.
  let agyProbe: { atMs: number; installed: boolean } | null = null;
  // «Añadir cuenta» por proveedor (P-028, 41). Los integrados con adapter y los del usuario; de estos
  // solo viajan id y nombre (su `apiKey` no sale de main).
  ipcMain.handle(IpcChannel.ProvidersAuthList, (): readonly ProviderAuthSummary[] => {
    const custom = getSettingsStore().load().customProviders.map(({ id, label }) => ({ id, label }));
    const builtIn = BUILT_IN_PROVIDERS.filter((p) => hasAdapter(p.id)).map(({ id, label }) => ({ id, label }));
    return providerAuthSummary([...builtIn, ...custom], buildAdapter);
  });
  ipcMain.handle(IpcChannel.AgyInstalled, () => {
    const nowMs = Date.now();
    if (agyProbe === null || nowMs - agyProbe.atMs > AGY_PROBE_TTL_MS) {
      agyProbe = { atMs: nowMs, installed: findAgyBinary() !== null };
    }
    return agyProbe.installed;
  });
  // Sondeo de un proveedor para Configuracion (D2): ruta del binario detectada o URL del endpoint, y
  // los modelos que ofrece de verdad. Sin cache: se pide al abrir la seccion y al pulsar "Reintentar",
  // que es justo cuando el usuario acaba de cambiar algo (instalar el CLI, arrancar Ollama...).
  ipcMain.handle(IpcChannel.ProviderProbe, (_e, params: ProviderProbeParams) =>
    probeProvider(params, defaultProbeDeps(() => getCommandCatalogStore().loadModels(join(homedir(), cliLogin.accounts.mainDirName)))),
  );
  // Abrir con: revelar en el gestor / guardar-como los archivos generados por las tools.
  ipcMain.handle(IpcChannel.FileReveal, (_e, path: string) => openWithService.reveal(path));
  ipcMain.handle(IpcChannel.FileSaveAs, (_e, path: string) => openWithService.saveAs(path));
  ipcMain.handle(IpcChannel.OpenPath, (_e, path: string) => openWithService.openPath(path));
  ipcMain.handle(IpcChannel.OpenExternal, (_e, url: string) => openWithService.openExternal(url));

  // Cabecera propia (Ronda 3, item 9). setTitleBarOverlay solo existe en Windows/Linux y lanza si la
  // ventana no se creo con titleBarStyle:'hidden' -> guarda explicita, no try/catch mudo.
  // Sobre la ventana QUE LLAMA (no sobre la principal): con varias ventanas abiertas, recolorear la
  // franja de botones de la principal desde otra dejaba la que cambio de tema con los colores viejos.
  ipcMain.handle(IpcChannel.TitleBarOverlay, (event, colors: TitleBarOverlayColors) => {
    if (process.platform === 'darwin') return;
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null || window.isDestroyed()) return;
    window.setTitleBarOverlay({ ...colors, height: TITLE_BAR_HEIGHT_PX });
  });
  // Comandos de EDICION (2.9.b). Existen porque el menu de aplicacion propio sustituye al `Menu`
  // nativo, y con el se fueron los `role:` que daban deshacer/cortar/copiar/pegar. Es literalmente lo
  // que hacian aquellos: el metodo homonimo del webContents que tiene el foco.
  ipcMain.handle(IpcChannel.EditCommand, (event, command: EditCommandName): void => {
    const contents = event.sender;
    switch (command) {
      case 'undo':
        contents.undo();
        return;
      case 'redo':
        contents.redo();
        return;
      case 'cut':
        contents.cut();
        return;
      case 'copy':
        contents.copy();
        return;
      case 'paste':
        contents.paste();
        return;
      case 'selectAll':
        contents.selectAll();
        return;
    }
  });
  ipcMain.handle(IpcChannel.OpenTerminal, (_e, cwd: string) => openWithService.openTerminal(cwd));
  ipcMain.handle(IpcChannel.EditorsList, () => openWithService.listAvailableEditors());
  ipcMain.handle(IpcChannel.OpenEditor, (_e, params: OpenEditorParams) =>
    openWithService.openEditor(params.bin, params.cwd),
  );

  // Cuentas: listar (datos seguros), crear (dir + enlaces + settings) y lanzar login interactivo
  // en terminal externa (headless no puede loguear). El binario se resuelve por SO.
  ipcMain.handle(IpcChannel.AccountsList, (): readonly AccountInfo[] => accountService.listAccounts());
  ipcMain.handle(IpcChannel.AccountsCreate, (_e, name: string): AccountInfo =>
    accountService.createAccount(name),
  );
  // Login por el CLI (Fase 9.2), en tres pasos porque el usuario pega el *code* en medio. El
  // whitelisting del configDir vive dentro del servicio (`validateConfigDir`), que es su frontera.
  ipcMain.handle(IpcChannel.AccountsLoginStart, (_e, params: LoginStartParams): Promise<CliLoginStart> => {
    loginConfigDir = params.configDir;
    return cliLoginService.start(params.configDir, params.email);
  });
  // Cuenta recien añadida (D7): se sondean sus modelos en cuanto tiene sesion, sin esperar al reinicio.
  ipcMain.handle(IpcChannel.AccountsLoginSubmitCode, async (_e, code: string): Promise<EmbeddedLoginResult> => {
    const result = await cliLoginService.submitCode(code);
    if (result.status === 'ok' && loginConfigDir !== null) probeModelsInBackground([loginConfigDir]);
    return result;
  });
  ipcMain.handle(IpcChannel.AccountsLoginCancel, (): void => cliLoginService.cancel());
  // El whitelisting de las dos rutas lo hace AccountService.adoptLogin, que es su frontera.
  ipcMain.handle(IpcChannel.AccountsAdoptLogin, (_e, params: AdoptLoginParams): void => {
    accountService.adoptLogin(params.sourceConfigDir, params.targetConfigDir);
    probeModelsInBackground([params.targetConfigDir]);
  });
  ipcMain.handle(IpcChannel.ModelCatalogLoad, (_e, accountDir: string): readonly ProviderModel[] =>
    getCommandCatalogStore().loadModels(accountDir),
  );
  // Borrar una cuenta (P-028, punto 30). Antes del borrado se paran sus sesiones en TODAS las ventanas
  // (un CLI vivo recrearia el dir o escribiria en uno borrado). NO se hace `claude auth logout`: las
  // cuentas que adoptaron el login comparten refresh token y revocarlo cerraria las demas.
  // Las guardas de datos (principal, carpeta compartida real con datos, enlace que no se quita) viven
  // en `AccountService.deleteAccount`, que es la frontera.
  ipcMain.handle(IpcChannel.AccountsDelete, (_e, configDir: string) => {
    if (!isManagedAccountConfigDir(configDir)) {
      throw new Error(`Cuenta no valida para borrar: ${configDir}`);
    }
    const stopped = sessionManager.stopByConfigDir(configDir);
    if (stopped > 0) mainLog('info', `Paradas ${stopped} sesiones antes de borrar la cuenta "${configDir}"`);
    accountService.deleteAccount(configDir);
    getCommandCatalogStore().forgetAccount(
      configDir,
      (key) => pathEquals(key, configDir) || pathEquals(dirname(key), configDir),
    );
  });
  // Selector de carpeta de proyecto (cwd de una pestana). Devuelve null si el usuario cancela.
  ipcMain.handle(IpcChannel.DialogPickDirectory, async (): Promise<string | null> => {
    const options = { properties: ['openDirectory' as const] };
    const parent = liveMainWindow();
    const result = parent !== null ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    return result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] ?? null);
  });

  // Uso por cuenta (datos agregados seguros; el token no sale de main) y estado del servicio.
  // Whitelisting IPC (auditoria de seguridad, 2026-08-10): sin esto, un configDir arbitrario haria que
  // main leyera .credentials.json de CUALQUIER ruta y usara ese token contra la API de uso — mismo
  // patron que ConversationsList/AccountsDelete.
  ipcMain.handle(IpcChannel.UsageGet, (_e, configDir: string) => {
    if (!isManagedAccountConfigDir(configDir)) {
      throw new Error(`Cuenta no valida para consultar uso: ${configDir}`);
    }
    return usageService.getUsage(configDir);
  });
  ipcMain.handle(IpcChannel.StatusGet, () => statusService.getStatus());
  // `app.getVersion()` lee el package.json de la app EMPAQUETADA, que es la version que el usuario
  // tiene instalada — no la del arbol de fuentes.
  ipcMain.handle(IpcChannel.AppVersionGet, () => app.getVersion());
  // «Acerca de» (B.2/B.3): versiones del runtime y los avisos de terceros. Las rutas se calculan aqui
  // —es lo unico que sabe de Electron— y el servicio decide que existe y que se puede enseñar.
  ipcMain.handle(IpcChannel.AboutGet, () =>
    buildAboutInfo(
      {
        appPath: app.getAppPath(),
        exeDir: dirname(app.getPath('exe')),
        electronDistDir: join(app.getAppPath(), 'node_modules', 'electron', 'dist'),
      },
      {
        app: app.getVersion(),
        electron: process.versions.electron,
        chromium: process.versions.chrome,
        node: process.versions.node,
      },
    ),
  );
  // Opacidad de fondo (peticion del usuario): el alfa de las superficies lo pinta el renderer, pero
  // sin material detras el resultado seria alfa sobre NEGRO, no translucidez. En Windows 11 se activa
  // el acrilico del sistema, que es lo unico que hace que se vea el escritorio; y para que asome, el
  // color de fondo de la ventana tiene que ser transparente.
  //
  // Es win32 y punto: `setBackgroundMaterial` no existe en macOS/Linux (alli el equivalente es
  // `vibrancy`, que no se puede verificar sin maquina — riesgo asumido y escrito, como el resto del
  // empaquetado de esos dos SO). Fuera de Windows el ajuste sigue funcionando, pero mezcla contra el
  // color de fondo en vez de contra el escritorio.
  ipcMain.handle(IpcChannel.WindowOpacitySet, (_e, percent: number) => {
    if (process.platform !== 'win32') return;
    const translucida = percent < 100;
    // A TODAS las ventanas: la opacidad es un ajuste compartido, asi que el material del SO tiene que
    // quedar igual en las dos pantallas (el que llama incluido: ahi el cambio es de main, no del DOM).
    for (const windowId of windowManager.list()) {
      const window = windowManager.get(windowId);
      if (window === null) continue;
      window.setBackgroundColor(translucida ? '#00000000' : resolveWindowBackground());
      window.setBackgroundMaterial(translucida ? 'acrylic' : 'none');
    }
  });

  // Transcripciones (M2.2.1): abre en streaming y empuja lotes por TRANSCRIPT_BATCH_CHANNEL sin
  // bloquear el invoke (devuelve el transcriptId de inmediato). Whitelisting de ruta: solo
  // ~/.claude*/projects/** (nunca una ruta arbitraria via IPC).
  ipcMain.handle(IpcChannel.TranscriptOpen, (event, transcriptId: string, params: OpenTranscriptParams): void => {
    // Con `agentId` se abre el transcript del SUBAGENTE (drill-down, M2.2.3b); sin el, el principal.
    // Ambos resolvers validan sus segmentos (anti path-traversal) y ambas rutas caen bajo projects/.
    const filePath =
      params.agentId !== undefined
        ? resolveSubagentTranscriptPath(params.accountDir, params.cwd, params.sessionId, params.agentId)
        : resolveTranscriptPath(params.accountDir, params.cwd, params.sessionId);
    if (!isUnderManagedProjects(filePath)) {
      throw new Error(`Ruta de transcripcion no permitida (debe caer bajo ~/.claude*/projects): ${filePath}`);
    }
    const sender = event.sender;
    const controller = new AbortController();
    openTranscriptControllers.set(transcriptId, controller);

    void (async () => {
      try {
        for await (const batch of transcriptService.openStream(filePath, controller.signal, params.resumeFrom)) {
          if (sender.isDestroyed()) break;
          sender.send(TRANSCRIPT_BATCH_CHANNEL, { transcriptId, batch });
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        mainLog('error', 'Fallo leyendo transcripcion', { transcriptId, error });
        // Propaga el fallo al renderer (no solo al log): sin esto el panel se queda "Cargando…"
        // para siempre. Es terminal (cierra la lectura igual que un lote final).
        if (!sender.isDestroyed()) sender.send(TRANSCRIPT_BATCH_CHANNEL, { transcriptId, error });
      } finally {
        openTranscriptControllers.delete(transcriptId);
      }
    })();
  });
  ipcMain.handle(IpcChannel.TranscriptCancel, (_e, transcriptId: string) => {
    openTranscriptControllers.get(transcriptId)?.abort();
    openTranscriptControllers.delete(transcriptId);
  });

  // Memoria del proyecto (M2.2.4): lee los .md crudos de <cuenta>/projects/<cwd-encoded>/memory/.
  // Whitelisting de ruta como en transcripciones (solo bajo <cuenta>/projects). Ficheros pequenos
  // (KB) -> lectura sincrona y respuesta directa por invoke (no hace falta streaming).
  ipcMain.handle(IpcChannel.MemoryRead, (_e, params: ReadMemoryParams): readonly MemoryFile[] => {
    const dir = resolveMemoryDir(params.accountDir, params.cwd);
    if (!isUnderManagedProjects(dir)) {
      throw new Error(`Ruta de memoria no permitida (debe caer bajo ~/.claude*/projects): ${dir}`);
    }
    return memoryService.read(dir);
  });

  // Historial de conversaciones de una cuenta (M2.6, sidebar = historial). Whitelisting: la ruta debe
  // ser un dir de cuenta gestionado bajo HOME (nunca una ruta arbitraria via IPC).
  ipcMain.handle(IpcChannel.ConversationsList, (_e, accountDir: string): readonly ConversationSummary[] => {
    if (!isManagedAccountConfigDir(accountDir)) {
      throw new Error(`Cuenta no valida para listar conversaciones: ${accountDir}`);
    }
    return conversationsService.listConversations(accountDir);
  });

  // Administracion de conversaciones (#2 de AJUSTES): borrar y mover. Servicio con DI de FS reales.
  const conversationAdminService = new ConversationAdminService({
    exists: existsSync,
    removeFile: (p) => rmSync(p, { force: true }),
    removeDir: (p) => rmSync(p, { recursive: true, force: true }),
    ensureDir: (p) => mkdirSync(p, { recursive: true }),
    move: (from, to) => renameSync(from, to),
    realpath: (p) => realpathSync(p),
    privateProfileDir: (dir) => join(dir, PRIVATE_PROFILE_SEGMENT),
    ensurePrivateProfile: (dir) => accountService.ensurePrivateProfile(dir),
  });
  // Whitelisting IPC: cuentas gestionadas bajo HOME + sessionId como segmento seguro (nunca `..`).
  const requireSafeConversation = (accountDir: string, sessionId: string): void => {
    if (!isManagedAccountConfigDir(accountDir)) {
      throw new Error(`Cuenta no valida para administrar conversaciones: ${accountDir}`);
    }
    if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) {
      throw new Error(`sessionId no valido: ${JSON.stringify(sessionId)}`);
    }
  };
  ipcMain.handle(IpcChannel.ConversationsDelete, (_e, params: DeleteConversationParams): void => {
    requireSafeConversation(params.accountDir, params.sessionId);
    conversationAdminService.deleteConversation(params);
    // Y su entrada del indice (2.1): sin esto el fichero crece para siempre con preferencias de
    // conversaciones que ya no existen.
    getConversationIndexStore().forgetConversation(params.sessionId);
    // Y sus pensamientos, por lo mismo: si no, queda un `.jsonl` huerfano por cada conversacion borrada.
    getThinkingStore().forget(params.sessionId);
  });
  ipcMain.handle(IpcChannel.ConversationsMove, (_e, params: MoveConversationParams): MoveConversationResult => {
    requireSafeConversation(params.accountDir, params.sessionId);
    if (!isManagedAccountConfigDir(params.destAccountDir)) {
      throw new Error(`Cuenta destino no valida: ${params.destAccountDir}`);
    }
    return conversationAdminService.moveConversation(params);
  });

  // Persistencia del workspace (M2.5): lista de pestanas + activa, en un JSON bajo userData. Escritura
  // atomica (tmp + rename); lectura tolerante (corrupto -> null). NO guarda credenciales ni el
  // contenido de las conversaciones (eso vive en las transcripciones del CLI).
  // POR VENTANA (multi-ventana): la firma del canal no cambia, main resuelve a que ventana pertenece
  // la llamada por su `event.sender`. El renderer nunca manda su windowId (podria mentir, y ademas no
  // tiene por que conocerlo para guardar lo suyo).
  ipcMain.handle(IpcChannel.StateLoad, (event): PersistedWorkspace | null =>
    getWorkspaceStore(senderWindowId(event)).load(),
  );
  ipcMain.handle(IpcChannel.StateSave, (event, state: PersistedWorkspace) => {
    getWorkspaceStore(senderWindowId(event)).save(state);
    // NO se refresca la jump list aqui (P1). Este handler lo dispara el store en 16 sitios (abrir,
    // cerrar y cambiar de pestaña, cambiar de modelo o de cwd...), y `refreshJumpList` escanea el
    // disco entero de forma SINCRONA: medido, 319 ms de main bloqueado por cambio de pestaña.
    // La jump list se sigue refrescando al arrancar y al recuperar el foco, que es cuando de verdad
    // puede haber cambiado lo que muestra. Lo mide `verify:gui` 0.3.
  });

  // Configuracion de la app (M2.3): mismo patron que el workspace (atomico, tolerante), fichero
  // separado (settings = preferencias globales; workspace = sesiones).
  const settingsStore = getSettingsStore();
  ipcMain.handle(IpcChannel.SettingsLoad, (): AppSettings => settingsStore.load());
  // Los ajustes son COMPARTIDOS entre ventanas (ajustes, temas, permisos y carpetas de confianza viven
  // todos en `app-settings.json`): tras guardar, se avisa a TODAS las demas para que apliquen lo mismo.
  // Se excluye a la que lo origino —ya lo tiene aplicado— para no devolverle un eco que pisaria una
  // edicion en curso suya. Esto es el nucleo de "que no surjan discrepancias entre configuraciones".
  ipcMain.handle(IpcChannel.SettingsSave, (event, settings: AppSettings) => {
    settingsStore.save(settings);
    windowManager.broadcast(SETTINGS_CHANGED_CHANNEL, settings, event.sender.id);
  });
  // --- Varias ventanas del workbench ----------------------------------------------------------
  // Abrir una ventana NUEVA: misma instancia, mismo main, mismos ajustes; workspace propio.
  ipcMain.handle(IpcChannel.WindowsOpen, (): string => windowManager.open().windowId);
  // Ventanas abiertas, marcando cual es la que pregunta (para que el menu de "mover a..." no se
  // ofrezca a si misma).
  ipcMain.handle(IpcChannel.WindowsList, (event): readonly MageWindowInfo[] => {
    const current = senderWindowId(event);
    return windowManager.list().map((windowId) => ({ windowId, isCurrent: windowId === current }));
  });
  // Mover una pestaña a otra ventana. El ARRASTRE es DOM (renderer); esto es el transporte: se entrega
  // el estado persistido de la pestaña a la ventana destino y se la trae al frente. Lanza si esa
  // ventana ya no existe, para que el origen NO borre su pestaña (perderla en silencio seria lo peor).
  ipcMain.handle(IpcChannel.WindowsMoveTab, (_e, params: MoveTabToWindowParams): void => {
    windowManager.sendTo(params.targetWindowId, WINDOW_TAB_RECEIVED_CHANNEL, params.tab);
    windowManager.focus(params.targetWindowId);
  });
  // P-028, 36: la ventana NUEVA no recibe la pestaña empujada (su renderer aun no escucha): la espera
  // en main y la recoge ella con WindowsTakePendingTabs.
  ipcMain.handle(IpcChannel.WindowsOpenWithTab, (_e, tab: unknown): string => windowManager.openWith(parsePersistedTab(tab)));
  ipcMain.handle(IpcChannel.WindowsTakePendingTabs, (event): readonly PersistedTab[] => windowManager.takePending(senderWindowId(event)));
  ipcMain.handle(IpcChannel.WindowsDropTab, (event, tab: unknown): DropTabOutcome =>
    dropTabOutside(senderWindowId(event), parsePersistedTab(tab)),
  );

  ipcMain.handle(IpcChannel.ThinkingRead, (_e, sessionId: string): readonly string[] => {
    if (sessionId.length === 0) return [];
    return getThinkingStore().read(sessionId);
  });
  // Consulta de confianza para el renderer (que pregunta ANTES de arrancar, para poder mostrar un
  // dialogo). No concede nada: conceder es guardar `trustedFolders` por SettingsSave, como cualquier
  // otro ajuste.
  ipcMain.handle(IpcChannel.TrustIsFolderTrusted, (_e, params: { cwd: string; accountDir: string }): boolean =>
    isFolderTrusted(params.cwd, params.accountDir),
  );
  registerGitHandlers();

  // Cache del catalogo "/" (2.2) e indice propio por conversacion (2.1). La cache solo se LEE por IPC:
  // la escribe main en el sink de la sesion, que es quien ve el catalogo real.
  ipcMain.handle(IpcChannel.CommandCatalogLoad, (_e, accountDir: string): readonly SlashCommandInfo[] =>
    getCommandCatalogStore().load(accountDir),
  );
  ipcMain.handle(IpcChannel.ConversationPrefsLoad, (_e, sessionId: string): ConversationPrefs | null =>
    getConversationIndexStore().loadPrefs(sessionId),
  );
  ipcMain.handle(IpcChannel.ConversationPrefsSave, (_e, params: SaveConversationPrefsParams): void =>
    getConversationIndexStore().savePrefs(params.sessionId, params.prefs),
  );
  ipcMain.handle(IpcChannel.ArtifactRecordSave, (_e, params: RecordArtifactParams): void =>
    getConversationIndexStore().recordArtifact(params.url, params.record),
  );
  // Abrir un artifact (2.4). La cuenta la manda el renderer o sale del indice; si no hay ninguna, se
  // LANZA: abrirlo con una cuenta arbitraria es exactamente el fallo que este punto viene a arreglar.
  ipcMain.handle(IpcChannel.ArtifactOpen, (_e, params: OpenArtifactParams): void => {
    const accountDir = params.accountDir ?? getConversationIndexStore().loadArtifact(params.url)?.accountDir;
    if (accountDir === undefined || accountDir.length === 0) {
      throw new Error(`No se sabe con que cuenta abrir el artifact ${JSON.stringify(params.url)}`);
    }
    if (!isManagedAccountConfigDir(accountDir)) {
      throw new Error(`Cuenta no gestionada por Mage para abrir un artifact: ${JSON.stringify(accountDir)}`);
    }
    openArtifactWindow(params.url, accountDir);
  });
  ipcMain.handle(IpcChannel.ArtifactPublisherLookup, (_e, url: string): string | null =>
    getConversationIndexStore().loadArtifact(url)?.accountDir ?? null,
  );

  // Vistas nuevas (2.9.b). Las dos leen POR CONVERSACION (su cwd y su config dir efectivo) y son de
  // SOLO LECTURA: Mage no reescribe el settings.json del usuario ni el del proyecto.
  const instructionsService = new InstructionsService({
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
  });
  ipcMain.handle(IpcChannel.InstructionsRead, (_e, params: ReadInstructionsParams): readonly InstructionsFile[] => {
    // Whitelisting, igual que el resto de canales que reciben una ruta: el config dir tiene que ser
    // una cuenta gestionada bajo HOME, nunca una ruta arbitraria por IPC.
    if (!isManagedAccountConfigDir(params.accountDir)) {
      throw new Error(`Cuenta no valida para leer instrucciones: ${params.accountDir}`);
    }
    return instructionsService.read(params);
  });
  // Una sola instancia (no una por llamada: "deps instanciadas dentro de funciones" es antipatron del
  // proyecto, y esto se llama cada vez que el usuario abre el panel de ajustes efectivos).
  const effectiveSettingsService = new EffectiveSettingsService({
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    commonSettingsPath: settingsCommonPath(),
    log: (level, message) => mainLog(level, message),
  });
  ipcMain.handle(IpcChannel.EffectiveSettingsRead, (_e, params: ReadInstructionsParams): EffectiveSettings => {
    if (!isManagedAccountConfigDir(params.accountDir)) {
      throw new Error(`Cuenta no valida para leer los ajustes efectivos: ${params.accountDir}`);
    }
    return effectiveSettingsService.read(params);
  });

  // Ficheros creados por el agente (2.10, panel "Ficheros"). Es el UNICO canal por el que el renderer
  // puede escribir un fichero cualquiera del proyecto, asi que la validacion de la ruta (dentro del cwd
  // de la conversacion) y el compare-and-swap por mtime viven en el servicio, con sus tests.
  //
  // `writeFileSync` a secas y NO `writeAtomic`: aqui se edita un fichero del PROYECTO del usuario, que
  // puede tener enlaces duros o estar vigilado por un watcher, y el tmp+rename de la escritura atomica
  // rompe lo primero (es el mismo motivo por el que `seedSettings` escribe plano, ver CLAUDE.md).
  const projectFileService = new ProjectFileService({
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, content) => writeFileSync(path, content, 'utf8'),
    mtimeMs: (path) => (existsSync(path) ? statSync(path).mtimeMs : null),
    byteLength: (path) => statSync(path).size,
    // TRES raices fuera del cwd sin pregunta: los planes del CLI, su memoria y su scratchpad. Las tres
    // ancladas por estructura, nunca por prefijo — ver el comentario de cada una. El resto de fuera
    // solo con aprobacion del usuario (dialogo nativo de `approveOutsideFile`).
    isAllowedOutsideCwd: (path: string) => isUnderManagedPlans(path) || isUnderManagedMemory(path) || isUnderCliScratchpad(path),
    isApprovedOutside,
  });
  ipcMain.handle(IpcChannel.ProjectFileRead, (_e, params: ReadProjectFileParams): ProjectFileContent =>
    projectFileService.read(params),
  );
  ipcMain.handle(IpcChannel.ProjectFileWrite, (_e, params: WriteProjectFileParams): ProjectFileContent =>
    projectFileService.write(params),
  );
  ipcMain.handle(IpcChannel.ProjectFileApproveOutside, (event, params: ReadProjectFileParams): Promise<boolean> =>
    approveOutsideFile(event, params),
  );

  // Layout de paneles acoplables (F6 Fase 2): userData/panels-layout.json, global (§5.3). El
  // renderer manda su catalogo real (sin `render`) en cada `load`; ver cabecera de panelLayoutStore.ts.
  // POR VENTANA (como el workspace): main resuelve la ventana por el `event.sender`, la firma del
  // canal no cambia.
  ipcMain.handle(IpcChannel.PanelsLoad, (event, params: LoadPanelLayoutParams): PanelLayoutState =>
    getPanelLayoutStore(senderWindowId(event)).load(params.registry),
  );
  ipcMain.handle(IpcChannel.PanelsSave, (event, state: PanelLayoutState) =>
    getPanelLayoutStore(senderWindowId(event)).save(state),
  );

  // Config compartida entre cuentas (D1 Fase 2): editor de mcp-common.json/settings-common.json.
  // Los avisos del snapshot (formas descartadas) salen de re-parsear el texto ya guardado, NO de
  // loadMcpCommon/loadSettingsCommon (esos van al LogBus en cada lanzamiento real, no a la UI).
  ipcMain.handle(IpcChannel.SharedConfigLoad, (): SharedConfigSnapshot => {
    const service = getSharedConfigService();
    // El TEXTO de mcp-common.json no sale de main (P-028): lleva los `env` de los servidores.
    const mcpParsed = parseMcpCommonJson(service.readMcpCommonText(mcpCommonPath()));
    const settingsCommonText = service.readSettingsCommonText(settingsCommonPath());
    const settingsParsed = parseSettingsCommonJson(settingsCommonText);
    return {
      settingsCommonText,
      mcpCommonWarnings: mcpParsed.warnings,
      settingsCommonWarnings: settingsParsed.warnings,
      mcpCommonServerNames: mcpCommonServerNames(mcpParsed.value),
      mcpCommonImportNotes: mcpImportNotes,
      // Base del compare-and-swap al guardar: los bytes reales, no el texto de arranque que devuelve
      // read*Text cuando el fichero no existe.
      settingsCommonBaseline: service.readBaseline(settingsCommonPath()),
    };
  });
  ipcMain.handle(IpcChannel.SharedConfigSave, (_e, params: SaveSharedConfigParams): SaveSharedConfigResult => {
    if (params.file !== 'settings-common') throw new Error(`Fichero de config compartida desconocido: ${String(params.file)}`);
    return getSharedConfigService().saveSettingsCommonText(settingsCommonPath(), params.text, params.expected);
  });

  // MCP y conectores (P-028 puntos 5 y 34).
  registerMcpIpc({
    handle: (channel, listener) => ipcMain.handle(channel, listener as Parameters<typeof ipcMain.handle>[1]),
    service: getSharedConfigService(),
    fs: { exists: existsSync, readFile: (path) => readFileSync(path, 'utf8'), listDir: (path) => readdirSync(path) },
    commonPath: mcpCommonPath,
    accounts: mcpAccountLocations,
    legacySharedPath: () => mcpFakeSourcesPath(LEGACY_SHARED_MCP_FILE) ?? join(homedir(), cliLogin.accounts.mainDirName, LEGACY_SHARED_MCP_FILE),
    desktopDirs: () => {
      const fake = mcpFakeSourcesPath('Claude');
      if (fake !== null) return existsSync(fake) ? [fake] : [];
      return resolveClaudeDesktopDirs({ platform: process.platform, env: process.env, homedir: homedir(), exists: existsSync, listDir: (path) => readdirSync(path) });
    },
    homedir: homedir(),
    pathSeparator: sep,
    probeStatuses: () => {
      const dirs = accountService.listAccounts().filter((a) => a.loginStatus === 'logged_in').map((a) => a.configDir);
      return probeMcpStatuses({ spawnProbe: spawnMcpStatusProbe, timeoutMs: MCP_STATUS_TIMEOUT_MS, pollMs: MCP_STATUS_POLL_MS, exitGraceMs: MODEL_PROBE_EXIT_GRACE_MS }, dirs);
    },
    authenticate: (accountDir, serverName) =>
      authenticateMcp({ spawnProbe: spawnMcpStatusProbe, openUrl: openMcpAuthUrl, timeoutMs: MCP_AUTH_TIMEOUT_MS, pollMs: MCP_AUTH_POLL_MS, exitGraceMs: MODEL_PROBE_EXIT_GRACE_MS }, accountDir, serverName),
  });

  // Mejora de prompt (M2.3): `claude -p` puntual con modelo barato. execFile (sin shell) captura el
  // stdout; windowsHide para no abrir una consola en Windows.
  //
  // El timeout NO se delega en la opcion `timeout` de execFile: esa mata solo el hijo DIRECTO, y este
  // `claude -p` levanta los servidores MCP de la cuenta y sus hooks igual que cualquier sesion. Con el
  // timeout nativo, un CLI colgado dejaba todos esos nietos vivos. Se usa un temporizador propio que
  // termina el ARBOL (mismo motivo y mismo modulo que AgentSession.stop).
  const promptService = new PromptService({
    resolveBinary: () => resolveClaudeBinary(),
    run: (command, args, env, cwd) =>
      new Promise<string>((resolvePromise, rejectPromise) => {
        const child = execFile(
          command,
          [...args],
          { env, cwd, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
          (err, stdout) => {
            clearTimeout(timer);
            if (err !== null) rejectPromise(err);
            else resolvePromise(stdout);
          },
        );
        const timer = setTimeout(() => {
          const outcome = killProcessTree(child, killTreeDeps);
          mainLog('warn', 'Timeout de una peticion puntual al CLI; arbol terminado', {
            timeoutMs: PROMPT_RUN_TIMEOUT_MS,
            pid: child.pid,
            outcome,
          });
          rejectPromise(new Error(`El CLI no respondio en ${PROMPT_RUN_TIMEOUT_MS} ms`));
        }, PROMPT_RUN_TIMEOUT_MS);
        // El CLI espera datos por stdin unos segundos antes de seguir ("no stdin data received in 3s"):
        // no le vamos a mandar nada, asi que se cierra ya y arranca sin esperar.
        child.stdin?.end();
      }),
  });
  ipcMain.handle(IpcChannel.PromptImprove, (_e, params: ImprovePromptParams): Promise<string> =>
    promptService.improve(params.draft, params.accountDir),
  );
  ipcMain.handle(IpcChannel.PromptHandoff, (_e, params: HandoffPromptParams): Promise<string> => {
    // El handoff reanuda la sesion con el config dir EFECTIVO, que en una conversacion privada es el
    // perfil privado: hay que convergir sus credenciales antes de spawnear igual que al crear la
    // sesion, o el CLI arrancaria con el token que quedo divergido tras el ultimo refresh.
    accountService.ensureCredentialsFor(params.accountDir);
    return promptService.handoff(params);
  });

  // Notificacion del SO (M2.3): solo si la ventana NO tiene el foco (si el usuario ya esta mirando,
  // seria ruido). Requiere soporte del SO (Notification.isSupported).
  // P-028 40: el foco que cuenta es el de la ventana QUE LA PIDIO, y el clic lleva a su conversacion.
  ipcMain.handle(IpcChannel.NotifyShow, (e, params: NotifyParams) => {
    notificationCenter.show(params, senderWindowId(e));
  });

  // Widget flotante (M3). SetEnabled abre/cierra la ventana (la preferencia la persiste el renderer).
  // Update recibe el snapshot del renderer principal y lo empuja a la ventana (no-op si no existe).
  // ActivateTab (desde el widget) enfoca la principal y le reenvia el tabId para activar la pestana.
  ipcMain.handle(IpcChannel.WidgetSetEnabled, (_e, enabled: boolean) => {
    if (enabled) getWidgetWindow().open();
    else getWidgetWindow().close();
    // Se avisa SIEMPRE del nuevo estado, no solo cuando la ventana se cierra por fuera: el ✕ del propio
    // widget llega por aqui, y sin este eco Configuracion seguia mostrando el widget como activo (E4).
    notifyWidgetEnabledChanged(enabled);
  });
  ipcMain.on(IpcChannel.WidgetUpdate, (_e, snapshot: WidgetSnapshot) => {
    getWidgetWindow().pushSnapshot(snapshot);
  });
  ipcMain.on(IpcChannel.WidgetActivateTab, (_e, tabId: string) => {
    // El widget refleja el estado del renderer PRINCIPAL, asi que la pestaña se activa alli.
    if (!windowManager.focus(MAIN_WINDOW_ID)) return;
    liveMainWindow()?.webContents.send(WIDGET_FOCUS_TAB_CHANNEL, tabId);
  });

  // Mercado de temas Open VSX (M3): buscar y traer un tema de color de VS Code (colores crudos; el
  // mapeo a los tokens de Mage lo hace el renderer).
  ipcMain.handle(IpcChannel.ThemeMarketSearch, (_e, query: string, offset?: number) => themeMarketService.search(query, offset ?? 0));
  ipcMain.handle(IpcChannel.ThemeMarketFetch, (_e, params: FetchThemeParams) => themeMarketService.fetchTheme(params));

  // Renderer principal -> LogBus: reenvio de su consola/errores (source 'renderer').
  ipcMain.on(DebugChannel.RendererLog, (_e, input: RendererLogInput) => {
    logBus.publish('renderer', input.level, input.message, input.data);
  });
}

// CSP como cabecera de respuesta (recomendacion de seguridad de Electron). En dev se relaja para
// permitir el WebSocket de HMR y el refresh de React; en produccion queda estricta.
// Desde la Fase 9.2 Mage ya NO aloja ninguna pagina de login: el alta la hace el CLI y la pagina de
// Anthropic se abre en el navegador del usuario, fuera de la app. Asi que aqui no hay excepcion que
// hacer — la CSP de `session.defaultSession` cubre todo lo que Mage renderiza.
function applyContentSecurityPolicy(): void {
  const devPolicy =
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: http: https:;";
  const prodPolicy =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; connect-src 'self';";
  const policy = isDev ? devPolicy : prodPolicy;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [policy] },
    });
  });
}

// Controlador del widget flotante (M3), perezoso. onClosed: si la ventana se cierra por fuera del
// renderer (cierre del SO), avisa al renderer principal para apagar la preferencia (unico escritor
// de settings). El fondo se resuelve por tema (sin re-fijar la UI nativa, ya lo hace la principal).
function getWidgetWindow(): WidgetWindowController {
  if (widgetWindow === null) {
    widgetWindow = new WidgetWindowController(
      preloadPath,
      process.env['ELECTRON_RENDERER_URL'],
      rendererDir,
      () => resolveThemeBackgroundColor(),
      () => notifyWidgetEnabledChanged(false),
    );
  }
  return widgetWindow;
}

// Notifica al renderer principal que la preferencia del widget cambio fuera de el (toggle del tray o
// cierre de la ventana). El renderer actualiza su estado y persiste; asi hay un unico escritor de
// settings (evita una carrera de escritura del fichero entre main y renderer).
function notifyWidgetEnabledChanged(enabled: boolean): void {
  // A TODAS las ventanas: `widgetEnabled` es un ajuste compartido y el checkbox de Configuracion
  // existe en cada una.
  windowManager.broadcast(WIDGET_ENABLED_CHANGED_CHANNEL, enabled);
}

// Abre (o enfoca) la ventana de debug. Solo tiene efecto en dev: se crea perezosamente.
function openDebugWindow(): void {
  if (!isDev) return;
  if (debugWindow === null) {
    debugWindow = new DebugWindowController(
      logBus,
      preloadPath,
      process.env['ELECTRON_RENDERER_URL'],
      rendererDir,
    );
  }
  debugWindow.open();
}

// --- Jump list de Windows (Ronda 3, item 10) -----------------------------------------------------
//
// No-op fuera de Windows con el mismo patron que chmod600: es una afordancia de la barra de tareas de
// Windows y no se ha pedido el equivalente de macOS (app.dock.setMenu). Nunca lanza hacia fuera: una
// jump list que no se puede pintar no puede tumbar el arranque ni un guardado de estado.
// Ultimo refresco de la jump list (ms epoch). El foco de ventana la dispara, y en un alt-tab seguido
// eso son varias pasadas por segundo sobre un escaneo de disco que cuesta cientos de ms.
let lastJumpListAtMs = 0;

function refreshJumpList(): void {
  if (process.platform !== 'win32') return;
  const nowMs = Date.now();
  if (nowMs - lastJumpListAtMs < JUMP_LIST_MIN_INTERVAL_MS) return;
  lastJumpListAtMs = nowMs;
  try {
    const accounts = accountService.listAccounts().map((account) => ({ configDir: account.configDir, alias: account.name }));
    // Las cuentas comparten `projects/` por junction: sin deduplicar, el mismo directorio se
    // escanea una vez POR CUENTA (medido: 4 cuentas, 868 ficheros, 3/4 del trabajo repetido). Se
    // resuelve la ruta real y se salta la que ya se vio; un fallo de realpath no puede tumbar la
    // jump list, asi que esa cuenta se escanea sin deduplicar en vez de perderse.
    const seenProjectDirs = new Set<string>();
    const conversations = accounts.flatMap((account) => {
      const projectsDir = join(account.configDir, 'projects');
      let key = projectsDir;
      try {
        key = realpathSync(projectsDir);
      } catch {
        key = projectsDir;
      }
      if (seenProjectDirs.has(key)) return [];
      seenProjectDirs.add(key);
      return conversationsService.listConversations(account.configDir).map((conversation) => ({
        sessionId: conversation.sessionId,
        title: conversation.title,
        accountDir: account.configDir,
        updatedAtMs: conversation.updatedAtMs,
      }));
    });
    // Las "cuentas mas usadas" se aproximan contando `accountId` en las pestañas persistidas de TODAS
    // las ventanas abiertas: con varias, mirar solo la principal daba una cuenta por vista.
    const tabAccountIds = windowManager
      .list()
      .flatMap((windowId) => (getWorkspaceStore(windowId).load()?.tabs ?? []).map((tab) => tab.accountId));
    const categories = buildJumpListCategories({ accounts, conversations, tabAccountIds }, process.execPath);
    // Cast: el modulo puro declara su propia forma (sin importar electron) — es estructuralmente la
    // que espera setJumpList, pero con arrays readonly.
    app.setJumpList(categories as unknown as Electron.JumpListCategory[]);
  } catch (err) {
    mainLog('warn', 'No se pudo actualizar la jump list', { error: err instanceof Error ? err.message : String(err) });
  }
}

// Atiende el clic en una entrada de la jump list: el proceso relanzado se rinde por el lock de
// instancia unica y su argv llega aqui. Main RESUELVE la conversacion en disco antes de mandarla, asi
// que el renderer nunca tiene que fiarse de lo que venia en la linea de comandos.
function handleJumpListArgv(argv: readonly string[]): void {
  const request = parseJumpListArgs(argv);
  if (request === null) return;
  // El argv viene de FUERA (cualquier proceso local puede lanzar `Mage.exe --mage-account=<ruta>`, y
  // la instancia unica lo reenvia a la viva), asi que la cuenta se valida aqui — si no, main se ponia
  // a escanear `<ruta>/projects/**` de un directorio arbitrario y luego se lo mandaba al renderer.
  if (!isManagedAccountConfigDir(request.accountDir)) return;
  focusMainWindow();
  const conversation =
    request.sessionId === undefined
      ? undefined
      : conversationsService.listConversations(request.accountDir).find((c) => c.sessionId === request.sessionId);
  const payload: JumpListOpenPayload = { accountDir: request.accountDir, ...(conversation === undefined ? {} : { conversation }) };
  liveMainWindow()?.webContents.send(JUMP_LIST_OPEN_CHANNEL, payload);
}

// Trae la ventana principal al frente (restaurandola o recreandola si hacia falta).
function focusMainWindow(): void {
  windowManager.ensureMain();
  windowManager.focus(MAIN_WINDOW_ID);
}

// INSTANCIA UNICA (grupo G). Dos instancias de Mage escriben a la vez los mismos ficheros de estado
// bajo userData (workspace-state.json, app-settings.json): la ultima en renombrar gana y el usuario
// pierde pestanas o configuracion sin ver un error. Ademas duplicaria tray y widget. Si ya hay una
// instancia, esta se cierra y la existente se enfoca (comportamiento estandar de escritorio).
// El lock se pide ANTES de whenReady: cuanto menos haya arrancado la segunda instancia, mejor.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  // Se dice EN VOZ ALTA por que se cierra. Sin esta linea, la segunda instancia se rendia en silencio y
  // lo unico que se veia era la ventana de la instancia VIEJA saltando al frente: quien lanzaba
  // `pnpm dev` con la app instalada abierta concluia "el dev no aplica mis cambios" (paso de verdad).
  // Dev y la version instalada comparten `userData` (%APPDATA%/mage, y Windows no distingue mayusculas),
  // asi que comparten tambien este lock.
  console.error(
    '[mage] Ya hay otra instancia de Mage con este perfil: esta se cierra y se enfoca la existente. ' +
      'Si esperabas ver tus cambios, cierra la otra (incluido el icono del tray) o arranca con ' +
      '--user-data-dir=<carpeta propia>.',
  );
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // Otro proceso intento arrancar Mage: traer al frente la ventana de esta instancia (restaurando
    // si estaba minimizada, y recreandola si el usuario la habia cerrado al tray). Si ademas venia de
    // la jump list, su argv dice QUE abrir.
    focusMainWindow();
    handleJumpListArgv(argv);
  });
}

app.whenReady().then(async () => {
  // Guarda: si no se obtuvo el lock ya se llamo a app.quit(); no se arranca nada mas (registrar IPC o
  // el gateway desde una instancia que se esta cerrando solo crea efectos a medias).
  if (!gotSingleInstanceLock) return;

  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? WINDOWS_APP_USER_MODEL_ID : process.execPath);
  applyContentSecurityPolicy();
  Menu.setApplicationMenu(buildApplicationMenu());
  registerIpcHandlers();
  // Antes de la primera ventana: la primera sesion ya tiene que recibir los MCP importados.
  importSharedMcpOnce();

  // Iniciar local proxy gateway para multi-proveedor
  try {
    // Antes de arrancarlo: sus avisos (lineas ilegibles del proveedor, respuestas sin contadores de
    // tokens) van al LogBus en vez de perderse en un catch mudo.
    setGatewayLogger((level, message, data) => logBus.publish('engine', level, message, data));
    // Proveedores del usuario (E2): se LEEN DEL DISCO en cada peticion, no se cachea un registro de
    // arranque, asi anadir o editar un proveedor en Configuracion aplica al siguiente turno sin
    // reiniciar (mismo criterio que loadSharedConfigArgs).
    setCustomProviderLoader(() => getSettingsStore().load().customProviders);
    const port = await startGateway();
    mainLog('info', 'Local proxy gateway arrancado', { port });
  } catch (err) {
    mainLog('error', 'No se pudo arrancar el local proxy gateway', { error: err instanceof Error ? err.message : String(err) });
  }

  const mainWindow = windowManager.ensureMain();
  tray = createTray();
  // Catalogo de modelos real de cada cuenta con sesion (P-026 2.4, D7), con la ventana ya abierta.
  // `pnpm verify:gui` lo apaga: su contrato es no lanzar nunca el CLI.
  if (process.env.MAGE_SKIP_MODEL_PROBE !== '1') setTimeout(probeLoggedInAccounts, MODEL_PROBE_START_DELAY_MS).unref();
  mainLog('info', 'Mage arrancado', { isDev, platform: process.platform });

  // Widget flotante (M3): reabrir al arrancar si la preferencia persistida estaba activa.
  if (getSettingsStore().load().widgetEnabled) getWidgetWindow().open();

  if (isDev) {
    // La ventana de debug NO se auto-abre al arrancar (molesta); se abre a demanda con el atajo.
    globalShortcut.register('CommandOrControl+Shift+L', openDebugWindow);
  }

  // Scratchpads (B.4.2): un pase al arrancar y otro cada 24 h, como hace Claude Code con sus propias
  // limpiezas (reprograma cada 24 h para las sesiones que duran dias). No-op con la politica por
  // defecto ('never'). `unref` para que el temporizador no sea motivo de que el proceso siga vivo.
  sweepScratchDirs();
  setInterval(sweepScratchDirs, SWEEP_INTERVAL_MS).unref();

  // Auto-update (B2): no-op si la app no esta empaquetada. Comprueba con margen tras el arranque,
  // descarga en segundo plano y solo entonces pregunta al usuario con un dialogo nativo. Sus fallos
  // van al LogBus (nunca rompen el arranque ni pintan nada en la UI).
  startAutoUpdate(mainLog, () => liveMainWindow());

  // Jump list (Ronda 3, item 10): al arrancar, y de nuevo cada vez que la ventana recupera el foco
  // (las conversaciones recientes cambian mientras el usuario trabaja). El clic que abrio ESTA
  // instancia, si vino de la jump list, se atiende cuando el renderer ya esta cargado.
  refreshJumpList();
  mainWindow.webContents.once('did-finish-load', () => handleJumpListArgv(process.argv));
  // El refresco al recuperar el foco lo engancha `createWorkbenchWindow` para CADA ventana.

  app.on('activate', () => {
    // macOS: la app sigue viva sin ventanas (el dock la reabre). Solo se trae la principal si no
    // queda ninguna A LA VISTA —el boton rojo la oculta, no la destruye—; con varias abiertas esto no
    // toca nada.
    if (visibleWorkbenchWindowCount() === 0) focusMainWindow();
  });
});

// En macOS es habitual seguir vivo sin ventanas; en Win/Linux el tray mantiene la app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // No salimos: el tray mantiene Mage residente. (El menu del tray ofrece "Salir".)
  }
});

// Al salir, matar todos los procesos hijo del motor (no dejar agentes huerfanos) y limpiar dev.
app.on('before-quit', () => {
  // Lo primero: a partir de aqui ninguna ventana pregunta al cerrarse (ver `resolveCloseAction`).
  isQuitting = true;
  sessionManager.stopAll();
  // Incognito ('session'): las carpetas de trabajo no sobreviven a la ejecucion. Se barre aqui ADEMAS
  // de al arrancar, porque si no quedarian en el temp todo el tiempo que la app este cerrada — que es
  // justo lo que esa politica promete evitar.
  sweepScratchDirs();
  for (const controller of openTranscriptControllers.values()) controller.abort();
  openTranscriptControllers.clear();
  stopGateway();
  debugWindow?.dispose();
  widgetWindow?.dispose();
  if (isDev) globalShortcut.unregisterAll();
});

// Referencia para que el linter no marque `tray` como no usado; el tray debe vivir toda la sesion.
void tray;
