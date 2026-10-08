import { create } from 'zustand';
import { applyCodexConfirmation, confirmCodexAccounts } from './codexAccountConfirmation';
import { defaultEffortForProvider, defaultModelForProvider, effortSettingKey, providerFallbackModel, providerModels, type ApiKeyUpdate } from './models';
import type { PersistedTab } from '@shared/state';
import { disposeTranscriptStore, transcriptStoreForTab } from './transcriptStore';
import type { ContextUsage, MageEvent, McpServerStatus, PermissionDecision, PermissionRequest, SlashCommandInfo, SubagentInfo } from '@shared/events';
import { buildUpdatedInput, parseAskUserQuestion } from '@shared/askUserQuestion';
import type { CloseAnswer, NotificationTarget, PermissionMode, PermissionModesByProviderView, SessionEventPayload } from '@shared/ipc';
import { hasPermissionModes, permissionCycleForProvider } from './stepSliderModel';
import { IDLE_UPDATE_STATE, type UpdateState } from '@shared/update';
import { isPermissionMode, MAIN_WINDOW_ID, PERMISSION_MODES } from '@shared/ipc';
import { RELEASE_NOTES_TAB_ID, releaseNotesDecision } from './releaseNotes';
import type { AgyUsageSnapshot, UsageInfo } from '@shared/usage';
import type { StatusInfo } from '@shared/status';
import { applyAccentOverrides, toAccountView } from './accountView';
import { nextIndexForArrow } from './a11y/keyboardNav';
import { canChangeCwd } from './cwdChange';
import { toUsageWindows } from './usageView';
import {
  answerQuestionBlock,
  appendSubagentBlock,
  appendThinkingDelta,
  applySubagentResult,
  applySubagentUpdate,
  closeThinking,
  appendDelta,
  appendErrorBlock,
  appendQuestionBlock,
  appendSystemBlock,
  appendCommandOutputBlock,
  appendToolUse,
  appendUserBlock,
  applyToolResult,
  cancelQuestionBlock,
  closeStreaming,
  hasQuestionBlock,
  appendPermissionBlock,
  hasPermissionBlock,
  mapPermissionToView,
  resolvePermissionBlock,
  restartingText,
  turnUsageText,
} from './engineBlocks';
import { addAlwaysAllow, isAlwaysAllowed, prTurnBlockReason, removeAlwaysAllow } from './permissionRules';
import { createPrActions, CREATE_PR_PROMPT, resetPrActionsState, type PrActions, type PrState } from './prActions';
import { isPrCreateCommand, prNumberFromCreatedTag, prNumberFromUrl } from './prBinding';
import { worktreeOfCwd } from '@shared/worktree';
import { createdFileFrom } from './createdFilesView';
import { enqueueMessage, mergeIntoDraft, removeQueuedMessage as withoutQueuedMessage, takeNextMessage, type QueuedMessage } from './messageQueue';
import type { Account, AccountSwitchPrompt, Block, ChatStatus, ContextInfo, ImageAttachment, PermissionView, PromptDraft, RateLimitNotice, SessionExtensions, Tab } from './types';
import type { ConversationPrivacy } from '@shared/state';
import type { ConversationSummary } from '@shared/conversations';
import { planOpenConversation, tabFromConversation } from './conversationList';
import { modelForReassignedTab, planAccountSwitch } from './accountSwitch';
import { importedConversationContext } from './conversationContext';
import {
  AUTO_CONTINUE_POLL_MS,
  AUTO_CONTINUE_TEXT,
  effectiveResetMs,
  mergeRateLimitNotice,
  RATE_LIMIT_LINE,
  rateLimitLineText,
  shouldAutoContinue,
} from './rateLimit';
import { restoreTabs, toPersistedWorkspace } from './workspaceView';
import { tabsToCloseAll, tabsToCloseInactive } from './tabActions';
import {
  BACKGROUND_TTL_MS,
  backgroundMoveBlockedReason,
  nextBackgroundState,
  shouldBackgroundOnClose,
  tabMoveBlockedReason,
  type BackgroundSession,
} from './backgroundWork';
import type { DropZone, SplitPath } from './splitLayout';
import {
  activateTab,
  addTabToLeaf,
  applyDrop,
  findLeafPath,
  firstLeafPath,
  leafAt,
  reconcileSplitLayoutAfterClose,
  resizeAt,
  singleLeaf,
  visibleTabIds,
} from './splitLayout';
import type { SplitLayout } from '@shared/state';
import { inAppNoticeForEvent, notificationForEvent, toNotifyParams } from './notify';
import { notify, reportActionError } from './notificationStore';
import { resolveNotificationTarget } from './notificationTarget';
import { noticeTextFor } from './cliNotices';
import { SUBAGENT_TOOL_NAMES } from './toolSummary';
import { classifySystemWrapper } from '@shared/systemWrappers';
import type {
  AppSettings,
  ChatProject,
  CloseBehavior,
  DefaultPermissionMode,
  ImportedTheme,
  NewConversationFolder,
  NotificationRule,
  ScratchRetention,
  ThemePreference,
} from '@shared/settings';
import { clampUiScale, DEFAULT_APP_SETTINGS, IMPORTED_CONTEXT_LIMITS, DEFAULT_PERMISSION_MODES, ONBOARDING_VERSION, RUNTIME_SHELLS, type RuntimeShell } from '@shared/settings';
import type { ToolAccessRule } from '@shared/toolAccess';
import { setAgyCommandVerdict, type AgyCommandVerdict } from '@shared/agyRules';
import { AGY_PROVIDER_ID, CODEX_PROVIDER_ID, runsOnMageRuntime, writesClaudeTranscript, type CustomProvider, type ProviderModel } from '@shared/providers';
import { applyBackgroundOpacity, applyThemeFromSettings, findActiveImportedTheme, resolveTheme, systemPrefersDark } from './theme';
import { toWidgetSnapshot } from './widgetView';
import { deriveTitleFromPrompt, isPlaceholderTitle, isSlashCommandText, NEW_CONVERSATION_TITLE, renamedTitleFrom } from './conversationTitle';
import { resolveDefaultModel } from './modelDefaults';
import { resolveReopenedTabPrefs, toConversationPrefs } from './conversationPrefs';
import type { ConversationPrefs } from '@shared/conversationIndex';
import type { MageApi } from '@shared/ipc';
import type { AccountProviderId } from '@shared/accounts';
import type { ElicitationAnswer, ElicitationRequest } from '@shared/elicitation';
import type { GitSnapshot } from '@shared/git';
import { canSwitchBranch } from './canSwitchBranch';
import { recentProjects, RECENT_PROJECTS_LIMIT } from './recentProjects';
import { projectForRow } from './chatProjects';
import { isWindowsPlatform } from './keybindings/platform';

// Contexto en placeholder hasta M1.3 (el uso/contexto real llega con UsageService).
const CONTEXT_PLACEHOLDER: ContextInfo = { usedTokens: '—', maxTokens: '200k', usedPct: 0, tokensOut: '—' };

// Estado del workbench. Cuentas y pestanas son REALES (M1.2): las cuentas se descubren en disco via
// window.mage.listAccounts (mapeadas con toAccountView) y cada pestana es una conversacion ligada a
// {cuenta, proyecto, modelo} con su AgentSession aislada. El estado del motor va keyed por id de
// pestana (un chat = una pestana): asi anadir pestanas no obliga a refactorizar el reducer.
// Exportado junto con `reduceEvent` para poder testear el reducer con un estado de mentira.
export interface WorkbenchState extends PrState, PrActions {
  accounts: readonly Account[];
  tabs: readonly Tab[];
  activeAccountId: string;
  activeTabId: string;
  // Arbol de division del centro (Ronda 3 item 13, generalizado a N paneles en I11): una hoja =
  // `activeTabId` (SIEMPRE visible en algun lado) es un panel unico; un nodo de division ('row' = uno
  // al lado del otro, 'col' = uno encima del otro) puede anidar a su vez otra division.
  splitLayout: SplitLayout;
  readonly context: ContextInfo;
  newTabOpen: boolean; // dialogo de nueva pestana (selector cuenta/proyecto/modelo) abierto
  addAccountOpen: boolean; // dialogo de alta de cuenta (crear + login) abierto
  handoffOpen: boolean; // modal de prompt handoff (preview + copiar / nuevo chat) abierto
  settingsOpen: boolean; // pantalla de Configuracion de la app (M2.3) abierta
  // Seccion con la que se abre Configuracion (P-028, 41: «Añadir cuenta» del gateway lleva a
  // «Proveedores y modelos»). null = la de siempre. La valida SettingsView contra su lista.
  settingsSection: string | null;
  // Version que enseña la pestaña de novedades; null = la instalada (el caso del arranque).
  releaseNotesVersion: string | null;
  // Version de Mage instalada ('' hasta que el arranque la pregunta a main).
  appVersion: string;
  // Configuracion de la app (M2.3): se carga en init(); defaults hasta entonces.
  readonly settings: AppSettings;
  // Modos de permiso que expone cada CLI (respuesta 18); null hasta leerlos (o si no contestan).
  readonly permissionModes: PermissionModesByProviderView | null;
  // Contador que pide FOCO para el input del prompt (extras): cada incremento hace que el PromptBar se
  // enfoque. Un contador (y no un booleano) evita tener que "consumir" el flag.
  promptFocusToken: number;

  // --- Uso y estado (M1.3) ---
  // Uso real por cuenta (keyed por configDir). null mientras no se ha cargado.
  readonly usageByAccount: Readonly<Record<string, UsageInfo | null>>;
  // Ultimo error de consulta de uso por cuenta (p.ej. "sin login"), para mostrarlo en el dashboard.
  readonly usageErrorByAccount: Readonly<Record<string, string | null>>;
  // `/usage` de cada cuenta de agy por suscripción (su CLI da cuotas por grupo de modelos, no ventanas de Mage), por id de cuenta.
  readonly agyUsageByAccount: Readonly<Record<string, AgyUsageSnapshot>>;
  // Estado del servicio de Claude (global). null mientras no se ha cargado.
  readonly status: StatusInfo | null;

  // --- Estado del motor (keyed por id de pestana) ---
  readonly blocksByChat: Readonly<Record<string, readonly Block[]>>;
  readonly sessionIdByChat: Readonly<Record<string, string>>;
  readonly streamingIdByChat: Readonly<Record<string, string | null>>;
  readonly statusByChat: Readonly<Record<string, ChatStatus>>;
  // Peticiones de permiso PENDIENTES, en orden de llegada. Es una COLA y no un hueco: el modelo lanza
  // tools en paralelo y el CLI manda un can_use_tool por cada una sin esperar a la anterior. Con un solo
  // hueco, la segunda pisaba a la primera y esta se quedaba sin nadie que la contestara: el turno
  // colgado para siempre (medido el 2026-09-28 con dos `Read` en modo Manual). Cada tarjeta contesta la
  // SUYA por requestId; el panel y los atajos, la primera (`headPermission`).
  readonly pendingByChat: Readonly<Record<string, readonly PendingPermission[]>>;
  // Feedback de actividad (M2.6): inicio del turno y ultima señal del motor, por pestana (ms epoch).
  // El indicador de "pensando" muestra el tiempo transcurrido y detecta inactividad (posible cuelgue).
  readonly turnStartByChat: Readonly<Record<string, number>>;
  readonly lastActivityByChat: Readonly<Record<string, number>>;
  // Comandos "/" REALES que la sesion declaro en su arranque (D4), por pestana. Se rellena con los
  // nombres del `session_init` y se enriquece con las descripciones de la respuesta al `initialize`
  // (D2). Vacio hasta entonces; el autocompletado cae mientras a la lista curada.
  readonly slashCommandsByChat: Readonly<Record<string, readonly SlashCommandInfo[]>>;
  // Modelos que el CLI publico para cada config dir (P-026 2.4): la sesion viva lo actualiza y, antes,
  // la cache del sondeo de arranque. Vacio -> el selector usa la lista de reserva.
  readonly modelCatalogByAccount: Readonly<Record<string, readonly ProviderModel[]>>;
  // Subagentes que el CLI declara en la respuesta al `initialize`, por pestaña. Los consume la Fase F
  // (panel "Subagentes"); aqui solo se guardan, que es lo que abre la Fase B.
  readonly subagentsByChat: Readonly<Record<string, readonly SubagentInfo[]>>;
  // Ocupacion REAL de la ventana de contexto que reporta el CLI al cerrar cada turno (D3), por
  // pestana. Ausente hasta el primer `result`; entonces el Inspector la prefiere al calculo derivado
  // de la transcripcion (que no ve el system prompt, las tools, las skills ni la memoria).
  readonly contextUsageByChat: Readonly<Record<string, ContextUsage>>;
  // Servidores MCP que la sesion REALMENTE cargo (mcp_servers del `session_init`, D1 Fase 2), por
  // pestana. Antes se descartaba: alimenta la pestaña "MCP" del Inspector (comun vs propio).
  readonly mcpServersByChat: Readonly<Record<string, readonly McpServerStatus[]>>;
  // Herramientas que la sesion cargo de verdad (`tools` del `session_init`), por pestana. Alimenta el
  // panel "Herramientas": hasta ahora el CLI mandaba la lista y Mage se quedaba solo con el numero.
  readonly toolsByChat: Readonly<Record<string, readonly string[]>>;
  // Skills y plugins que la sesion cargo DE VERDAD (P-026 2.6), para el Inspector: el perfil privado no
  // cargaba ninguna skill de plugin y nada lo decia.
  readonly extensionsByChat: Readonly<Record<string, SessionExtensions>>;
  // Panel de Actividad (P-026 3.4): subagente por el que filtra cada pestaña (su `tool_use_id`). Sin
  // entrada, el panel enseña todos los pasos.
  readonly activitySubagentByChat: Readonly<Record<string, string>>;
  // Abre el panel de Actividad, filtrado a un subagente o sin filtro (null).
  openActivity: (tabId: string, subagentToolUseId: string | null) => void;
  // Subagentes que el usuario quito del dock (P-028 37c), por su `tool_use_id`. Solo del DOCK: siguen en
  // el panel y en Actividad. Sin persistir, y vuelven en cuanto el CLI cuenta algo nuevo de ellos (se
  // pueden reanudar con SendMessage, asi que «no va a volver» nunca es seguro).
  readonly dismissedSubagentsByChat: Readonly<Record<string, readonly string[]>>;
  dismissSubagents: (tabId: string, toolUseIds: readonly string[]) => void;
  // Git de la carpeta de cada conversacion (P-026 3.5), por CARPETA: dos pestañas del mismo repo ven lo
  // mismo. Se refresca por eventos (activar, acabar un turno, volver el foco, cambiar de rama).
  readonly gitByCwd: Readonly<Record<string, GitView>>;
  refreshGit: (tabId: string) => Promise<void>;
  switchGitBranch: (tabId: string, name: string) => Promise<void>;
  // D27: deja en el input el prompt de commit, SIN enviarlo.
  insertCommitPrompt: (tabId: string) => void;
  // Worktrees (grupo D): la casilla de antes del primer mensaje y «Traer la base» (merge, nunca rebase).
  setWorktreeOff: (tabId: string, off: boolean) => void;
  mergeBaseIntoWorktree: (tabId: string, base: string) => Promise<'merged' | 'conflict'>;
  // Lo que el usuario lleva escrito y aun no ha enviado, POR PESTAÑA (auditoria B.1.2). Vivia como
  // estado local del `PromptBar`, que no se remonta al cambiar de pestaña: el borrador de A acababa
  // enviado a B. Aqui cada conversacion conserva el suyo (texto y adjuntos) mientras paseas entre
  // ellas, que es justo el caso de uso de Mage. NO se persiste entre arranques: los adjuntos son
  // imagenes en base64 y engordarian el estado del workspace sin que nadie lo haya pedido.
  readonly draftByChat: Readonly<Record<string, PromptDraft>>;
  // Mensajes enviados con un turno en marcha, POR PESTAÑA (0.1.1 R2, punto 30): esperan aqui, no en el
  // stdin del CLI, y salen de uno en uno al acabar cada turno. No se persisten, como el borrador.
  readonly queuedByChat: Readonly<Record<string, readonly QueuedMessage[]>>;
  // Modelo REAL con el que arranco la sesion (`session_init.model`, p.ej. `claude-sonnet-5`), por
  // pestana. Los ids de Claude son ALIAS que apuntan a la ultima version de su familia, asi que esto es
  // lo unico que dice la version de verdad. Ausente hasta que hay sesion.
  readonly resolvedModelByChat: Readonly<Record<string, string>>;
  // RAIZ de los borradores de la app. Se resuelve una vez y se cachea: sirve para reconocer que el cwd
  // de una conversacion "sin friccion" es el scratchpad y no un UUID sin sentido. La raiz y no
  // `getScratchDir`, que acuña una carpeta NUEVA en cada llamada y devolveria un hermano.
  readonly scratchDir: string | null;

  // Limite de uso alcanzado en esta conversacion (H4), por pestana. Ausente = no hay limite pendiente.
  // Se guarda APARTE de la linea de sistema que ya va al hilo porque no es lo mismo contar lo que paso
  // que ofrecer la salida: mientras esta puesto, el chat ofrece continuar en otra cuenta.
  readonly rateLimitByChat: Readonly<Record<string, RateLimitNotice>>;

  // Carpetas esperando a que el usuario diga si confia en ellas (una por dialogo, en orden). Se pinta
  // la primera; el resto espera. Ver `ensureFolderTrusted`.
  readonly trustRequests: readonly string[];

  // --- Historial de conversaciones en disco (M2.6, sidebar = historial) ---
  readonly conversationHistory: readonly ConversationSummary[];
  readonly elicitationsByChat: Readonly<Record<string, readonly { readonly request: ElicitationRequest; readonly state: 'pending' | 'accept' | 'decline' | 'cancel' }[]>>;
  answerElicitation: (tabId: string, answer: Omit<ElicitationAnswer, 'sessionId'>) => Promise<void>;
  saveChatProject: (project: ChatProject) => Promise<void>;
  deleteChatProject: (projectId: string) => void;
  assignChatProject: (sessionId: string | undefined, tabId: string | undefined, projectId: string | null) => void;

  // Sesiones que siguen VIVAS sin pestaña (decision del usuario, 2026-09-15: cerrar no corta el
  // trabajo), por sessionId. NO se persiste: al cerrar Mage mueren todos los CLI, asi que un mapa
  // restaurado del arranque anterior solo prometeria procesos que ya no existen.
  readonly backgroundSessions: Readonly<Record<string, BackgroundSession>>;

  // Grupo B: main pidio a esta ventana el dialogo «¿Cerrar Mage?» y espera la respuesta.
  closePromptOpen: boolean;
  // Estado de la actualizacion que difunde main (el indicador de la barra de estado lo pinta).
  updateState: UpdateState;
  // Version cuyo dialogo de «lista para instalar» esta abierto en esta ventana; null = cerrado.
  updatePromptVersion: string | null;

  // --- Acciones de UI ---
  setActiveAccount: (accountId: string) => void;
  // Clic en otra cuenta de la cabecera (P-026 2.7, D5): decide con `planAccountSwitch` si solo cambia,
  // si abre un chat nuevo en la destino (turno en marcha) o si pregunta si migrar la conversacion.
  requestAccountSwitch: (destAccountId: string) => void;
  // Pregunta pendiente de «¿migrar la conversacion?»; null sin dialogo.
  readonly accountSwitchPrompt: AccountSwitchPrompt | null;
  closeAccountSwitchPrompt: () => void;
  setActiveTab: (tabId: string) => void;
  // Devuelve una promesa que resuelve cuando el CLI de esa pestaña YA ha parado (B17): quien borre
  // o mueva la conversacion despues tiene que esperarla o correra contra un fichero aun abierto.
  // `moved`: la pestaña se va a otra ventana, asi que su worktree NO se archiva (grupo D).
  closeTab: (tabId: string, options?: { readonly moved?: boolean }) => Promise<void>;
  // Cierra la pestana ACTIVA (D5, atajo tab.close): resuelve el id activo y delega en closeTab.
  closeActiveTab: () => void;
  // Menu contextual de pestañas (Ronda 3, item 12). Los cierres en masa respetan SIEMPRE las ancladas
  // (ver tabActions.ts) y reutilizan closeTab una a una — no hay un camino paralelo que se olvide de
  // parar la sesion o de limpiar el estado de motor de cada pestaña.
  closeAllTabs: () => void;
  closeInactiveTabs: () => void;
  // Saca una sesion del segundo plano y PARA su CLI: al reabrir la conversacion se corta y se reanuda
  // con `--resume` (decision del usuario), y tambien la usan el borrado/movido de conversacion (nadie
  // puede seguir escribiendo el .jsonl) y el temporizador de la semana.
  discardBackgroundSession: (sessionId: string) => Promise<void>;
  // Division del centro en N paneles (Ronda 3 item 13, generalizado en I11 y en I11-drag).
  // INVARIANTE: `activeTabId` es SIEMPRE la pestaña del panel ENFOCADO, con cualquier numero de
  // divisiones — por eso el dock, el sidebar, los atajos y el widget siguen funcionando sin cambios:
  // para ellos "la conversacion activa" no cambio de significado, solo se le anaden hermanos visibles
  // alrededor.
  // Suelta `draggedTabId` sobre el panel de `targetTabId` en `zone` (arrastre estilo VS Code/IntelliJ,
  // o el menu contextual "Dividir a la derecha/abajo/..." — misma accion, distinto disparador). La
  // pestaña arrastrada pasa a ser la enfocada: acabas de decidir donde quieres verla.
  // El destino es el CAMINO del panel, no una pestaña: con grupos, soltar sobre un panel significa
  // "a esta barra", y el panel puede tener varias.
  movePaneTab: (draggedTabId: string, targetPath: SplitPath, zone: DropZone) => void;
  // Pestaña nueva en ESA barra (el + de cada panel dividido).
  addTabToPane: (path: SplitPath) => Promise<void>;
  resizeSplitAt: (path: SplitPath, ratio: number, totalPx?: number) => void;
  toggleTabPinned: (tabId: string) => void;
  // `colorIndex` undefined -> vuelve al acento de la cuenta.
  setTabColor: (tabId: string, colorIndex: number | undefined) => void;
  // Cicla la pestana activa entre TODAS las abiertas (D5, atajos tab.next/tab.previous), en el mismo
  // orden en que las pinta TabBar (sin filtrar por cuenta). No cambia la cuenta activa (igual que clicar
  // una pestana con el raton: TabBar tampoco lo hace).
  cycleTab: (direction: 'next' | 'previous') => void;
  // Alterna la visibilidad de 'conversations'/'permissions' EN SU ZONA ACTUAL del panelLayoutStore
  // (F6 Fase 4): estos dos nombres se conservan tal cual porque D5 (useGlobalKeybindings.ts, fuera de
  // alcance de este plan) ya los invoca por los atajos `app.toggleSidebar`/`app.toggleInspector`, y
  // StatusBar.tsx los usa igual — solo cambio que hacen POR DENTRO, delegan en el store de layout en
  // vez de mantener su propio booleano, asi que siguen funcionando aunque el usuario mueva esos
  // paneles a otra zona/borde.
  toggleSidebar: () => void;
  toggleInspector: () => void;
  // Pide foco para el input del prompt (nueva conversacion, cambio de pestana…).
  focusPrompt: () => void;
  // Clic en una notificacion del SO (P-028 40): lleva a su pestaña y al prompt o, si la pestaña ya no
  // esta, RESALTA su fila del historial (reabrirla cortaria la sesion viva en segundo plano).
  focusNotificationTarget: (target: NotificationTarget) => void;
  readonly highlightedSessionId: string | null;

  // --- Shell (cuentas y pestanas reales) ---
  init: () => void;
  refreshAccounts: () => Promise<void>;
  // Lee de la cache de main el catalogo de modelos de un config dir, si aun no esta en memoria.
  loadModelCatalog: (configDir: string) => Promise<void>;
  restoreWorkspace: () => Promise<void>;
  // MULTIVENTANA. La configuracion es compartida; el workspace (pestañas, paneles, cuenta activa) es
  // de cada ventana. Ver `src/main/windows/windowManager.ts`.
  openInNewWindow: (tabId: string) => Promise<void>;
  moveTabToWindow: (tabId: string, targetWindowId: string) => Promise<void>;
  adoptTab: (persisted: PersistedTab) => void;
  // P-028, 36. Se solto la pestaña fuera de su ventana: main decide por el cursor (otra ventana, una
  // nueva o nada) y, si se movio, se cierra aqui.
  dropTabOutside: (tabId: string) => Promise<void>;
  // Una fila del HISTORIAL en otra ventana (menu y arrastre). Si ya tiene pestaña aqui, se mueve esa.
  openConversationInNewWindow: (item: ConversationSummary) => Promise<void>;
  dropConversationOutside: (item: ConversationSummary) => Promise<void>;
  // Recoge lo que esperaba a esta ventana al abrirse (transporte "pull"). Tras restaurar el workspace.
  adoptPendingTabs: () => Promise<void>;
  // Pestaña nueva POR DEFECTO: carpeta temporal + valores por defecto, sin dialogo.
  openNewTab: () => void;
  // Camino secundario: el dialogo de nueva conversacion (elegir cuenta/carpeta/proveedor/modelo). Con
  // `path`, la pestaña que salga aterriza en ESE panel.
  openNewTabDialog: (path?: SplitPath) => void;
  // Ancla del panel que pidio la pestaña nueva: el `activeTabId` de esa hoja. Se guarda la pestaña y no
  // el camino a proposito — un camino se invalida si el arbol cambia con el dialogo abierto, una
  // pestaña se vuelve a localizar. `null` = la pidio la barra del panel enfocado.
  newTabAnchorTabId: string | null;
  closeNewTab: () => void;
  openAddAccount: () => void;
  closeAddAccount: () => void;
  openHandoff: () => void;
  closeHandoff: () => void;
  openSettings: (section?: string) => void;
  closeSettings: () => void;
  // Abre (o enfoca) la pseudo-pestaña de novedades en `version`, o en la instalada sin argumento.
  openReleaseNotes: (version?: string) => void;
  // Contesta el dialogo de cierre a main (que es quien oculta, sale o guarda «recordar»).
  answerClosePrompt: (answer: CloseAnswer) => void;
  // Abre el dialogo de «lista para instalar» de la actualizacion descargada (desde el indicador).
  openUpdatePrompt: () => void;
  // «Más tarde»: cierra el dialogo; el indicador sigue y se instala al cerrar Mage.
  dismissUpdatePrompt: () => void;
  // «Reiniciar ahora»: main cierra Mage e instala.
  installUpdate: () => void;
  // Arranque: si Mage se ha actualizado desde la ultima vez, abre las novedades (ver releaseNotes.ts).
  // `isDev` se inyecta para poder probar la regla (en Vitest `import.meta.env.DEV` siempre es true).
  showReleaseNotesIfUpdated: (isDev: boolean) => Promise<void>;
  // Sustituye las reglas de notificacion y persiste (debounce, mismo patron que el workspace).
  saveNotificationRules: (rules: readonly NotificationRule[]) => void;
  // Cambia la preferencia de tema: aplica al DOM al instante, recalcula resolvedTheme y persiste.
  setTheme: (pref: ThemePreference) => void;
  // Opacidad de los fondos, 50..100 (%). Aplica al DOM al instante y avisa a main para que ajuste el
  // material translucido de la ventana; persiste con el mismo debounce que el resto de ajustes.
  setBackgroundOpacity: (percent: number) => void;
  // Retencion de los scratchpads (auditoria B.4.2). Solo persiste: quien barre es el main, al arrancar,
  // cada 24 h y al salir.
  setScratchRetention: (retention: ScratchRetention) => void;
  // Que hace la X de la ventana principal (P-028, 17). Tambien lo escribe main desde su dialogo.
  setCloseBehavior: (behavior: CloseBehavior) => void;
  // Carpeta con la que nace «Nuevo chat» (P-028, 16).
  setNewConversationFolder: (folder: NewConversationFolder) => void;
  setImportedContextMaxChars: (chars: number) => void;
  // Escala de la interfaz (80..150 %). Se aplica al frame al instante y se persiste con debounce.
  setUiScale: (percent: number) => void;
  // Proveedor con el que se abre "Nueva conversacion".
  setDefaultProvider: (providerId: string) => void;
  setAccountAccent: (accountId: string, colorIndex: number | undefined) => void;
  // Conectores de claude.ai de una cuenta (C3-f): aplica a las sesiones que se abran despues.
  setClaudeAiConnectorsEnabled: (accountId: string, enabled: boolean) => void;
  // Comando de agy permitido, denegado o quitado (null). Se guarda al momento: agy lee sus reglas al lanzar.
  setAgyCommandVerdict: (command: string, verdict: AgyCommandVerdict | null) => void;
  // Carpetas extra que Mage enlaza en el perfil de agy (relativas a la casa del usuario).
  setAgyLinkedPaths: (paths: readonly string[]) => void;
  // Modo de permiso con el que arrancan las conversaciones nuevas de Claude (P-028 6); '' = el de la cuenta.
  setDefaultPermissionMode: (mode: DefaultPermissionMode) => void;
  // Shell de `Bash` en los proveedores del runtime propio (P-032, ficha D4). Aplica a sesiones nuevas.
  setRuntimeShell: (shell: RuntimeShell) => void;
  // Reglas de acceso a herramientas por modelo de un proveedor del runtime (§8.1 D10). [] las borra.
  setRuntimeToolAccess: (providerId: string, rules: readonly ToolAccessRule[]) => void;
  // Da por visto el asistente de primer arranque (o lo vuelve a abrir, con `completed=false`).
  setOnboardingCompleted: (completed: boolean) => void;
  // Activa/desactiva el widget flotante (M3): abre/cierra su ventana (main) y persiste la preferencia.
  setWidgetEnabled: (enabled: boolean) => void;
  // Modelo por defecto de un proveedor (F3). Un modelo vacio BORRA la preferencia (vuelve a resolverse
  // por el ultimo usado / el fallback del proveedor).
  setDefaultModelForProvider: (providerId: string, model: string) => void;
  // Fija (o borra, `keys === null`) el override de un atajo (D5) y persiste. Sustituye cualquier
  // override previo de la MISMA accion (una accion tiene como mucho un override activo).
  setKeybindingOverride: (actionId: string, keys: string | null) => void;
  // Borra TODOS los overrides de atajos (D5, boton "Restablecer todo"): vuelve al catalogo por defecto.
  resetAllKeybindings: () => void;
  // Proveedores del usuario (E2): guarda uno (sustituye el que tenga el MISMO id, si no lo anade) o lo
  // elimina. Ya validados por validateCustomProviderDraft: el store no vuelve a validar. La clave va
  // aparte, a la boveda de main, ANTES de tocar el estado: si main la rechaza (sin cifrado), la promesa
  // rechaza y el proveedor no se guarda como si la tuviera.
  saveCustomProvider: (provider: CustomProvider, apiKeyUpdate?: ApiKeyUpdate) => Promise<void>;
  removeCustomProvider: (id: string) => void;
  // Temas Open VSX (M3): añade y activa un tema YA descargado y mapeado por la UI (que necesita los
  // colores para pintar la miniatura, asi que no hace falta volver a bajar el .vsix). Eliminar o
  // (des)activar uno de los importados.
  applyImportedTheme: (imported: ImportedTheme) => void;
  removeImportedTheme: (id: string) => void;
  selectImportedTheme: (id: string | null) => void;
  deleteAccount: (configDir: string) => Promise<void>;
  newTab: (params: NewTabParams) => Promise<void>;
  // Crea una conversacion SIN friccion (M2.6): cuenta activa implicita, cwd temporal, modelo
  // auto-resuelto, titulo pendiente del primer prompt, con la privacidad de la seccion (comun/privada).
  // Carpeta: `cwd` la fija (un proyecto elegido en la pantalla sin pestañas); `scratch` fuerza la temporal;
  // sin ninguna de las dos, la que diga el ajuste `newConversationFolder`.
  createConversation: (privacy: ConversationPrivacy, folder?: ConversationFolderChoice) => Promise<void>;
  // Renombra una pestana (M2.6): titulo editable a mano; ignora un titulo vacio. Persiste.
  renameTab: (tabId: string, title: string) => void;
  // Renombrado hecho por el USUARIO: titulo local + `/rename` al CLI (D3). `renameTab` es el de siempre,
  // el que tambien usan el auto-titulo y el titulo que llega del CLI, y no manda nada.
  renameConversation: (tabId: string, title: string) => void;
  // Guarda el borrador de UNA pestaña (auditoria B.1.2). `null` lo borra: es lo que hace el envio.
  setDraft: (tabId: string, draft: PromptDraft | null) => void;
  // Cola de mensajes (0.1.1 R2, punto 30): editar lo devuelve al input; quitar lo descarta.
  editQueuedMessage: (tabId: string, id: string) => void;
  removeQueuedMessage: (tabId: string, id: string) => void;
  // Carga el historial de conversaciones en disco de la cuenta activa (M2.6, sidebar = historial).
  loadConversationHistory: () => Promise<void>;
  // Abre (reanuda) una conversacion del historial: activa su pestana si ya esta abierta, o crea una.
  openConversation: (item: ConversationSummary) => void;
  // Elimina una conversacion en disco (#2): cierra su pestana si esta abierta, borra el .jsonl y
  // refresca el historial. accountDir = cuenta activa.
  deleteConversation: (sessionId: string, cwd: string, privacy: ConversationPrivacy) => Promise<void>;
  // Mueve una conversacion (#2) entre secciones (compartido/privado) y/o cuentas: cierra su pestana si
  // esta abierta, reubica el .jsonl y refresca el historial.
  moveConversation: (
    sessionId: string,
    cwd: string,
    privacy: ConversationPrivacy,
    destAccountDir: string,
    destPrivacy: ConversationPrivacy,
    // Cuenta ORIGEN. Por defecto la activa, que es lo que quiere el menu del sidebar (lista la activa).
    // Explicita para `continueInAccount`: con el workspace dividido, el panel que agota el limite no
    // tiene por que ser el de la cuenta seleccionada.
    sourceAccountDir?: string,
  ) => Promise<void>;
  // H4: mueve ESTA conversacion a `destAccountId`, activa esa cuenta y la reabre, de forma que el
  // usuario siga escribiendo donde lo dejo cuando se le agota el uso.
  continueInAccount: (tabId: string, destAccountId: string) => Promise<void>;
  // Handoff: una conversación NUEVA en la cuenta destino que arranca con el historial de esta como contexto. La
  // original se queda donde está (no es la misma conversación: para eso, `continueInAccount`).
  continueWithHistoryIn: (tabId: string, destAccountId: string) => Promise<void>;
  // Respuesta del usuario al dialogo de confianza de una carpeta. `granted` la guarda en los ajustes
  // (y con ella todo lo que cuelgue de esa carpeta); si no, la sesion que la pedia no arranca.
  answerTrustRequest: (folder: string, granted: boolean) => Promise<void>;
  // Resuelve (una vez) la carpeta de borradores. Idempotente: si ya se sabe, no vuelve a preguntar.
  ensureScratchDir: () => Promise<void>;
  // Retira una carpeta de la lista de confianza. La siguiente sesion que se lance ahi volvera a
  // preguntar (las que ya estan corriendo no se paran: el proceso ya leyo lo que tenia que leer).
  revokeTrustedFolder: (folder: string) => Promise<void>;
  // Abre una pestana nueva con los MISMOS {cuenta, proyecto, modelo} que la activa y envia `prompt`
  // como primer mensaje (usado por el handoff: "empezar nuevo chat con este prompt").
  startChatWithPrompt: (prompt: string) => Promise<void>;

  // --- Uso y estado (M1.3) ---
  refreshUsage: (configDir: string) => Promise<void>;
  refreshActiveUsage: () => Promise<void>;
  refreshStatus: () => Promise<void>;

  // --- Acciones del motor ---
  // Rellena los bloques de una pestana desde su transcripcion (M2.5b, resume): SOLO si aun no tiene
  // bloques (no pisa una conversacion viva). Idempotente.
  hydrateBlocks: (tabId: string, blocks: readonly Block[]) => void;
  ensureSession: (tabId: string) => Promise<string>;
  // `attachments` (2.12.1): imagenes del mensaje. Vacio o ausente = mensaje de solo texto, y
  // entonces el adapter manda EXACTAMENTE el payload de siempre.
  sendActiveMessage: (text: string, attachments?: readonly ImageAttachment[]) => Promise<void>;
  // Lo mismo contra una pestaña concreta (la activa o no): el continuar automatico (P-028, 20) escribe
  // en pestañas que pueden no estar a la vista.
  sendMessageToTab: (tabId: string, text: string, attachments?: readonly ImageAttachment[]) => Promise<void>;
  // Continuar automatico al restablecerse el limite de esa pestaña (opt-in desde el banner).
  setRateLimitAutoContinue: (tabId: string, enabled: boolean) => void;
  // Cambio de modelo de la pestana activa (M2.4, solo Claude). Si hay sesion viva envia set_model
  // (aplica al siguiente turno); si no, solo actualiza la Tab (--model aplicara al arrancar).
  setActiveModel: (model: string) => void;
  // Modo de permiso de la pestana activa (M2.6, solo Claude): fija el modo y, si hay sesion viva,
  // envia set_permission_mode; cyclePermissionMode rota default->acceptEdits->plan (shift+tab / chip).
  // Claude: un modo de su CLI; Codex: un perfil de `permissionProfile/list` (aplica al siguiente turno).
  setActivePermissionMode: (mode: string) => void;
  cyclePermissionMode: () => void;
  // Nivel de esfuerzo (--effort, M2.4) de la pestana activa. Es un parametro de ARRANQUE del CLI: se
  // guarda en la Tab y aplica al arrancar/reanudar la sesion (no hay control_request para cambiarlo).
  setActiveEffort: (effort: string) => void;
  // Cambia la carpeta (cwd) de la pestana activa (F2). Solo tiene sentido ANTES de que arranque la
  // sesion: la regla vive en canChangeCwd (modulo puro), que comparten la UI y esta accion.
  // `tabId` = la pestaña del panel que lo pide (con el workspace dividido no tiene por que ser la
  // activa); sin el, la activa.
  setActiveCwd: (cwd: string, tabId?: string) => void;
  // Interrumpe el turno en curso de la pestana activa (boton "Parar"): control_request interrupt.
  interruptActiveSession: () => void;
  // Para UN subagente en segundo plano (0.1.1 R2, punto 29): `taskId` es su `agentId`. El «Detenido»
  // llega con el `task_notification stopped` del CLI, no se pinta aqui.
  stopSubagent: (tabId: string, taskId: string) => void;
  // Compactacion del contexto de la sesion activa (M2.4, solo Claude): envia /compact.
  compactActiveSession: () => Promise<void>;
  answerActivePermission: (decision: PermissionDecision) => void;
  // Contesta el permiso pendiente de UNA pestaña concreta. Existe porque el auto-permitido (2.3b) no
  // ocurre por un clic: llega con el evento, que puede ser de una pestaña que no es la activa —
  // contestar "la activa" ahi seria responder por la conversacion equivocada.
  // Sin `requestId` contesta la PRIMERA de la cola; con el, esa peticion concreta (la de una tarjeta).
  answerPermissionFor: (tabId: string, decision: PermissionDecision, requestId?: string) => void;
  // "Permitir siempre <tool> aqui" (2.3b): guarda la regla en la conversacion (persiste en el indice
  // de Mage) y concede TODAS las peticiones de esa tool que esperan en la cola, no solo una: la regla
  // ya dice que si. `revokeAlwaysAllow` la quita desde el panel.
  allowAlwaysAndAnswer: (toolName: string, tabId?: string) => void;
  revokeAlwaysAllow: (tabId: string, toolName: string) => void;
  // Contesta una tarjeta de pregunta del chat (2.3): construye el `updatedInput` con las respuestas y
  // responde el MISMO can_use_tool que tendria el panel de permiso.
  answerQuestion: (requestId: string, answers: Readonly<Record<string, string>>) => void;
  handleEvent: (sessionId: string, event: MageEvent) => void;
}

// Parametros para abrir una pestana. title opcional: si falta se deriva del ultimo segmento del cwd.
export interface NewTabParams {
  readonly accountId: string;
  readonly cwd: string;
  readonly model: string;
  readonly provider: string; // 'claude' | 'openai' | 'gemini' | 'ollama' | 'lmstudio'
  readonly title?: string;
  readonly effort?: string; // nivel --effort (M2.4); undefined -> default del CLI
  readonly maxBudgetUsdCents?: number; // tope --max-budget-usd (M2.4) en centavos enteros
  readonly privacy?: ConversationPrivacy; // M2.6; ausente -> 'shared'
  // Modo de permiso inicial; ausente -> el `defaultPermissionMode` de Ajustes (solo Claude), y '' = el de la cuenta.
  readonly permissionMode?: PermissionMode;
  readonly projectId?: string;
  readonly importedContext?: string;
}

// Contadores monotonos (no usamos Date.now/random para ids de bloque ni de pestana).
let blockSeq = 0;
const nextBlockId = (): string => `blk${(blockSeq += 1)}`;
let tabSeq = 0;
const nextTabId = (): string => `tab${(tabSeq += 1)}`;

// Tras restaurar pestanas (M2.5), avanza el contador de ids por encima del mayor sufijo restaurado:
// nextTabId reinicia a 0 en cada arranque y una pestana nueva colisionaria con una restaurada "tabN".
function advanceTabSeqPast(tabs: readonly Tab[]): void {
  for (const tab of tabs) {
    const match = /^tab(\d+)$/.exec(tab.id);
    if (match !== null) tabSeq = Math.max(tabSeq, Number(match[1]));
  }
}

// Guard de suscripcion unica al stream del motor (evita listeners duplicados en HMR).
let engineSubscribed = false;

// Persistencia del workspace (M2.5) con debounce: agrupa rafagas de cambios (abrir/cerrar/cambiar
// pestana) en una sola escritura. La escritura en main es atomica; un fallo NO es critico (se
// reintenta al proximo cambio) pero se traza, nunca se traga.
const PERSIST_DEBOUNCE_MS = 400;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

// Cancela la escritura pendiente, si la hay. La llama `createWorkbenchStore` al crear un store nuevo:
// el temporizador es de MODULO, asi que sin esto el de un store viejo sigue vivo apuntando al
// `getState` de ese store — pasa con HMR (recarga del renderer) y, sobre todo, entre ficheros de test.
export function cancelPendingPersist(): void {
  if (persistTimer === null) return;
  clearTimeout(persistTimer);
  persistTimer = null;
}

function schedulePersist(mage: MageClient, getState: () => WorkbenchState): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const s = getState();
    // `saveWorkspace` es una dependencia INYECTADA: en produccion devuelve una promesa, pero un doble
    // de test puede devolver `undefined` o lanzar en sincrono. Y este callback corre desde un TIMER, o
    // sea fuera de cualquier pila de llamada: lo que escape de aqui no lo recoge nadie y aterriza como
    // "unhandled error" en el fichero de test que tocara estar corriendo, que ni siquiera tiene por que
    // ser del renderer. Paso en CI (2026-09-18) y el error salia en `streamTranslator.test.ts`.
    // Se normaliza el valor devuelto y se traza el fallo; nunca se traga en silencio.
    try {
      void Promise.resolve(
        mage.saveWorkspace(toPersistedWorkspace(s.tabs, s.activeTabId, s.sessionIdByChat, s.splitLayout)),
      ).catch((err: unknown) => reportActionError('No se pudo guardar el workspace', err, 'persist', SAVE_FAILED_KEY.workspace));
    } catch (err: unknown) {
      reportActionError('No se pudo guardar el workspace', err, 'persist', SAVE_FAILED_KEY.workspace);
    }
  }, PERSIST_DEBOUNCE_MS);
}

// Evento de una sesion SIN pestaña: si esta en segundo plano, actualiza su estado (trabajando ->
// pendiente de accion / de revision) y avisa. La inmensa mayoria de eventos (deltas, herramientas) no
// cambian nada y salen sin tocar el store — este camino corre por CADA token de una sesion cerrada.
function applyBackgroundEvent(
  mage: MageClient,
  get: () => WorkbenchState,
  set: (partial: (s: WorkbenchState) => Partial<WorkbenchState>) => void,
  sessionId: string,
  event: MageEvent,
): void {
  const entry = get().backgroundSessions[sessionId];
  if (entry === undefined) return; // sesion ya parada: evento rezagado, se ignora
  // «Permitir siempre aqui» sigue valiendo con la pestaña cerrada (P-026, 1.8): se contesta sola, sin
  // pasar a «pendiente de accion» ni avisar de un permiso que el usuario ya concedio.
  if (event.kind === 'permission_request' && event.request.outsideProject !== true && isAlwaysAllowed(entry.alwaysAllowTools, event.request.toolName)) {
    void mage
      .answerPermission({ sessionId, requestId: event.request.requestId, decision: { behavior: 'allow' } })
      .catch((err: unknown) => console.warn(`No se pudo auto-permitir en segundo plano (${sessionId}):`, describeError(err)));
    return;
  }
  // La notificacion va ANTES del corte por "estado sin cambio", y no despues: las reglas del usuario
  // (M2.3) se disparan con `assistant_text` y `hook_fired`, que NO cambian el estado de segundo plano.
  // Calculandola detras, la unica conversacion que el usuario no esta mirando era justo la unica que no
  // avisaba. Main solo la enseña con la ventana sin foco; el titulo es el que tenia la pestaña al cerrar.
  const content = notificationForEvent(event, { tabTitle: entry.title, rules: get().settings.notificationRules });
  if (content !== null) void mage.notify(toNotifyParams(content, { sessionId })).catch(() => undefined);
  toastIfHidden(get, event, { tabId: null, tabTitle: entry.title, target: { sessionId } });
  const state = nextBackgroundState(entry.state, event);
  if (state === entry.state) return;
  set((s) => ({ backgroundSessions: { ...s.backgroundSessions, [sessionId]: { ...entry, state } } }));
  // Al acabar el turno, la transcripcion en disco ya tiene lo nuevo: refrescar el historial para que su
  // fila se date bien (y suba al principio de la lista).
  if (state === 'done') void get().loadConversationHistory();
}

// Registra en el indice los artifacts que ACABAN de publicarse en este parche de bloques. Se compara
// antes/despues para no reescribir en cada tool_result. Best-effort: un fallo de disco no puede tumbar
// la conversacion, pero se traza.
function recordPublishedArtifacts(
  mage: MageClient,
  state: WorkbenchState,
  tabId: string,
  before: readonly Block[],
  after: readonly Block[],
): void {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (tab === undefined) return;
  // Config dir EFECTIVO: en una conversacion privada, quien publico fue el perfil `mage-private`.
  const accountDir = tab.resolvedConfigDir ?? tab.accountId;
  const publishedBefore = new Set(before.filter((b) => b.kind === 'tool' && b.artifact !== null).map((b) => b.id));
  for (const block of after) {
    if (block.kind !== 'tool' || block.artifact === null || publishedBefore.has(block.id)) continue;
    const { url, title, favicon } = block.artifact;
    void mage
      .recordArtifact({ url, record: { accountDir, title, favicon, publishedAtMs: Date.now() } })
      .catch((err: unknown) => console.warn('No se pudo registrar el artifact:', describeError(err)));
  }
}

// Panel "Ficheros" (2.10): en cuanto el agente CREA un fichero, el panel APARECE a la derecha — es
// literalmente lo que se pidio ("tiene que aparecer a la derecha como un artifact y así poder ver el
// plan"). Solo REVELA (nunca cierra nada) y solo para la conversacion ENFOCADA: robarle el dock al
// usuario porque una pestaña de al lado escribio un fichero seria un salto de layout sin explicacion.
//
// El import es DINAMICO por el mismo motivo que en toggleSidebar/toggleInspector: `panelLayoutStore`
// importa este modulo, y un import estatico en el sentido contrario cierra el ciclo de evaluacion.
function revealFilesPanelIfCreated(state: WorkbenchState, tabId: string, before: readonly Block[], after: readonly Block[]): void {
  if (tabId !== state.activeTabId) return;
  // Comparacion por ids de bloque y no por longitud de la lista: un `Write` que REESCRIBE un fichero ya
  // listado no cambia el numero de ficheros, y aun asi es una escritura nueva que hay que ensenar.
  const antes = new Set(before.filter((b) => createdFileFrom(b) !== null).map((b) => b.id));
  if (!after.some((b) => createdFileFrom(b) !== null && !antes.has(b.id))) return;
  void import('./panelLayoutStore').then((m) => m.usePanelLayoutStore.getState().revealPanelById('files'));
}

// Escribe en el indice propio de Mage (2.1) lo que el CLI no persiste de una conversacion: modelo,
// esfuerzo y modo de permiso. Solo tiene sentido con un id al que asociarlo (sesion viva o
// `resumeSessionId`); una conversacion que aun no ha arrancado se escribe al crear la sesion.
// Best-effort: un fallo de disco no puede tumbar un cambio de modelo, pero se traza.
// Lee el indice sin dejar que un fallo impida abrir la conversacion: sin preferencias se abre con los
// defaults de siempre, que es exactamente lo que pasaba antes de que el indice existiera.
async function loadConversationPrefsSafely(mage: MageClient, sessionId: string): Promise<ConversationPrefs | null> {
  try {
    return await mage.loadConversationPrefs(sessionId);
  } catch (err) {
    console.warn('No se pudieron leer las preferencias de la conversacion:', describeError(err));
    return null;
  }
}

function persistConversationPrefs(mage: MageClient, state: WorkbenchState, tabId: string): void {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (tab === undefined) return;
  const sessionId = state.sessionIdByChat[tabId] ?? tab.resumeSessionId;
  if (sessionId === undefined || sessionId.length === 0) return;
  void mage
    .saveConversationPrefs({ sessionId, prefs: toConversationPrefs(tab) })
    .catch((err: unknown) => console.warn('No se pudieron guardar las preferencias de la conversacion:', describeError(err)));
}

// Un guardado con debounce que falla lo haria en cada cambio: la clave deja un solo aviso con contador.
const SAVE_FAILED_KEY = { workspace: 'save-failed:workspace', settings: 'save-failed:settings' } as const;

// Persistencia de la configuracion de la app (M2.3) con el mismo patron de debounce que el
// workspace (agrupa rafagas de edicion de reglas en una escritura). Fallo trazado, nunca tragado.
let settingsPersistTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSettingsPersist(mage: MageClient, getState: () => WorkbenchState): void {
  if (settingsPersistTimer !== null) clearTimeout(settingsPersistTimer);
  settingsPersistTimer = setTimeout(() => {
    settingsPersistTimer = null;
    void mage
      .saveSettings(getState().settings)
      .catch((err: unknown) => reportActionError('No se pudo guardar la configuración', err, 'persist', SAVE_FAILED_KEY.settings));
  }, PERSIST_DEBOUNCE_MS);
}

// Sin debounce: lo que main lee al lanzar un CLI (las reglas de agy) tiene que estar en disco antes del
// siguiente mensaje. Cancela un guardado pendiente: este ya lleva el estado entero.
function persistSettingsNow(mage: MageClient, getState: () => WorkbenchState): void {
  if (settingsPersistTimer !== null) clearTimeout(settingsPersistTimer);
  settingsPersistTimer = null;
  void mage
    .saveSettings(getState().settings)
    .catch((err: unknown) => reportActionError('No se pudo guardar la configuración', err, 'persist', SAVE_FAILED_KEY.settings));
}

// De donde sale la carpeta de una conversacion nueva (ver `createConversation`).
export interface ConversationFolderChoice {
  readonly cwd?: string;
  readonly scratch?: boolean;
  readonly projectId?: string;
  readonly importedContext?: string;
}

function resolveNewConversationCwd(mage: MageClient, state: WorkbenchState, folder: ConversationFolderChoice): Promise<string> {
  if (folder.cwd !== undefined) return Promise.resolve(folder.cwd);
  if (folder.scratch === true) return mage.getScratchDir();
  return newConversationCwd(mage, state);
}

// Carpeta de «Nuevo chat» (P-028, 16). Con 'lastProject', la del proyecto mas reciente del historial
// que siga existiendo; si no hay ninguno (o el historial aun no ha cargado tras arrancar, o falla la
// consulta), la temporal de siempre. Un proyecto sin confianza se abre igual: la pregunta llega al
// primer envio, como con cualquier carpeta elegida a mano.
async function newConversationCwd(mage: MageClient, state: WorkbenchState): Promise<string> {
  if (state.settings.newConversationFolder !== 'lastProject') return mage.getScratchDir();
  const candidates = recentProjects({
    history: state.conversationHistory,
    scratchRoot: state.scratchDir,
    limit: RECENT_PROJECTS_LIMIT,
    caseInsensitive: isWindowsPlatform(),
  });
  if (candidates.length === 0) return mage.getScratchDir();
  try {
    const exists = await mage.existsDirs(candidates.map((p) => p.cwd));
    const found = candidates.find((_, index) => exists[index] === true);
    if (found !== undefined) return found.cwd;
  } catch (err) {
    console.warn('No se pudo comprobar el ultimo proyecto; se usa una carpeta temporal:', describeError(err));
  }
  return mage.getScratchDir();
}

// La forma persistida de una pestaña que se va a otra ventana, o lanza con el motivo si no puede irse
// (P-028, 36): con un turno en marcha, moverla la dejaria en segundo plano aqui con el CLI vivo y la
// otra ventana no podria reanudarla. La UI ya desactiva mover y arrastrar con ese motivo.
function movableTab(state: WorkbenchState, tabId: string): PersistedTab {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (tab === undefined) throw new Error(`No hay ninguna pestaña con id ${JSON.stringify(tabId)} que mover`);
  const blocked = tabMoveBlockedReason(state.statusByChat[tabId]);
  if (blocked !== null) throw new Error(blocked);
  // Se manda la forma PERSISTIDA, que es el contrato del IPC y lo unico que la otra ventana sabe leer.
  const [persisted] = toPersistedWorkspace([tab], tab.id, state.sessionIdByChat).tabs;
  if (persisted === undefined) throw new Error(`No se pudo serializar la pestaña ${JSON.stringify(tabId)}`);
  return persisted;
}

// La pestaña abierta de una conversacion (viva o por reanudar), si la hay.
function tabOfConversation(state: WorkbenchState, sessionId: string): Tab | undefined {
  return state.tabs.find((t) => (state.sessionIdByChat[t.id] ?? t.resumeSessionId) === sessionId);
}

// Una fila del historial como pestaña para OTRA ventana: la misma que abriria `openConversation`
// aqui. Si seguia en segundo plano ya terminada, su sesion se corta antes (dos CLI no pueden escribir
// la misma transcripcion); trabajando todavia, no se mueve.
async function conversationForOtherWindow(
  mage: MageClient,
  get: () => WorkbenchState,
  item: ConversationSummary,
): Promise<PersistedTab> {
  const blocked = backgroundMoveBlockedReason(get().backgroundSessions[item.sessionId]);
  if (blocked !== null) throw new Error(blocked);
  await get().discardBackgroundSession(item.sessionId);
  const state = get();
  const account = state.accounts.find((a) => a.id === state.activeAccountId);
  const prefs = resolveReopenedTabPrefs({
    indexPrefs: await loadConversationPrefsSafely(mage, item.sessionId),
    accountDefaultModel: account?.defaultModel ?? null,
    providerDefaultModel: state.settings.defaultModelByProvider.claude ?? null,
  });
  const tab = tabFromConversation({ id: nextTabId(), item, accountId: state.activeAccountId, accountAlias: account?.alias ?? state.activeAccountId, prefs });
  const [persisted] = toPersistedWorkspace([tab], tab.id, {}).tabs;
  if (persisted === undefined) throw new Error(`No se pudo serializar la conversacion ${JSON.stringify(item.sessionId)}`);
  return persisted;
}

// Empuje del snapshot al WIDGET FLOTANTE (M3). El renderer principal es la fuente de verdad: calcula
// un snapshot compacto y lo envia a main, que lo reenvia a la ventana del widget. Con debounce corto
// (agrupa rafagas de deltas del stream) y guard unica de suscripcion (evita listeners duplicados en HMR).
const WIDGET_PUSH_DEBOUNCE_MS = 150;
let widgetSubscribed = false;
let widgetPushTimer: ReturnType<typeof setTimeout> | null = null;

// Calcula y empuja el snapshot AHORA (sin debounce). No-op efectivo si el widget esta apagado (main
// lo ignora sin ventana), pero se filtra aqui para no calcular de mas.
function pushWidgetSnapshotNow(mage: MageClient, state: WorkbenchState): void {
  // Si hay un tema importado activo, el widget usa su tipo como base y recibe sus overrides de color;
  // si no, el tema base resuelto y sin overrides.
  const active = findActiveImportedTheme(state.settings);
  const resolved = active !== null ? active.type : resolveTheme(state.settings.theme, systemPrefersDark());
  mage.pushWidgetSnapshot(
    toWidgetSnapshot(
      { tabs: state.tabs, accounts: state.accounts, activeAccountId: state.activeAccountId, statusByChat: state.statusByChat },
      resolved,
      active?.tokens,
    ),
  );
}

// THROTTLE, no debounce: el `set` de cada evento del CLI reiniciaba el temporizador, y como los deltas
// llegan a mucho menos de 150 ms el snapshot no se empujaba NUNCA durante el turno — el widget se
// quedaba en 'idle' justo mientras el agente trabajaba, que es lo unico que existe para enseñar. Con
// el primer evento se arma el temporizador y ya no se toca: 150 ms de latencia maxima, que es lo que
// se pretendia desde el principio.
function scheduleWidgetPush(mage: MageClient, getState: () => WorkbenchState): void {
  if (widgetPushTimer !== null) return;
  widgetPushTimer = setTimeout(() => {
    widgetPushTimer = null;
    const state = getState();
    if (state.settings.widgetEnabled) pushWidgetSnapshotNow(mage, state);
  }, WIDGET_PUSH_DEBOUNCE_MS);
}

// Cliente IPC del store. Se INYECTA al crear el store (decision A1 de la auditoria) en vez de
// alcanzar `window.mage` desde dentro: asi la orquestacion se puede testear con un mock. Hasta ahora
// eran 18 accesos al global repartidos por 850 lineas SIN una sola red de tests — y ahi es donde
// vivia el bug de `closeTab`, que se dejaba dos mapas sin limpiar.
export type MageClient = MageApi;

// Creaciones de sesion EN VUELO, por pestaña (B16). Vive a nivel de modulo y no en el estado porque
// no es estado de UI: nadie lo pinta, y meterlo en el store obligaria a que cada `set` lo arrastrase.
const sessionCreationInFlight = new Map<string, Promise<string>>();

// Temporizadores de caducidad de las sesiones en segundo plano, por sessionId. Viven a nivel de modulo
// por el mismo motivo que los dos mapas de arriba: no son estado de UI, nadie los pinta. A la semana
// (BACKGROUND_TTL_MS) se mata el CLI que nadie ha reclamado; reabrir o borrar la conversacion cancela.
const backgroundTtlTimers = new Map<string, ReturnType<typeof setTimeout>>();

function armBackgroundTtl(get: () => WorkbenchState, sessionId: string): void {
  clearBackgroundTtl(sessionId);
  backgroundTtlTimers.set(
    sessionId,
    setTimeout(() => void get().discardBackgroundSession(sessionId), BACKGROUND_TTL_MS),
  );
}

// Chat NUEVO que sigue a la cuenta pulsada (P-028, punto 31): reescribe cuenta, alias y modelo de la
// pestaña y olvida su config dir resuelto (el de la cuenta vieja). Conserva cwd, privacidad y borrador.
// Solo se llama con el plan 'reassign', que ya garantiza que no hay sesion ni nada que migrar.
function reassignNewChat(
  mage: MageClient,
  get: () => WorkbenchState,
  set: SetFn,
  target: { readonly tabId: string; readonly destAccountId: string },
): void {
  const state = get();
  const dest = state.accounts.find((a) => a.id === target.destAccountId);
  if (dest === undefined) throw new Error(`Cuenta destino inexistente al reasignar el chat: ${target.destAccountId}`);
  const catalog = state.modelCatalogByAccount[dest.id]?.map((m) => m.id);
  const reresolve = (): string =>
    resolveDefaultModel({
      lastUsedModel: null,
      accountDefaultModel: dest.defaultModel,
      providerDefaultModel: state.settings.defaultModelByProvider.claude ?? null,
    });
  set((s) => ({
    tabs: s.tabs.map((t) => {
      if (t.id !== target.tabId) return t;
      const model = t.provider === 'claude' ? modelForReassignedTab(t.model, catalog, reresolve) : t.model;
      const { resolvedConfigDir: _olvidado, ...rest } = t;
      return { ...rest, accountId: dest.id, accountAlias: dest.alias, model };
    }),
  }));
  schedulePersist(mage, get);
}

// Continuar automatico (P-028, 20). UN intervalo para todas las pestañas y solo mientras alguna lo
// tenga activado: un setTimeout de horas no sobrevive a suspender el equipo, un sondeo corto si. No se
// persiste nada: al reiniciar Mage no se continua solo (decision del usuario).
let autoContinueTimer: ReturnType<typeof setInterval> | null = null;

function clearAutoContinueTimer(): void {
  if (autoContinueTimer === null) return;
  clearInterval(autoContinueTimer);
  autoContinueTimer = null;
}

function syncAutoContinueTimer(get: () => WorkbenchState): void {
  const pending = Object.values(get().rateLimitByChat).some((notice) => notice.autoContinue === true);
  if (!pending) {
    clearAutoContinueTimer();
    return;
  }
  if (autoContinueTimer === null) autoContinueTimer = setInterval(() => runAutoContinue(get), AUTO_CONTINUE_POLL_MS);
}

// Envia «Continúa» a cada pestaña marcada cuyo limite ya se restablecio. `sendMessageToTab` retira la
// marca, asi que cada limite dispara una sola vez y el intervalo se apaga solo al quedar ninguna.
function runAutoContinue(get: () => WorkbenchState): void {
  const state = get();
  const now = Date.now();
  for (const [tabId, notice] of Object.entries(state.rateLimitByChat)) {
    const tab = state.tabs.find((t) => t.id === tabId);
    if (tab === undefined) continue;
    const resetsAtMs = effectiveResetMs(notice, state.usageByAccount[tab.accountId]);
    if (!shouldAutoContinue({ now, notice, status: state.statusByChat[tabId], resetsAtMs })) continue;
    void state.sendMessageToTab(tabId, AUTO_CONTINUE_TEXT);
  }
  syncAutoContinueTimer(get);
}

function clearBackgroundTtl(sessionId: string): void {
  const timer = backgroundTtlTimers.get(sessionId);
  if (timer === undefined) return;
  clearTimeout(timer);
  backgroundTtlTimers.delete(sessionId);
}

// Dialogos de confianza EN VUELO, por carpeta. Mismo sitio y mismo motivo que el mapa de arriba: no es
// estado de UI (lo que se pinta es `trustRequests`), es la promesa que espera a que el usuario conteste.
// Por CARPETA y no por pestana: dos pestanas del mismo proyecto preguntan una vez, y las dos arrancan
// —o no— con la misma respuesta.
const trustAnswersInFlight = new Map<string, { readonly promise: Promise<boolean>; readonly answer: (granted: boolean) => void }>();

// Frontera de confianza en el renderer: PREGUNTA antes de arrancar, para que el usuario vea un dialogo
// en vez de un error. Quien decide de verdad es main (la guarda de `SessionCreate`), que no se fia de
// que esto se haya ejecutado; esto es la cortesia, no la cerradura.
async function ensureFolderTrusted(
  mage: MageClient,
  get: () => WorkbenchState,
  set: (partial: Partial<WorkbenchState> | ((s: WorkbenchState) => Partial<WorkbenchState>)) => void,
  tab: Tab,
): Promise<void> {
  if (!(await requestFolderTrust(mage, set, tab))) throw new Error(`Carpeta no autorizada: ${tab.cwd}`);
}

// ¿Es de confianza la carpeta de la pestaña? Si no lo es, abre el dialogo (uno por carpeta aunque
// pregunten dos a la vez) y espera la respuesta. Lo usan el arranque de sesion y git (P-026 3.5).
async function requestFolderTrust(
  mage: MageClient,
  set: (partial: Partial<WorkbenchState> | ((s: WorkbenchState) => Partial<WorkbenchState>)) => void,
  tab: Tab,
): Promise<boolean> {
  if (await mage.isFolderTrusted({ cwd: tab.cwd, accountDir: tab.accountId })) return true;
  const pending = trustAnswersInFlight.get(tab.cwd);
  if (pending !== undefined) return pending.promise;
  let answer!: (granted: boolean) => void;
  const promise = new Promise<boolean>((resolve) => {
    answer = resolve;
  });
  trustAnswersInFlight.set(tab.cwd, { promise, answer });
  set((s) => ({ trustRequests: [...s.trustRequests, tab.cwd] }));
  return promise;
}

// Carpetas a las que git ya pregunto la confianza en esta ejecucion (D28: una vez). Si el usuario dijo
// que no, no se le vuelve a preguntar hasta reiniciar; el agente, al arrancar, si pregunta.
const gitTrustAsked = new Set<string>();

// `Bash` con `gh pr create` en vuelo, por `tabId:toolUseId`: su resultado trae la URL del PR.
const prCreateToolUses = new Set<string>();

export interface GitView {
  readonly snapshot: GitSnapshot;
  readonly branches: readonly string[];
  readonly error: string | null; // el ultimo cambio de rama que fallo, con el mensaje de main
}

// D27, tal cual lo fija el plan.
export const COMMIT_PROMPT =
  'Haz commit de los cambios pendientes con un mensaje descriptivo. Revisa el diff antes y no incluyas ficheros que no deban ir.';

function isTurnLive(status: string | undefined): boolean {
  return status === 'streaming' || status === 'needs_permission';
}

// Deja un prompt en el input SIN enviarlo (D27). Lo que el usuario ya tuviera escrito se conserva: el
// prompt va detras.
function insertPromptIntoDraft(get: () => WorkbenchState, tabId: string, prompt: string): void {
  const draft = get().draftByChat[tabId];
  const text = draft === undefined || draft.text.trim().length === 0 ? prompt : `${draft.text.trimEnd()}\n\n${prompt}`;
  get().setDraft(tabId, { text, attachments: draft?.attachments ?? [] });
}

// Arranca (o reanuda) la sesion del CLI de una pestaña y deja su id en el estado. Extraida de la
// accion `ensureSession` para que la guarda de reentrada pueda memoizar ESTA promesa entera.
async function createSessionFor(
  mage: MageClient,
  get: () => WorkbenchState,
  set: (partial: Partial<WorkbenchState> | ((s: WorkbenchState) => Partial<WorkbenchState>)) => void,
  tabId: string,
): Promise<string> {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (tab === undefined) throw new Error(`Pestana inexistente: ${tabId}`);
    // Antes de arrancar nada: la carpeta tiene que estar autorizada. Bloquea aqui —esperando al
    // dialogo— porque arrancar y luego preguntar seria preguntar tarde: el CLI ya habria leido los
    // hooks del proyecto.
    await ensureFolderTrusted(mage, get, set, tab);
    // Grupo D: una conversacion nueva en la raiz de un repo trabaja en su worktree (DN-6), y una que ya
    // vivia en uno lo recrea si se archivo. El cwd cambia ANTES de arrancar: la transcripcion nace alli.
    await prepareWorktree(mage, get, set, tabId);
    // Pestana restaurada de un arranque anterior: reanuda su conversacion (`claude --resume`) en vez
    // de arrancar una fresca; el id de sesion resultante es el mismo (misma transcripcion).
    const projectId = projectForRow({ kind: 'tab', tab }, get().settings.chatProjects, get().sessionIdByChat)?.id;
    const { sessionId, configDir } = await mage.createSession({
      accountDir: tab.accountId,
      model: tab.model,
      provider: tab.provider,
      cwd: get().tabs.find((t) => t.id === tabId)?.cwd ?? tab.cwd,
      privacy: tab.privacy,
      ...(tab.resumeSessionId === undefined ? {} : { resumeSessionId: tab.resumeSessionId }),
      ...(tab.effort === undefined ? {} : { effort: tab.effort }),
      ...(tab.maxBudgetUsdCents === undefined ? {} : { maxBudgetUsdCents: tab.maxBudgetUsdCents }),
      ...(isPermissionMode(tab.permissionMode) ? { permissionMode: tab.permissionMode } : {}),
      ...(projectId === undefined ? {} : { projectId }),
      ...(tab.importedContext === undefined || tab.resumeSessionId !== undefined ? {} : { contextImport: tab.importedContext }),
    });
  // La pestaña puede haberse CERRADO mientras iba el round-trip (B16, segunda mitad). Sin esta
  // guarda se resucitaba `sessionIdByChat` de una pestaña que ya no existe, y el proceso del CLI se
  // quedaba sin nadie que lo parase: `closeTab` ya habia pasado por ahi.
  if (get().tabs.find((t) => t.id === tabId) === undefined) {
    await mage.stop(sessionId).catch(() => undefined);
    throw new Error(`La pestana se cerro mientras arrancaba su sesion: ${tabId}`);
  }
    // Guarda el config dir EFECTIVO (cuenta o perfil privado) en la pestana: localiza sus
    // transcripciones/memoria y se persiste para reabrir una conversacion privada tras reiniciar.
    set((s) => ({
      sessionIdByChat: { ...s.sessionIdByChat, [tabId]: sessionId },
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, resolvedConfigDir: configDir } : t)),
    }));
    schedulePersist(mage, get); // ya hay sesion viva: persistir su id para poder reanudar en el futuro
    // Es el momento en que una conversacion NUEVA estrena `sessionId`: hasta ahora no habia a que
    // asociar sus preferencias (2.1).
    persistConversationPrefs(mage, get(), tabId);
    if (projectId !== undefined) get().assignChatProject(sessionId, tabId, projectId);
  return sessionId;
}

// `/rename` que mando Mage sin que el usuario lo tecleara (D3), por sesion. MEDIDO (CLI 2.1.283,
// `spike/engine-spike.mjs --rename`): el CLI lo resuelve en local —0 turnos, coste 0, sin deltas— y
// solo contesta con un `result`, que `handleEvent` se traga para no cerrar ni notificar un «turno» que
// no existio. El recuento acota lo que se traga: nunca mas `result` de los `/rename` enviados.
const silentRenamesBySession = new Map<string, number>();

function consumeSilentRename(sessionId: string, numTurns: number | null): boolean {
  const pending = silentRenamesBySession.get(sessionId) ?? 0;
  if (pending === 0 || numTurns !== 0) return false;
  if (pending === 1) silentRenamesBySession.delete(sessionId);
  else silentRenamesBySession.set(sessionId, pending - 1);
  return true;
}

// Manda el nombre pendiente de la pestaña si su sesion esta viva y ociosa (D3). Si el envio falla, el
// nombre vuelve a quedar pendiente: el titulo local ya esta puesto y se reintenta al siguiente turno.
function flushPendingCliTitle(
  mage: MageClient,
  get: () => WorkbenchState,
  set: (partial: Partial<WorkbenchState> | ((s: WorkbenchState) => Partial<WorkbenchState>)) => void,
  tabId: string,
): void {
  const title = get().tabs.find((t) => t.id === tabId)?.pendingCliTitle;
  const sessionId = get().sessionIdByChat[tabId];
  const status = get().statusByChat[tabId] ?? 'idle';
  if (title === undefined || sessionId === undefined || status !== 'idle') return;
  silentRenamesBySession.set(sessionId, (silentRenamesBySession.get(sessionId) ?? 0) + 1);
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? withoutPendingCliTitle(t) : t)) }));
  schedulePersist(mage, get);
  mage.sendMessage({ sessionId, text: `/rename ${title}` }).catch((err: unknown) => {
    consumeSilentRename(sessionId, 0);
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId && t.pendingCliTitle === undefined ? { ...t, pendingCliTitle: title } : t)) }));
    console.warn(`No se pudo mandar /rename al CLI (${tabId}):`, describeError(err));
  });
}

// Auto-titulo (M2.6): el primer PROMPT de una pestaña sin titulo elegido. Ni un comando "/" ni un
// mensaje posterior a otro prompt real titulan (P-028).
function shouldAutoTitle(tab: Tab, blocks: readonly Block[], text: string): boolean {
  if (!isPlaceholderTitle(tab.title) || isSlashCommandText(text)) return false;
  return !blocks.some((b) => b.kind === 'user' && !isSlashCommandText(b.text) && classifySystemWrapper(b.text).kind !== 'command');
}

// `/rename` resuelto por el CLI (P-028): la pestaña toma el nombre en cuanto llega su salida, este o no
// en marcha un turno. Sin nombre legible en la salida se relee la transcripcion, que trae el
// `custom-title` y lo aplica `useTranscriptLifecycle`.
function applyCliRename(get: () => WorkbenchState, tabId: string, output: { readonly args: string; readonly text: string }): void {
  const title = renamedTitleFrom(output);
  if (title === null) {
    transcriptStoreForTab(tabId).getState().refresh();
    return;
  }
  get().renameTab(tabId, title);
}

function withoutPendingCliTitle(tab: Tab): Tab {
  const { pendingCliTitle: _sent, ...rest } = tab;
  return rest;
}

export function createWorkbenchStore(mage: MageClient) {
  // Un store nuevo invalida la escritura pendiente del anterior: ese temporizador apunta al `getState`
  // del store viejo y a SU cliente, asi que dispararlo ahora escribiria estado muerto (o llamaria a un
  // doble de test que ya nadie vigila). Es la unica puerta por la que pasan todos los stores.
  cancelPendingPersist();
  // Mismo motivo: el intervalo del continuar automatico lee el `get` del store anterior.
  clearAutoContinueTimer();
  // Lo mismo con los `/rename` silenciosos: los recuentos son de las sesiones del store anterior.
  silentRenamesBySession.clear();
  gitTrustAsked.clear();
  resetPrActionsState();
  prCreateToolUses.clear();
  // `api` es el store QUE SE ESTA CREANDO. Se usa para suscribirse a si mismo: con
  // `useWorkbenchStore.subscribe` (el singleton global) un store creado con un cliente de pruebas
  // cableaba el espejo del widget contra el store real de la app — justo el acoplamiento que la
  // decision A1 (inyectar el cliente) venia a quitar.
  const store = create<WorkbenchState>((set, get, api) => ({
    accounts: [],
    tabs: [],
    activeAccountId: '',
    activeTabId: '',
    newTabAnchorTabId: null,
    splitLayout: singleLeaf(''),
    context: CONTEXT_PLACEHOLDER,
    newTabOpen: false,
    addAccountOpen: false,
    handoffOpen: false,
    accountSwitchPrompt: null,
    settingsOpen: false,
    settingsSection: null,
    releaseNotesVersion: null,
    appVersion: '',
    settings: DEFAULT_APP_SETTINGS,
    promptFocusToken: 0,

    usageByAccount: {},
    usageErrorByAccount: {},
    agyUsageByAccount: {},
    permissionModes: null,
    status: null,

    blocksByChat: {},
    sessionIdByChat: {},
    streamingIdByChat: {},
    statusByChat: {},
    pendingByChat: {},
    turnStartByChat: {},
    lastActivityByChat: {},
    slashCommandsByChat: {},
    modelCatalogByAccount: {},
    subagentsByChat: {},
    contextUsageByChat: {},
    toolsByChat: {},
    extensionsByChat: {},
    activitySubagentByChat: {},
    dismissedSubagentsByChat: {},
    highlightedSessionId: null,
    gitByCwd: {},
    draftByChat: {},
    queuedByChat: {},
    resolvedModelByChat: {},
    scratchDir: null,
    rateLimitByChat: {},
    trustRequests: [],
    mcpServersByChat: {},
    conversationHistory: [],
    elicitationsByChat: {},
    backgroundSessions: {},
    closePromptOpen: false,
    updateState: IDLE_UPDATE_STATE,
    updatePromptVersion: null,

    // Cambiar de cuenta refresca su uso (cacheado en main; barato) para reflejarlo al instante.
    setActiveAccount: (accountId) => {
      set({ activeAccountId: accountId });
      void get().refreshUsage(accountId);
      void get().loadConversationHistory(); // refresca el historial de la nueva cuenta activa
    },

    requestAccountSwitch: (destAccountId) => {
      const state = get();
      const tab = state.tabs.find((t) => t.id === state.activeTabId);
      const plan = planAccountSwitch({
        activeTab: tab,
        status: state.statusByChat[state.activeTabId],
        liveSessionId: state.sessionIdByChat[state.activeTabId],
        destAccountId,
        destLoggedIn: state.accounts.find((a) => a.id === destAccountId)?.loginStatus === 'logged_in',
        hasBlocks: (state.blocksByChat[state.activeTabId]?.length ?? 0) > 0,
      });
      if (plan === 'ask' && tab !== undefined) {
        set({ accountSwitchPrompt: { tabId: tab.id, destAccountId } });
        return;
      }
      if (plan === 'reassign' && tab !== undefined) reassignNewChat(mage, get, set, { tabId: tab.id, destAccountId });
      get().setActiveAccount(destAccountId);
      // El turno sigue en su cuenta; en la destino se empieza de cero (D5).
      if (plan === 'switch-and-new-chat') void get().createConversation('shared');
    },

    closeAccountSwitchPrompt: () => set({ accountSwitchPrompt: null }),

    dismissSubagents: (tabId, toolUseIds) => {
      if (toolUseIds.length === 0) return;
      set((s) => {
        const current = s.dismissedSubagentsByChat[tabId] ?? [];
        return { dismissedSubagentsByChat: { ...s.dismissedSubagentsByChat, [tabId]: [...new Set([...current, ...toolUseIds])] } };
      });
    },

    openActivity: (tabId, subagentToolUseId) => {
      set((s) => ({
        activitySubagentByChat:
          subagentToolUseId === null ? without(s.activitySubagentByChat, tabId) : { ...s.activitySubagentByChat, [tabId]: subagentToolUseId },
      }));
      // Import dinamico: `panelLayoutStore` importa este modulo (mismo motivo que revealFilesPanelIfCreated).
      void import('./panelLayoutStore').then((m) => m.usePanelLayoutStore.getState().revealPanelById('activity'));
    },

    refreshGit: async (tabId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (tab === undefined || tab.cwd.length === 0) return;
      const params = { cwd: tab.cwd, accountDir: tab.accountId };
      try {
        const snapshot = await mage.gitStatus(params);
        const branches = snapshot.kind === 'repo' ? await mage.gitBranches(params) : [];
        set((s) => ({ gitByCwd: { ...s.gitByCwd, [tab.cwd]: { snapshot, branches, error: null } } }));
        // D28: repo en una carpeta sin confianza → se pregunta UNA vez con el dialogo de siempre.
        if (snapshot.kind === 'untrusted' && !gitTrustAsked.has(tab.cwd)) {
          gitTrustAsked.add(tab.cwd);
          if (await requestFolderTrust(mage, set, tab)) await get().refreshGit(tabId);
        }
      } catch (err) {
        // Sin estado nuevo la fila se queda como estaba (o sin chips): peor, pero no roto.
        console.warn('No se pudo leer el estado de git:', describeError(err));
      }
    },

    switchGitBranch: async (tabId, name) => {
      const state = get();
      const tab = state.tabs.find((t) => t.id === tabId);
      const view = tab === undefined ? undefined : state.gitByCwd[tab.cwd];
      if (tab === undefined || view?.snapshot.kind !== 'repo') return;
      // Revalida la guarda que la UI ya aplico (D26). Cuenta cualquier pestaña trabajando en la carpeta.
      const turnActive = state.tabs.some((t) => t.cwd === tab.cwd && isTurnLive(state.statusByChat[t.id]));
      const verdict = canSwitchBranch({ turnActive, dirty: view.snapshot.dirty, detached: view.snapshot.detached, worktree: worktreeOfCwd(tab.cwd) !== null });
      if (!verdict.allowed) throw new Error(verdict.reason);
      let error: string | null = null;
      try {
        await mage.gitSwitch({ cwd: tab.cwd, accountDir: tab.accountId, name });
      } catch (err) {
        error = describeError(err);
      }
      await get().refreshGit(tabId);
      if (error === null) return;
      const failed = error;
      set((s) => {
        const current = s.gitByCwd[tab.cwd];
        return current === undefined ? {} : { gitByCwd: { ...s.gitByCwd, [tab.cwd]: { ...current, error: failed } } };
      });
    },

    insertCommitPrompt: (tabId) => insertPromptIntoDraft(get, tabId, COMMIT_PROMPT),

    setWorktreeOff: (tabId, off) => set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, worktreeOff: off } : t)) })),

    mergeBaseIntoWorktree: async (tabId, base) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (tab === undefined) throw new Error(`Pestana inexistente: ${tabId}`);
      const result = await mage.worktreeMergeBase({ cwd: tab.cwd, accountDir: tab.accountId, base });
      await get().refreshGit(tabId);
      return result;
    },

    // PR y CI (grupo D): estado y acciones en `prActions.ts`.
    prByTab: {},
    ghRunsByTab: {},
    prGuardByChat: {},
    ...createPrActions({
      mage,
      get,
      set,
      persistTabs: () => schedulePersist(mage, get),
      persistSettings: () => scheduleSettingsPersist(mage, get),
      insertPrompt: (tabId, prompt) => insertPromptIntoDraft(get, tabId, prompt),
      sendToTab: (tabId, text) => get().sendMessageToTab(tabId, text),
      archiveTab: (tabId) => get().closeTab(tabId),
    }),

    setActiveTab: (tabId) => {
      // Invariante de la division (Ronda 3 item 13, generalizado en I11): `activeTabId` es el panel
      // ENFOCADO y ningun tabId aparece dos veces en el arbol. Si la pestaña que se activa YA esta
      // visible en otro panel, los dos se INTERCAMBIAN (nunca se duplica un panel); si no, ocupa el
      // sitio del panel enfocado. La guarda vive aqui, no en cada caller (TabBar, widget, jump list,
      // abrir del historial…): todos pasan por esta accion.
      const { activeTabId, splitLayout } = get();
      if (tabId === activeTabId) return;
      // Si la pestaña YA es visible en un panel, solo cambia el foco: NO se toca el arbol (B5).
      // Antes se intercambiaban los dos paneles, asi que cada clic sobre el panel de al lado los
      // barajaba bajo el cursor. El foco se pinta comparando `layout.tabId === activeTabId`, no por
      // posicion, asi que mover el arbol no hacia falta para nada.
      // Con grupos, "ya esta en el arbol" ya no basta: hay que ACTIVARLA dentro de su propia barra,
      // que es lo que hace que cada panel recuerde cual de sus pestañas enseña.
      if (findLeafPath(splitLayout, tabId) !== null) {
        set({ activeTabId: tabId, splitLayout: activateTab(splitLayout, tabId) });
        schedulePersist(mage, get);
        return;
      }
      // No estaba en ningun panel: entra en la barra del panel ENFOCADO (antes sustituia su contenido).
      const destino = findLeafPath(splitLayout, activeTabId) ?? firstLeafPath(splitLayout);
      set({ activeTabId: tabId, splitLayout: addTabToLeaf(splitLayout, destino, tabId) });
      schedulePersist(mage, get);
    },

    // Cierra una pestana: para su sesion (no dejar procesos huerfanos) y limpia su estado de motor.
    // EXCEPCION (decision del usuario, 2026-09-15): si el agente esta trabajando o esperando un
    // permiso, cerrar NO corta el trabajo — la sesion se queda viva "en segundo plano" y la
    // conversacion sale marcada en el panel de Conversaciones (`backgroundSessions`).
    closeTab: async (tabId, options) => {
      const sessionId = get().sessionIdByChat[tabId];
      const tab = get().tabs.find((t) => t.id === tabId);
      const background = sessionId !== undefined && tab !== undefined && shouldBackgroundOnClose(get().statusByChat[tabId]);
      if (background && sessionId !== undefined && tab !== undefined) {
        const entry: BackgroundSession = {
          sessionId,
          title: tab.title,
          accountId: tab.accountId,
          state: get().statusByChat[tabId] === 'needs_permission' ? 'needs_action' : 'working',
          sinceMs: Date.now(),
          alwaysAllowTools: tab.alwaysAllowTools ?? [],
        };
        set((s) => ({ backgroundSessions: { ...s.backgroundSessions, [sessionId]: entry } }));
        armBackgroundTtl(get, sessionId);
      }
      // Se ESPERA a que el CLI pare (B17). Borrar o mover la conversacion justo despues necesita que
      // nadie siga escribiendo su .jsonl: con `void` el borrado corria contra un proceso vivo y en
      // Windows el unlink fallaba. El comentario de la accion ya decia esto; el codigo no lo hacia.
      if (sessionId !== undefined && !background) await mage.stop(sessionId).catch(() => undefined);
      // Su store de transcripcion, con el listener del canal y las entradas ya leidas, se libera con
      // el resto de su estado por pestaña: es la misma fuga que B12, en otro sitio (4.1).
      disposeTranscriptStore(tabId);
      set((s) => {
        const tabs = s.tabs.filter((t) => t.id !== tabId);
        const activeTabId = s.activeTabId === tabId ? nextActiveAfterClose(tabs, s.splitLayout, tabId) : s.activeTabId;
        // El panel de la pestaña cerrada colapsa al hermano (o, si era el panel enfocado, la nueva
        // activa ocupa su sitio exacto) — ver `reconcileSplitLayoutAfterClose` (I11).
        const splitLayout = reconcileSplitLayoutAfterClose(s.splitLayout, tabId, activeTabId);
        return {
          tabs,
          activeTabId,
          splitLayout,
          blocksByChat: without(s.blocksByChat, tabId),
          sessionIdByChat: without(s.sessionIdByChat, tabId),
          streamingIdByChat: without(s.streamingIdByChat, tabId),
          statusByChat: without(s.statusByChat, tabId),
          pendingByChat: without(s.pendingByChat, tabId),
          elicitationsByChat: without(s.elicitationsByChat, tabId),
          slashCommandsByChat: without(s.slashCommandsByChat, tabId),
          subagentsByChat: without(s.subagentsByChat, tabId),
          contextUsageByChat: without(s.contextUsageByChat, tabId),
          rateLimitByChat: without(s.rateLimitByChat, tabId),
          mcpServersByChat: without(s.mcpServersByChat, tabId),
          toolsByChat: without(s.toolsByChat, tabId),
          extensionsByChat: without(s.extensionsByChat, tabId),
          activitySubagentByChat: without(s.activitySubagentByChat, tabId),
          dismissedSubagentsByChat: without(s.dismissedSubagentsByChat, tabId),
          draftByChat: without(s.draftByChat, tabId),
          queuedByChat: without(s.queuedByChat, tabId),
          resolvedModelByChat: without(s.resolvedModelByChat, tabId),
          // B12: estos dos faltaban. Se escriben por evento y se quedaban para siempre al cerrar la
          // pestaña — fuga pequeña, pero que crece con cada conversacion que se cierra.
          turnStartByChat: without(s.turnStartByChat, tabId),
          lastActivityByChat: without(s.lastActivityByChat, tabId),
          prByTab: without(s.prByTab, tabId),
          ghRunsByTab: without(s.ghRunsByTab, tabId),
          prGuardByChat: without(s.prGuardByChat, tabId),
        };
      });
      // Archivar (grupo D): su worktree se borra si esta limpio; con cambios se queda y se reabre con la
      // conversacion. La rama se queda siempre. En segundo plano el CLI sigue trabajando ahi: no se toca.
      if (tab !== undefined && !background && options?.moved !== true) archiveWorktree(mage, tab);
      // Su PR deja de vigilarse aqui; si la pestaña se fue a otra ventana, alli se vuelve a pedir.
      if (tab?.prNumber !== undefined) void mage.ghUnwatch(tabId).catch((err: unknown) => console.warn('No se pudo dejar de vigilar el PR:', describeError(err)));
      schedulePersist(mage, get);
      // Cerrar una pestana NO borra la conversacion (sigue en disco): recargar el historial para que
      // reaparezca como entrada del repertorio (M2.6).
      // Se ESPERA cuando la sesion se fue a segundo plano (auditoria B.1.5): la fila que informa de ese
      // trabajo se pinta SOLO sobre una fila de historial, asi que con `void` habia una carrera en la
      // que el CLI seguia vivo sin pestaña y sin fila ninguna que lo mostrara — solo lo mataba el TTL de
      // una semana. Ojo: esto cierra la carrera del listado, NO el caso de cambiar de cuenta (el
      // historial solo carga la activa), que sigue abierto como opcion (b) de la ficha.
      if (background) await get().loadConversationHistory();
      else void get().loadConversationHistory();
    },

    closeActiveTab: () => {
      const tabId = get().activeTabId;
      if (tabId.length > 0) void get().closeTab(tabId);
    },

    closeAllTabs: () => {
      for (const tab of tabsToCloseAll(get().tabs)) void get().closeTab(tab.id);
      // La de novedades no esta en `tabs`: «cerrar todas» tambien se la lleva.
      if (findLeafPath(get().splitLayout, RELEASE_NOTES_TAB_ID) !== null) void get().closeTab(RELEASE_NOTES_TAB_ID);
    },

    closeInactiveTabs: () => {
      for (const tab of tabsToCloseInactive(get().tabs, get().statusByChat)) void get().closeTab(tab.id);
    },

    discardBackgroundSession: async (sessionId) => {
      if (get().backgroundSessions[sessionId] === undefined) return;
      clearBackgroundTtl(sessionId);
      set((s) => ({ backgroundSessions: without(s.backgroundSessions, sessionId) }));
      await mage.stop(sessionId).catch(() => undefined);
    },

    movePaneTab: (draggedTabId, targetPath, zone) => {
      set((s) => ({ activeTabId: draggedTabId, splitLayout: applyDrop(s.splitLayout, draggedTabId, targetPath, zone) }));
      schedulePersist(mage, get);
    },

    resizeSplitAt: (path, ratio, totalPx = 0) => {
      // `totalPx` lo mide el renderer sobre el contenedor real: sin el, el minimo por panel solo se
      // puede acotar en fraccion y un panel se queda en 40 px con la ventana pequeña.
      set((s) => ({ splitLayout: resizeAt(s.splitLayout, path, ratio, totalPx) }));
      schedulePersist(mage, get);
    },

    toggleTabPinned: (tabId) => {
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, pinned: t.pinned !== true } : t)) }));
      schedulePersist(mage, get);
    },

    setTabColor: (tabId, colorIndex) => {
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== tabId) return t;
          // Se QUITA la clave al volver al acento de la cuenta (no se guarda un `undefined` explicito
          // que luego viaje al JSON persistido como ruido).
          const { colorIndex: _previous, ...rest } = t;
          return colorIndex === undefined ? rest : { ...rest, colorIndex };
        }),
      }));
      schedulePersist(mage, get);
    },

    cycleTab: (direction) => {
      const { tabs, activeTabId } = get();
      if (tabs.length === 0) return;
      const currentIndex = Math.max(0, tabs.findIndex((t) => t.id === activeTabId));
      const nextIndex = nextIndexForArrow(tabs.length, currentIndex, direction === 'next' ? 'ArrowRight' : 'ArrowLeft');
      const next = tabs[nextIndex];
      if (next === undefined) return;
      get().setActiveTab(next.id);
    },

    // Import DINAMICO (no estatico arriba) a proposito: panelLayoutStore.ts importa PANEL_REGISTRY de
    // panelRegistry.ts, que a su vez importa los componentes de contenido (ChatSidebar, PermissionPanel,
    // McpPanel...), y esos importan workbenchStore.ts para leer el estado de la app — un import ESTATICO
    // de panelLayoutStore aqui cerraria ese ciclo (panelRegistry.ts se quedaria con PANEL_REGISTRY
    // `undefined` a mitad de evaluar su propio modulo). El import dinamico resuelve DESPUES de que el
    // grafo de modulos ya esta estable, sin ese problema; el modulo ya esta cargado en la practica
    // (LeftDock/RightDock/StatusBar lo importan de forma estatica) asi que resuelve casi al instante.
    // Rollup avisa de que este modulo se importa dinamica Y estaticamente y por tanto "no se movera a
    // otro chunk". El aviso es CORRECTO y esperado: aqui el import() no busca partir el bundle, busca
    // romper el ciclo de evaluacion. No se "arregle" pasandolo a estatico — eso reintroduce el bug.
    toggleSidebar: () => void import('./panelLayoutStore').then((m) => m.usePanelLayoutStore.getState().togglePanelById('conversations')),
    toggleInspector: () => void import('./panelLayoutStore').then((m) => m.usePanelLayoutStore.getState().togglePanelById('permissions')),
    focusPrompt: () => set((s) => ({ promptFocusToken: s.promptFocusToken + 1 })),

    focusNotificationTarget: (target) => {
      const s = get();
      const destination = resolveNotificationTarget(target, {
        tabs: s.tabs,
        sessionIdByChat: s.sessionIdByChat,
        backgroundAccountBySession: Object.fromEntries(Object.values(s.backgroundSessions).map((b) => [b.sessionId, b.accountId])),
        historySessionIds: new Set(s.conversationHistory.map((c) => c.sessionId)),
      });
      if (destination.kind === 'none') return;
      if (destination.kind === 'history') {
        if (destination.accountId !== null) s.setActiveAccount(destination.accountId);
        set({ highlightedSessionId: destination.sessionId });
        return;
      }
      s.setActiveAccount(destination.accountId);
      s.setActiveTab(destination.tabId);
      s.focusPrompt();
      if (target.opensActivity === true) s.openActivity(destination.tabId, null);
    },

    // Arranque del shell: suscribe UNA vez el stream del motor y carga las cuentas reales.
    init: () => {
      if (!engineSubscribed) {
        engineSubscribed = true;
        mage.onSessionEvent((payload: SessionEventPayload) =>
          get().handleEvent(payload.sessionId, payload.event),
        );
      }
      // Widget flotante (M3): cablea una sola vez el espejo de estado. (a) empuja un snapshot al widget
      // ante cualquier cambio del store (debounce); (b) el clic en un agente del widget activa su pestana
      // (y cuenta); (c) si la preferencia cambia fuera del renderer (tray/cierre), la refleja y persiste
      // sin re-notificar a main (evita el bucle).
      if (!widgetSubscribed) {
        widgetSubscribed = true;
        api.subscribe(() => scheduleWidgetPush(mage, get));
        mage.onWidgetFocusTab((tabId) => {
          const tab = get().tabs.find((t) => t.id === tabId);
          if (tab === undefined) return;
          get().setActiveAccount(tab.accountId);
          get().setActiveTab(tabId);
        });
        mage.onNotificationClicked((target) => get().focusNotificationTarget(target));
        mage.onWidgetEnabledChanged((enabled) => {
          set((s) => ({ settings: { ...s.settings, widgetEnabled: enabled } }));
          scheduleSettingsPersist(mage, get);
          if (enabled) pushWidgetSnapshotNow(mage, get());
        });
        // Jump list de Windows (Ronda 3, item 10). Main ya resolvio la conversacion en disco: aqui solo
        // se activa la cuenta y se abre. Sin conversacion, la entrada era la de la cuenta -> dialogo de
        // conversacion nueva, que es lo que ofrece esa categoria.
        mage.onJumpListOpen(({ accountDir, conversation }) => {
          if (!get().accounts.some((a) => a.id === accountDir)) return; // cuenta borrada desde que se pinto
          get().setActiveAccount(accountDir);
          if (conversation === undefined) get().openNewTab();
          else get().openConversation(conversation);
        });
      }
      const workspaceRestored = get()
        .refreshAccounts()
        .then(() => get().restoreWorkspace()) // reabre las pestanas guardadas (tras conocer las cuentas)
        // Y DESPUES lo que otra ventana le mando al abrirla (P-028, 36): con las cuentas ya cargadas,
        // que es lo que `adoptTab` necesita para no descartarla.
        .then(() => get().adoptPendingTabs());
      void workspaceRestored
        .then(() => get().refreshActiveUsage())
        .then(() => get().loadConversationHistory()); // historial de la cuenta activa (M2.6)
      void get().refreshStatus();
      // Modos de permiso leidos de cada CLI (respuesta 18). Sin ellos, la lista fija de Mage.
      void mage
        .listPermissionModes()
        .then((permissionModes) => set({ permissionModes }))
        .catch((err: unknown) => console.warn('No se pudieron leer los modos de permiso de los CLI:', describeError(err)));
      // Configuracion de la app (M2.3): carga tolerante (main devuelve defaults si no hay fichero). Al
      // llegar, reconcilia el tema (el hint de localStorage se aplico antes de montar) con la preferencia
      // real del fichero y lo aplica al DOM.
      const settingsLoaded = mage.loadSettings().then((settings) => {
        applyThemeFromSettings(settings, systemPrefersDark());
        mage.setUiScale(settings.uiScale);
        set((s) => ({ settings, accounts: applyAccentOverrides(s.accounts, settings.accentByAccount) }));
      });
      settingsLoaded.catch((err: unknown) => console.warn('No se pudo cargar la configuracion:', describeError(err)));
      // Novedades: DESPUES de restaurar el workspace (si no, restaurar reescribe `splitLayout` y se come
      // la pestaña) y con los ajustes reales. Si alguno falla no se decide nada: con los ajustes por
      // defecto esto parece una instalacion nueva y guardaria encima de los del usuario.
      void Promise.all([workspaceRestored, settingsLoaded])
        .then(() => get().showReleaseNotesIfUpdated(isReleaseNotesDevRun()))
        .catch((err: unknown) => console.warn('No se pudieron comprobar las novedades:', describeError(err)));

      // MULTIVENTANA: los ajustes son COMPARTIDOS entre ventanas, asi que un cambio hecho en otra tiene
      // que llegar aqui. main ya lo ha guardado en disco y NUNCA se lo reenvia a la ventana que lo
      // origino, asi que aqui solo se aplica al estado y al DOM: volver a guardarlo montaria un
      // ping-pong de escrituras entre ventanas.
      mage.onSettingsChanged((settings) => {
        applyThemeFromSettings(settings, systemPrefersDark());
        mage.setUiScale(settings.uiScale);
        set((s) => ({ settings, accounts: applyAccentOverrides(s.accounts, settings.accentByAccount) }));
      });

      // Una pestaña que llega de otra ventana (la arrastraste fuera, o la mandaste por el menu). Se
      // adopta tal cual y se abre en el panel enfocado.
      mage.onTabReceived((persisted) => {
        get().adoptTab(persisted);
      });

      // Grupo B: los dialogos propios de cierre y de actualizacion los pide main. El estado de la
      // actualizacion se pide ademas al arrancar: una ventana que carga tarde (o se recarga) no ha
      // recibido la difusion.
      mage.onClosePrompt(() => set({ closePromptOpen: true }));
      mage.onUpdateState((updateState) => set({ updateState }));
      mage.onUpdatePrompt((version) => set({ updatePromptVersion: version }));
      void mage
        .getUpdateState()
        .then((updateState) => set({ updateState }))
        .catch((err: unknown) => console.warn('No se pudo leer el estado de la actualización:', describeError(err)));

      // PR vigilados (grupo D): cada lectura de main llega aqui, solo a esta ventana.
      mage.onGhPrUpdate((update) => get().applyGhPrUpdate(update));

      // El sondeo de modelos de arranque (P-026 2.4) termina cuando el selector ya esta pintado.
      mage.onModelCatalogChanged(({ configDir, models }) => {
        set((s) => ({ modelCatalogByAccount: { ...s.modelCatalogByAccount, [configDir]: models } }));
      });
    },

    // A una ventana NUEVA por el transporte "pull" (P-028, 36): antes se abria la ventana y se le
    // empujaba la pestaña antes de que su renderer escuchara, asi que se perdia en las dos.
    openInNewWindow: async (tabId) => {
      const persisted = movableTab(get(), tabId);
      await mage.openWindowWithTab(persisted);
      await get().closeTab(tabId, { moved: true });
    },

    moveTabToWindow: async (tabId, targetWindowId) => {
      const persisted = movableTab(get(), tabId);
      // La pestaña se cierra AQUI solo si la otra ventana la acepto: si la ventana destino ya no existe
      // el IPC lanza, y cerrarla antes habria perdido la conversacion de la vista sin ganar nada.
      await mage.moveTabToWindow({ targetWindowId, tab: persisted });
      await get().closeTab(tabId, { moved: true });
    },

    dropTabOutside: async (tabId) => {
      const persisted = movableTab(get(), tabId);
      const outcome = await mage.dropTabOutside(persisted);
      if (outcome === 'moved') await get().closeTab(tabId, { moved: true });
    },

    openConversationInNewWindow: async (item) => {
      const openTab = tabOfConversation(get(), item.sessionId);
      if (openTab !== undefined) return get().openInNewWindow(openTab.id);
      await mage.openWindowWithTab(await conversationForOtherWindow(mage, get, item));
    },

    dropConversationOutside: async (item) => {
      const openTab = tabOfConversation(get(), item.sessionId);
      if (openTab !== undefined) return get().dropTabOutside(openTab.id);
      await mage.dropTabOutside(await conversationForOtherWindow(mage, get, item));
    },

    adoptPendingTabs: async () => {
      const pending = await mage.takePendingTabs();
      for (const persisted of pending) get().adoptTab(persisted);
    },

    adoptTab: (persisted) => {
      const { accounts } = get();
      const restored = restoreTabs({ version: 1, activeTabId: persisted.id, tabs: [persisted] }, new Set(accounts.map((a) => a.id)));
      const [received] = restored.tabs;
      // Una pestaña de una cuenta que esta ventana no conoce no se puede abrir: se dice, no se traga.
      if (received === undefined) {
        console.warn('Llego una pestaña de otra ventana para una cuenta que no existe aqui:', persisted.accountId);
        return;
      }
      // Id LOCAL nuevo: cada ventana cuenta sus `tabN` desde 1, asi que el id de origen puede estar ya
      // ocupado aqui (dos pestañas con el mismo id comparten bloques, estado y panel).
      advanceTabSeqPast(get().tabs);
      const tab: Tab = { ...received, id: nextTabId() };
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        splitLayout: addTabToLeaf(s.splitLayout, findLeafPath(s.splitLayout, s.activeTabId) ?? firstLeafPath(s.splitLayout), tab.id),
      }));
      schedulePersist(mage, get);
      // Su PR se vigila ahora desde esta ventana (la de origen lo solto al cerrarla).
      if (tab.prNumber !== undefined) void get().refreshPr(tab.id);
    },

    // Restaura las pestanas del arranque anterior (M2.5). Descarta las de cuentas ya inexistentes; NO
    // arranca sesiones (resume perezoso: ensureSession usa `--resume` al primer mensaje). No-op si no
    // hay estado guardado o no queda ninguna pestana restaurable.
    restoreWorkspace: async () => {
      const persisted = await mage.loadWorkspace();
      if (persisted === null) return;
      const existing = new Set(get().accounts.map((a) => a.id));
      const { tabs, activeTabId, splitLayout } = restoreTabs(persisted, existing);
      if (tabs.length === 0) return;
      advanceTabSeqPast(tabs); // evita que una pestana nueva reutilice un id restaurado
      set((s) => ({
        tabs,
        activeTabId,
        splitLayout,
        activeAccountId: tabs.find((t) => t.id === activeTabId)?.accountId ?? s.activeAccountId,
      }));
      // Los PR vinculados se vuelven a vigilar al arrancar, esten o no a la vista (DN-8: sin foco).
      for (const tab of tabs) if (tab.prNumber !== undefined) void get().refreshPr(tab.id);
    },

    // Descubre las cuentas en disco y las mapea a presentacion. Conserva la cuenta activa si sigue
    // existiendo; si no, elige la primera con login (o la primera disponible).
    loadModelCatalog: async (configDir) => {
      if (configDir.length === 0 || get().modelCatalogByAccount[configDir] !== undefined) return;
      const models = await mage.loadModelCatalog(configDir);
      if (models.length === 0 || get().modelCatalogByAccount[configDir] !== undefined) return;
      set((s) => ({ modelCatalogByAccount: { ...s.modelCatalogByAccount, [configDir]: models } }));
    },

    refreshAccounts: async () => {
      const infos = await mage.listAccounts();
      // Catalogo de modelos de cada cuenta (P-026 2.4): en segundo plano, no retrasa la lista.
      for (const info of infos) {
        void get()
          .loadModelCatalog(info.configDir)
          .catch((err: unknown) => console.warn('No se pudo leer el catalogo de modelos:', describeError(err)));
      }
      set((s) => {
        // toAccountView repone el placeholder de uso; re-fusionamos el uso real ya conocido para no
        // parpadear a 0% mientras se re-descubren las cuentas (el placeholder solo queda si no hay dato).
        const accounts = infos.map((infoItem, index) => {
          const view = toAccountView(infoItem, index, s.settings.accentByAccount[infoItem.configDir]);
          const info = s.usageByAccount[view.id];
          return info === null || info === undefined ? view : { ...view, usage: toUsageWindows(info, Date.now()) };
        });
        return {
          accounts,
          activeAccountId: accounts.some((a) => a.id === s.activeAccountId)
            ? s.activeAccountId
            : pickDefaultAccountId(accounts),
        };
      });
      confirmCodexAccounts(mage, infos, (confirmed) => set((state) => ({ accounts: applyCodexConfirmation(state.accounts, confirmed) })));
    },

    // Abre una pestana real ligada a {cuenta, proyecto, modelo}. La sesion del motor se crea perezosa
    // al primer mensaje (ensureSession) para no lanzar procesos hasta que se use.
    newTab: async ({ accountId, cwd, model, provider, title, effort, maxBudgetUsdCents, privacy, permissionMode, projectId, importedContext }) => {
      // El runtime propio no necesita cuenta (A6 de la revision de P-032): una pestaña de Ollama abre
      // aunque no haya ninguna cuenta de Claude, Codex ni agy.
      const accountRequired = !runsOnMageRuntime(provider);
      if ((accountRequired && accountId.length === 0) || cwd.length === 0 || model.length === 0 || provider.length === 0) {
        throw new Error(`Parametros de pestana invalidos: cuenta="${accountId}" cwd="${cwd}" modelo="${model}" proveedor="${provider}"`);
      }
      const account = get().accounts.find((candidate) => candidate.id === accountId);
      if (accountRequired && account?.providerId !== provider) {
        throw new Error(`La cuenta ${JSON.stringify(accountId)} no pertenece al proveedor ${JSON.stringify(provider)}`);
      }
      const alias = get().accounts.find((a) => a.id === accountId)?.alias ?? (accountId || providerLabel(provider, get().settings.customProviders));
      // TODAS las rutas que crean pestañas pasan por aqui (nueva conversacion, dialogo, clon): el modo por
      // defecto de Ajustes (P-028 6) se aplica en un solo sitio. Solo Claude tiene modos de permiso.
      const initialMode = permissionMode ?? (provider === 'claude' ? get().settings.defaultPermissionMode : '');
      const tab: Tab = {
        id: nextTabId(),
        accountId,
        accountAlias: alias,
        cwd,
        model,
        provider,
        ...(initialMode.length === 0 ? {} : { permissionMode: initialMode }),
        title: title ?? deriveTitle(cwd),
        ...(projectId === undefined ? {} : { projectId }),
        ...(importedContext === undefined ? {} : { importedContext }),
        privacy: privacy ?? 'shared',
        // Una conversacion recien creada es la mas reciente de su seccion hasta que se escriba en otra.
        createdAtMs: Date.now(),
        ...(effort === undefined || effort.length === 0 ? {} : { effort }),
        ...(maxBudgetUsdCents === undefined ? {} : { maxBudgetUsdCents }),
      };
      // La pestaña nueva ocupa el sitio EXACTO del panel enfocado (I11): igual que `setActiveTab` con un
      // tabId que no estaba visible en ningun lado — nunca resetea una division que hubiera.
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        activeAccountId: accountId,
        splitLayout: addTabToLeaf(s.splitLayout, paneForNewTab(s), tab.id),
        newTabAnchorTabId: null,
      }));
      get().focusPrompt(); // el cursor listo para escribir (sin tener que clicar el input)
      schedulePersist(mage, get);
    },

    // Crea una conversacion sin friccion (M2.6): la cuenta activa, una carpeta temporal (scratch), el
    // modelo auto-resuelto (ultimo usado en la cuenta -> configurado -> sonnet) y el titulo placeholder
    // (el primer prompt lo fija). `privacy` viene de la seccion del sidebar (compartida/privada).
    createConversation: async (privacy, folder = {}) => {
      const accountId = get().activeAccountId;
      const account = get().accounts.find((a) => a.id === accountId);
      if (account === undefined) {
        // Sin ninguna cuenta: si hay un proveedor del usuario, la conversacion es suya (A6).
        const fallback = runtimeTabWithoutAccount(get().settings, privacy);
        if (fallback !== null) await get().newTab({ ...fallback, cwd: await resolveNewConversationCwd(mage, get(), folder), projectId: folder.projectId });
        return;
      }
      const cwd = await resolveNewConversationCwd(mage, get(), folder);
      // Una cuenta de otro CLI (Codex, agy por clave) abre conversaciones de SU proveedor (grupo E).
      if (account.providerId === CODEX_PROVIDER_ID || account.providerId === AGY_PROVIDER_ID) {
        await get().newTab({ ...newTabForProviderAccount(account, cwd, privacy, get().settings), projectId: folder.projectId, importedContext: folder.importedContext });
        return;
      }
      // Ultima conversacion Claude de la cuenta (las pestanas se anaden al final -> la ultima es la mas
      // reciente); su modelo es el "ultimo usado". Sobrevive reinicios porque las pestanas se restauran.
      const lastTab = [...get().tabs].reverse().find((t) => t.accountId === accountId && t.provider === 'claude');
      const model = resolveDefaultModel({
        lastUsedModel: lastTab?.model ?? null,
        accountDefaultModel: account.defaultModel,
        // F3: el modelo configurado para el proveedor manda sobre la heuristica del ultimo usado.
        providerDefaultModel: get().settings.defaultModelByProvider.claude ?? null,
      });
      // El ESFUERZO por defecto del proveedor, igual que el modelo. '' = "Automatico", que significa
      // no pasar el flag y dejar que mande el ultimo valor de la conversacion / el default del CLI.
      const effort = defaultEffortForProvider(get().settings.defaultModelByProvider, 'claude');
      await get().newTab({
        accountId,
        cwd,
        model,
        provider: 'claude',
        title: NEW_CONVERSATION_TITLE,
        privacy,
        projectId: folder.projectId,
        importedContext: folder.importedContext,
        ...(effort.length === 0 ? {} : { effort }),
      });
    },

    // Renombra una pestana (M2.6). Ignora un titulo vacio (no deja la pestana sin nombre). Persiste.
    setDraft: (tabId, draft) => {
      if (tabId.length === 0) return;
      // Un borrador VACIO se borra en vez de guardarse: si no, cada pestaña por la que has pasado
      // dejaria una entrada muerta en el mapa.
      const vacio = draft === null || (draft.text.length === 0 && draft.attachments.length === 0);
      set((s) => ({ draftByChat: vacio ? without(s.draftByChat, tabId) : { ...s.draftByChat, [tabId]: draft } }));
    },

    editQueuedMessage: (tabId, id) => {
      const message = (get().queuedByChat[tabId] ?? []).find((m) => m.id === id);
      if (message === undefined) return;
      get().removeQueuedMessage(tabId, id);
      get().setDraft(tabId, mergeIntoDraft([message], get().draftByChat[tabId] ?? NO_DRAFT));
    },

    removeQueuedMessage: (tabId, id) => {
      set((s) => {
        const rest = withoutQueuedMessage(s.queuedByChat[tabId] ?? [], id);
        return { queuedByChat: rest.length === 0 ? without(s.queuedByChat, tabId) : { ...s.queuedByChat, [tabId]: rest } };
      });
    },

    renameTab: (tabId, title) => {
      const clean = title.trim();
      if (clean.length === 0) return;
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, title: clean } : t)) }));
      schedulePersist(mage, get);
    },

    // El usuario renombra la conversacion en Mage (P-026, D3): ademas del titulo local, el CLI recibe
    // `/rename` para que su transcripcion —y `/resume` en el terminal— digan lo mismo. Gana el ultimo
    // nombre. Solo se manda con la sesion viva y OCIOSA: en mitad de un turno, el `result` del comando
    // se cruzaria con el del turno. Si no, queda pendiente y sale al acabar el siguiente turno.
    renameConversation: (tabId, title) => {
      const clean = title.trim();
      if (clean.length === 0) return;
      get().renameTab(tabId, clean);
      const tab = get().tabs.find((t) => t.id === tabId);
      if (tab === undefined || !writesClaudeTranscript(tab.provider)) return;
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, pendingCliTitle: clean } : t)) }));
      schedulePersist(mage, get);
      flushPendingCliTitle(mage, get, set, tabId);
    },

    saveChatProject: async (project) => {
      const clean = { ...project, name: project.name.trim(), instructions: project.instructions.trim(), cwd: project.cwd?.trim() || null };
      if (clean.name.length === 0) return;
      set((s) => ({ settings: { ...s.settings, chatProjects: [...s.settings.chatProjects.filter((p) => p.id !== clean.id), clean] } }));
      await mage.saveSettings(get().settings);
    },
    deleteChatProject: (projectId) => {
      set((s) => ({
        settings: { ...s.settings, chatProjects: s.settings.chatProjects.filter((p) => p.id !== projectId) },
        tabs: s.tabs.map((t) => t.projectId === projectId ? { ...t, projectId: undefined } : t),
      }));
      scheduleSettingsPersist(mage, get);
      schedulePersist(mage, get);
    },
    assignChatProject: (sessionId, tabId, projectId) => {
      set((s) => ({
        settings: { ...s.settings, chatProjects: s.settings.chatProjects.map((p) => ({
          ...p, sessionIds: projectId === p.id && sessionId !== undefined
            ? [...new Set([...p.sessionIds, sessionId])]
            : p.sessionIds.filter((id) => id !== sessionId),
        })) },
        tabs: tabId === undefined ? s.tabs : s.tabs.map((t) => t.id === tabId ? { ...t, projectId: projectId ?? undefined } : t),
      }));
      scheduleSettingsPersist(mage, get);
      schedulePersist(mage, get);
    },

    // Carga el historial en disco de la cuenta activa (M2.6). Tolerante: un fallo no rompe el shell.
    loadConversationHistory: async () => {
      const accountId = get().activeAccountId;
      if (accountId.length === 0 || !HISTORY_PROVIDERS.includes(get().accounts.find((account) => account.id === accountId)?.providerId ?? '')) {
        set({ conversationHistory: [] });
        return;
      }
      try {
        const list = await mage.listConversations(accountId);
        if (get().activeAccountId !== accountId) return; // cambio de cuenta mientras cargaba: descartar
        set({ conversationHistory: list });
      } catch (err) {
        console.warn('No se pudo cargar el historial de conversaciones:', describeError(err));
      }
    },

    // Abre una conversacion del historial (M2.6). La cuenta ACTIVA es la que manda: una conversacion
    // compartida se abre con la cuenta que este seleccionada, sin que la app cambie de cuenta por detras
    // (`projects/` es comun a todas, asi que la misma transcripcion se ve desde cualquiera). La unica
    // excepcion es que ya este VIVA bajo otra cuenta: ahi se va a donde esta, porque dos procesos del CLI
    // sobre la misma transcripcion la corromperian. La decision vive en planOpenConversation (pura).
    // La sesion arranca perezosa al primer mensaje (ensureSession con --resume). Solo Claude.
    openConversation: async (item) => {
      // Reabrir una conversacion que quedo en segundo plano CORTA su sesion viva y la reanuda con
      // `--resume` (decision del usuario, 2026-09-15): dos procesos del CLI no pueden escribir la misma
      // transcripcion, y re-engancharse a la viva era el camino caro. Si estaba esperando un permiso,
      // ese turno se pierde y hay que repetir la orden.
      await get().discardBackgroundSession(item.sessionId);
      const accountId = get().activeAccountId;
      const account = get().accounts.find((a) => a.id === accountId);
      const plan = planOpenConversation({
        tabs: get().tabs,
        sessionIdByChat: get().sessionIdByChat,
        activeAccountId: accountId,
        sessionId: item.sessionId,
      });
      if (plan.action !== 'create') {
        set((s) => ({
          activeTabId: plan.tabId,
          // Misma regla que `setActiveTab` (I11): si `plan.tabId` ya esta visible en otro panel, se
          // intercambia; si no, ocupa el sitio exacto del panel enfocado. Aqui no se puede delegar en
          // `setActiveTab` porque este `set()` toca a la vez otros campos (cuenta activa, reasignacion).
          splitLayout:
            findLeafPath(s.splitLayout, plan.tabId) !== null
              ? activateTab(s.splitLayout, plan.tabId)
              : addTabToLeaf(s.splitLayout, findLeafPath(s.splitLayout, s.activeTabId) ?? firstLeafPath(s.splitLayout), plan.tabId),
          // 'follow': la conversacion esta VIVA bajo otra cuenta, asi que el rail va con ella. En los
          // demas casos la cuenta activa NO se toca: es ella la que manda al abrir del historial.
          ...(plan.action === 'follow' ? { activeAccountId: plan.accountId } : {}),
          // 'reassign': la pestana estaba abierta en otra cuenta pero sin sesion viva -> pasa a la cuenta
          // activa (con su alias y su config dir efectivo), que es lo que se espera de una conversacion
          // compartida al abrirla teniendo otra cuenta seleccionada.
          ...(plan.action === 'reassign'
            ? {
                tabs: s.tabs.map((t) =>
                  t.id === plan.tabId
                    ? { ...t, accountId, accountAlias: account?.alias ?? accountId, resolvedConfigDir: item.configDir }
                    : t,
                ),
              }
            : {}),
        }));
        get().focusPrompt();
        schedulePersist(mage, get);
        return;
      }
      // Indice propio de Mage (2.1): modelo, esfuerzo y modo de permiso con los que se dejo ESTA
      // conversacion. Se lee ANTES de construir la Tab a proposito: `effort` es un flag de ARRANQUE del
      // CLI, asi que ponerlo despues del primer `ensureSession` no tendria ningun efecto.
      const indexPrefs = await loadConversationPrefsSafely(mage, item.sessionId);
      const prefs = resolveReopenedTabPrefs({
        indexPrefs,
        accountDefaultModel: account?.defaultModel ?? null,
        // HALLAZGO 3: esta linea faltaba — reabrir del historial se saltaba el ajuste de "🧠 Modelos"
        // que `createConversation` si respeta.
        providerDefaultModel: get().settings.defaultModelByProvider.claude ?? null,
      });
      // El modelo de Claude de la cuenta/índice no vale para otro CLI: se parte del suyo.
      const providerModel = item.providerId === undefined || item.providerId === 'claude' ? null
        : (get().settings.defaultModelByProvider[item.providerId] ?? providerFallbackModel(item.providerId, get().settings.customProviders));
      const reopened = tabFromConversation({ id: nextTabId(), item, accountId, accountAlias: account?.alias ?? accountId,
        prefs: providerModel === null ? prefs : { ...prefs, model: providerModel } });
      const project = get().settings.chatProjects.find((p) => p.sessionIds.includes(item.sessionId) || (p.cwd !== null && p.cwd === item.cwd));
      const tab = project === undefined ? reopened : { ...reopened, projectId: project.id };
      set((s) => ({
        tabs: [...s.tabs, tab],
        activeTabId: tab.id,
        activeAccountId: accountId,
        splitLayout: addTabToLeaf(s.splitLayout, paneForNewTab(s), tab.id),
        newTabAnchorTabId: null,
      }));
      get().focusPrompt();
      schedulePersist(mage, get);
    },

    // Cierra la pestana abierta de una conversacion (por sessionId) para que ningun proceso siga
    // escribiendo su .jsonl antes de borrarlo/moverlo. No-op si no esta abierta.
    deleteConversation: async (sessionId, cwd, privacy) => {
      const accountDir = get().activeAccountId;
      if (accountDir.length === 0 || sessionId.length === 0) return;
      // ORDEN: primero cerrar la pestaña, DESPUES parar la sesion. Al reves no valia: `closeTab` manda
      // a segundo plano (sin parar el CLI) la conversacion que este trabajando, asi que el `discard`
      // previo era no-op y el .jsonl se borraba con el proceso escribiendolo — B17 por otra puerta.
      await closeMatchingTab(get, sessionId);
      await get().discardBackgroundSession(sessionId);
      try {
        await mage.deleteConversation({ accountDir, sessionId, cwd, privacy });
      } catch (err) {
        reportActionError('No se pudo eliminar la conversación', err, 'history');
      }
      await get().loadConversationHistory();
    },

    moveConversation: async (sessionId, cwd, privacy, destAccountDir, destPrivacy, sourceAccountDir) => {
      const accountDir = sourceAccountDir ?? get().activeAccountId;
      if (accountDir.length === 0 || sessionId.length === 0) return;
      // Sin cambio real de ubicacion: nada que hacer.
      if (accountDir === destAccountDir && privacy === destPrivacy) return;
      await closeMatchingTab(get, sessionId); // mismo orden que al borrar: cerrar y LUEGO parar
      await get().discardBackgroundSession(sessionId);
      // El error SUBE (P-026 2.7): tragarselo con un console.warn dejaba a `continueInAccount` cambiando
      // de cuenta y reabriendo nada, sin decir por que. El historial se refresca igual.
      try {
        await mage.moveConversation({ accountDir, sessionId, cwd, privacy, destAccountDir, destPrivacy });
      } finally {
        await get().loadConversationHistory();
      }
    },

    // H4 ("al acabarse el uso, poder continuar en otra cuenta"). No hay nada nuevo debajo: mover el
    // .jsonl y reabrirlo ya existian por separado (menu del sidebar + historial), y el CLI reanuda con
    // `--resume <sessionId>`. Lo unico que faltaba era encadenarlos sin que el usuario tenga que saber
    // que ese es el camino.
    //
    // El orden importa: primero MOVER (con la cuenta origen explicita, que con el workspace dividido no
    // es por fuerza la activa), luego activar la cuenta destino, y solo entonces recargar el historial
    // —el de la cuenta NUEVA, que es donde ya esta la conversacion— para poder reabrirla.
    continueInAccount: async (tabId, destAccountId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      // Una pestaña restaurada no tiene sesion viva, solo `resumeSessionId` (mismo criterio que el
      // handoff): sin esto no hacia nada, en silencio (P-026 2.7).
      const sessionId = get().sessionIdByChat[tabId] ?? tab?.resumeSessionId;
      if (tab === undefined || sessionId === undefined || sessionId.length === 0) return;
      if (destAccountId === tab.accountId) return;
      // Entre cuentas de Claude se mueve la transcripción; en cualquier otro caso se traduce a formato nativo del
      // destino y sigue siendo LA MISMA conversación (la de origen se retira).
      if (![tab.accountId, destAccountId].every((id) => get().accounts.find((a) => a.id === id)?.providerId === 'claude')) {
        await migrateToOtherProvider(get, mage, { tabId, sessionId, destAccountId });
        return;
      }
      await get().moveConversation(sessionId, tab.cwd, tab.privacy, destAccountId, tab.privacy, tab.accountId);
      get().setActiveAccount(destAccountId);
      await get().loadConversationHistory();
      const moved = get().conversationHistory.find((c) => c.sessionId === sessionId);
      // Sin entrada en el historial no se reabre nada: es preferible dejar al usuario en la cuenta
      // nueva con el sidebar cargado que abrir una pestana apuntando a un fichero que no aparecio.
      if (moved !== undefined) get().openConversation(moved);
    },

    continueWithHistoryIn: async (tabId, destAccountId) => {
      const tab = get().tabs.find((t) => t.id === tabId);
      if (tab === undefined || destAccountId === tab.accountId) return;
      const context = importedConversationContext(get().blocksByChat[tabId] ?? [], { title: tab.title, fromProvider: providerLabel(tab.provider, get().settings.customProviders) }, get().settings.importedContextMaxChars);
      get().setActiveAccount(destAccountId);
      await get().createConversation(tab.privacy, { cwd: tab.cwd, ...(context === null ? {} : { importedContext: context }) });
    },

    answerTrustRequest: async (folder, granted) => {
      const pending = trustAnswersInFlight.get(folder);
      trustAnswersInFlight.delete(folder);
      set((s) => ({
        trustRequests: s.trustRequests.filter((f) => f !== folder),
        // La carpeta se guarda TAL CUAL la dio el selector: main la normaliza al comparar, y asi el
        // renderer no necesita una copia de la logica de rutas (que ademas es de `node:path`).
        ...(granted ? { settings: { ...s.settings, trustedFolders: [...s.settings.trustedFolders, folder] } } : {}),
      }));
      // Se guarda AQUI, sin debounce y ESPERANDO, y no con `scheduleSettingsPersist` como el resto de
      // ajustes: main decide si deja arrancar la sesion leyendo `trustedFolders` del fichero, y la
      // sesion que espera al dialogo arranca en cuanto se le conteste. Con el debounce de siempre (que
      // esta para agrupar rafagas de edicion de reglas) pediria permiso antes de que el permiso
      // estuviera escrito, y main se lo negaria con toda la razon.
      if (granted) {
        try {
          await mage.saveSettings(get().settings);
        } catch (err) {
          // No se convierte en un "no" a espaldas del usuario: se traza y se deja pasar. Main volvera a
          // mirar el fichero y negara el arranque con su mensaje, que es mas claro que un dialogo que
          // se cierra y no hace nada.
          console.warn('No se pudo guardar la carpeta autorizada:', describeError(err));
        }
      }
      pending?.answer(granted);
    },

    ensureScratchDir: async () => {
      if (get().scratchDir !== null) return;
      try {
        set({ scratchDir: await mage.getScratchRoot() });
      } catch (err) {
        // Sin esto la etiqueta de carpeta enseña el ultimo segmento (un UUID) en vez de "Scratchpad":
        // peor, pero no roto. Se traza y no se reintenta en bucle.
        console.warn('No se pudo resolver la carpeta de borradores:', describeError(err));
      }
    },

    revokeTrustedFolder: async (folder) => {
      set((s) => ({ settings: { ...s.settings, trustedFolders: s.settings.trustedFolders.filter((f) => f !== folder) } }));
      // Tambien sin debounce, y aqui la prisa es la que importa de verdad: quitar un permiso que sigue
      // escrito en disco durante medio segundo es el lado MALO de equivocarse.
      try {
        await mage.saveSettings(get().settings);
      } catch (err) {
        console.warn('No se pudo retirar la carpeta autorizada:', describeError(err));
      }
    },

    // Consulta el uso real de una cuenta (main cachea >=180 s) y lo fusiona en la Account de
    // presentacion (asi StatusBar/UsagePanel/Popover leen account.usage sin cambios). Ante error
    // (p.ej. sin login) guarda el mensaje en usageErrorByAccount para el dashboard; nunca lo traga.
    refreshUsage: async (configDir) => {
      if (configDir.length === 0) return;
      // Uso de SUSCRIPCION: Claude por su endpoint, Codex por lo que trae su sesion (`usage_limits`). Una
      // cuenta que factura la API no tiene ventanas, y agy por clave tampoco (el de su suscripcion va
      // aparte en el panel, por su `/usage`).
      const account = get().accounts.find((a) => a.id === configDir);
      if (account !== undefined && account.providerId === 'agy') {
        if (!account.apiBilled) await refreshAgyUsage(set, configDir);
        return;
      }
      try {
        const info = await mage.getUsage(configDir);
        if (info === null) {
          set((s) => ({ usageErrorByAccount: { ...s.usageErrorByAccount, [configDir]: null } }));
          return;
        }
        const windows = toUsageWindows(info, Date.now());
        set((s) => ({
          usageByAccount: { ...s.usageByAccount, [configDir]: info },
          usageErrorByAccount: { ...s.usageErrorByAccount, [configDir]: null },
          accounts: s.accounts.map((a) => (a.id === configDir ? { ...a, usage: windows } : a)),
        }));
      } catch (err) {
        set((s) => ({ usageErrorByAccount: { ...s.usageErrorByAccount, [configDir]: describeError(err) } }));
      }
    },

    // Refresca el uso de la cuenta activa (la que muestran sidebar/status bar/dashboard).
    refreshActiveUsage: async () => {
      const accountId = get().activeAccountId;
      if (accountId.length > 0) await get().refreshUsage(accountId);
    },

    // Consulta el estado del servicio de Claude (global). Ante error, deja el status previo (best-effort).
    refreshStatus: async () => {
      try {
        const status = await mage.getStatus();
        set({ status });
      } catch (err) {
        // El estado es informativo (no critico): no rompemos la UI, pero lo dejamos trazado (se reintenta
        // en el proximo refresco). El forwarder de consola del renderer lo envia al LogBus.
        console.warn('No se pudo refrescar el estado de Claude:', describeError(err));
      }
    },

    // El camino POR DEFECTO de "pestaña nueva" ya NO pasa por el dialogo (peticion del usuario): se abre
    // directamente con los valores por defecto (cuenta activa, modelo/esfuerzo resueltos) en una carpeta
    // temporal, que es justo lo que ya hacia `createConversation`. El dialogo sigue existiendo para quien
    // quiera elegir carpeta/proveedor/modelo: `openNewTabDialog` (clic derecho sobre el ＋).
    openNewTab: () => {
      set({ newTabAnchorTabId: null });
      void get().createConversation('shared');
    },
    addTabToPane: async (path) => {
      const { splitLayout } = get();
      // El ancla es la pestaña activa de ESA hoja: la nueva aterriza en el panel que pulso su ＋.
      set({ newTabAnchorTabId: leafAt(splitLayout, path).activeTabId });
      await get().createConversation('shared');
    },
    openNewTabDialog: (path) => {
      const { splitLayout } = get();
      set({ newTabOpen: true, newTabAnchorTabId: path === undefined ? null : leafAt(splitLayout, path).activeTabId });
    },
    closeNewTab: () => set({ newTabOpen: false, newTabAnchorTabId: null }),
    openAddAccount: () => set({ addAccountOpen: true }),
    closeAddAccount: () => set({ addAccountOpen: false }),
    openHandoff: () => set({ handoffOpen: true }),
    closeHandoff: () => set({ handoffOpen: false }),
    openSettings: (section) => set({ settingsOpen: true, settingsSection: section ?? null }),
    closeSettings: () => set({ settingsOpen: false }),

    openReleaseNotes: (version) => {
      set({ releaseNotesVersion: version ?? null });
      get().setActiveTab(RELEASE_NOTES_TAB_ID);
    },

    answerClosePrompt: (answer) => {
      set({ closePromptOpen: false });
      void mage.answerClose(answer).catch((err: unknown) => console.warn('No se pudo contestar el cierre:', describeError(err)));
    },

    openUpdatePrompt: () => {
      const state = get().updateState;
      if (state.kind === 'ready') set({ updatePromptVersion: state.version });
    },
    dismissUpdatePrompt: () => set({ updatePromptVersion: null }),
    installUpdate: () => {
      set({ updatePromptVersion: null });
      void mage.installUpdate().catch((err: unknown) => reportActionError('No se pudo instalar la actualización', err, 'update'));
    },

    showReleaseNotesIfUpdated: async (isDev) => {
      const [current, windows] = await Promise.all([mage.getAppVersion(), mage.listWindows()]);
      set({ appVersion: current });
      const { settings } = get();
      const decision = releaseNotesDecision({
        lastSeen: settings.lastSeenReleaseNotesVersion,
        current,
        onboardingDone: settings.onboardingCompletedVersion > 0,
        isDev,
        isMainWindow: windows.find((w) => w.isCurrent)?.windowId === MAIN_WINDOW_ID,
      });
      const { remember } = decision;
      if (remember !== null) {
        set((s) => ({ settings: { ...s.settings, lastSeenReleaseNotesVersion: remember } }));
        scheduleSettingsPersist(mage, get);
      }
      if (decision.open) get().openReleaseNotes();
    },

    // Sustituye las reglas de notificacion (edicion completa desde SettingsView) y persiste.
    saveNotificationRules: (rules) => {
      set((s) => ({ settings: { ...s.settings, notificationRules: rules } }));
      scheduleSettingsPersist(mage, get);
    },

    // Cambia la preferencia de tema base. Elegir claro/oscuro/sistema DESACTIVA cualquier tema importado
    // (activeThemeId -> null). Aplica al DOM ya (feedback inmediato) y persiste con debounce.
    setTheme: (pref) => {
      set((s) => ({ settings: { ...s.settings, theme: pref, activeThemeId: null } }));
      applyThemeFromSettings(get().settings, systemPrefersDark());
      scheduleSettingsPersist(mage, get);
    },

    setUiScale: (percent) => {
      // Se acota en el store y no solo en el deslizador: esta accion es el contrato, y un valor de
      // fuera (un ajuste a mano, una version futura) no puede dejar la app ilegible.
      const clamped = clampUiScale(percent);
      set((s) => ({ settings: { ...s.settings, uiScale: clamped } }));
      mage.setUiScale(clamped);
      scheduleSettingsPersist(mage, get);
    },

    // PERS-3 (P-028, 2): color de una cuenta. `undefined` vuelve al de su posicion.
    setAccountAccent: (accountId, colorIndex) => {
      set((s) => {
        const { [accountId]: _previo, ...rest } = s.settings.accentByAccount;
        const accentByAccount = colorIndex === undefined ? rest : { ...rest, [accountId]: colorIndex };
        return { settings: { ...s.settings, accentByAccount }, accounts: applyAccentOverrides(s.accounts, accentByAccount) };
      });
      scheduleSettingsPersist(mage, get);
    },

    setClaudeAiConnectorsEnabled: (accountId, enabled) => {
      set((s) => {
        const rest = s.settings.claudeAiConnectorsOff.filter((id) => id !== accountId);
        return { settings: { ...s.settings, claudeAiConnectorsOff: enabled ? rest : [...rest, accountId] } };
      });
      scheduleSettingsPersist(mage, get);
    },

    setAgyCommandVerdict: (command, verdict) => {
      set((s) => ({ settings: { ...s.settings, agyCommandRules: setAgyCommandVerdict(s.settings.agyCommandRules, command, verdict) } }));
      persistSettingsNow(mage, get);
    },

    setAgyLinkedPaths: (paths) => {
      set((s) => ({ settings: { ...s.settings, agyLinkedPaths: paths } }));
      persistSettingsNow(mage, get);
    },

    setDefaultProvider: (providerId) => {
      set((s) => ({ settings: { ...s.settings, defaultProvider: providerId } }));
      scheduleSettingsPersist(mage, get);
    },

    setDefaultPermissionMode: (mode) => {
      if (!DEFAULT_PERMISSION_MODES.includes(mode)) throw new Error(`Modo de permiso por defecto invalido: ${JSON.stringify(mode)}`);
      set((s) => ({ settings: { ...s.settings, defaultPermissionMode: mode } }));
      scheduleSettingsPersist(mage, get);
    },

    setRuntimeToolAccess: (providerId, rules) => {
      set((s) => {
        const { [providerId]: _previous, ...rest } = s.settings.runtimeToolAccess;
        return { settings: { ...s.settings, runtimeToolAccess: rules.length === 0 ? rest : { ...rest, [providerId]: rules } } };
      });
      scheduleSettingsPersist(mage, get);
    },

    setRuntimeShell: (shell) => {
      if (!RUNTIME_SHELLS.includes(shell)) throw new Error(`Shell del runtime invalida: ${JSON.stringify(shell)}`);
      set((s) => ({ settings: { ...s.settings, runtimeShell: shell } }));
      scheduleSettingsPersist(mage, get);
    },

    setOnboardingCompleted: (completed) => {
      set((s) => ({ settings: { ...s.settings, onboardingCompletedVersion: completed ? ONBOARDING_VERSION : 0 } }));
      scheduleSettingsPersist(mage, get);
      // Una actualizacion que llego con el asistente a medias se enseña ahora, no debajo de el.
      if (!completed) return;
      void get()
        .showReleaseNotesIfUpdated(isReleaseNotesDevRun())
        .catch((err: unknown) => console.warn('No se pudieron comprobar las novedades:', describeError(err)));
    },

    setScratchRetention: (retention) => {
      set((s) => ({ settings: { ...s.settings, scratchRetention: retention } }));
      scheduleSettingsPersist(mage, get);
    },

    setCloseBehavior: (behavior) => {
      set((s) => ({ settings: { ...s.settings, closeBehavior: behavior } }));
      scheduleSettingsPersist(mage, get);
    },

    setNewConversationFolder: (folder) => {
      set((s) => ({ settings: { ...s.settings, newConversationFolder: folder } }));
      scheduleSettingsPersist(mage, get);
    },

    setImportedContextMaxChars: (chars) => {
      // Se acota aqui y no solo en la UI: el store es el contrato, el input no es su unico llamante.
      const clamped = Math.min(IMPORTED_CONTEXT_LIMITS.max, Math.max(IMPORTED_CONTEXT_LIMITS.min, Math.round(chars)));
      set((s) => ({ settings: { ...s.settings, importedContextMaxChars: clamped } }));
      scheduleSettingsPersist(mage, get);
    },

    setBackgroundOpacity: (percent) => {
      // Se acota AQUI y no solo en la UI: esta accion es parte del contrato del store y un slider no es
      // su unico llamante posible. Por debajo de 50 el texto deja de leerse sobre un escritorio
      // cualquiera, y un ajuste que permite romper la app no es un ajuste.
      const clamped = Math.min(100, Math.max(50, Math.round(percent)));
      set((s) => ({ settings: { ...s.settings, backgroundOpacity: clamped } }));
      applyBackgroundOpacity(clamped);
      void mage.setWindowOpacity(clamped).catch((err: unknown) => {
        // Sin material translucido el alfa mezcla contra el color de fondo en vez de contra el
        // escritorio: se ve distinto, pero la app no se rompe. Se traza y se sigue.
        console.warn('No se pudo ajustar el material de la ventana:', describeError(err));
      });
      scheduleSettingsPersist(mage, get);
    },

    // Añade (o reemplaza por id) y activa un tema ya mapeado; aplica al DOM y persiste. Sin red.
    applyImportedTheme: (imported) => {
      set((s) => ({
        settings: {
          ...s.settings,
          importedThemes: [...s.settings.importedThemes.filter((t) => t.id !== imported.id), imported],
          activeThemeId: imported.id,
        },
      }));
      applyThemeFromSettings(get().settings, systemPrefersDark());
      scheduleSettingsPersist(mage, get);
    },

    // Elimina un tema importado; si era el activo, vuelve al tema base.
    removeImportedTheme: (id) => {
      set((s) => ({
        settings: {
          ...s.settings,
          importedThemes: s.settings.importedThemes.filter((t) => t.id !== id),
          activeThemeId: s.settings.activeThemeId === id ? null : s.settings.activeThemeId,
        },
      }));
      applyThemeFromSettings(get().settings, systemPrefersDark());
      scheduleSettingsPersist(mage, get);
    },

    // Activa un tema importado (id) o vuelve al tema base (null).
    selectImportedTheme: (id) => {
      set((s) => ({ settings: { ...s.settings, activeThemeId: id } }));
      applyThemeFromSettings(get().settings, systemPrefersDark());
      scheduleSettingsPersist(mage, get);
    },

    // Activa/desactiva el widget: actualiza y persiste la preferencia, abre/cierra la ventana en main y,
    // al abrir, empuja un snapshot inmediato (evita widget en blanco hasta el proximo cambio de estado).
    setWidgetEnabled: (enabled) => {
      set((s) => ({ settings: { ...s.settings, widgetEnabled: enabled } }));
      scheduleSettingsPersist(mage, get);
      void mage.setWidgetEnabled(enabled).catch((err: unknown) =>
        console.warn('No se pudo cambiar el widget flotante:', describeError(err)),
      );
      if (enabled) pushWidgetSnapshotNow(mage, get());
    },

    // Fija (o borra) el modelo por defecto de un proveedor (F3). Guard clauses: sin proveedor no se hace
    // nada; con modelo vacio se QUITA la clave en vez de guardar '' (una cadena vacia en el mapa seria un
    // "configurado" que no configura nada, y obligaria a todos los consumidores a tratarla aparte).
    setDefaultModelForProvider: (providerId, model) => {
      const provider = providerId.trim();
      if (provider.length === 0) return;
      const value = model.trim();
      set((s) => {
        const next = { ...s.settings.defaultModelByProvider };
        if (value.length === 0) delete next[provider];
        else next[provider] = value;
        return { settings: { ...s.settings, defaultModelByProvider: next } };
      });
      scheduleSettingsPersist(mage, get);
    },

    // Fija/borra el override de un atajo (D5). Una accion tiene como mucho un override: se sustituye el
    // anterior en vez de acumular. `keys === null` borra el override (vuelve al default del catalogo).
    setKeybindingOverride: (actionId, keys) => {
      set((s) => {
        const withoutExisting = s.settings.keybindingOverrides.filter((o) => o.actionId !== actionId);
        const next = keys === null ? withoutExisting : [...withoutExisting, { actionId, keys }];
        return { settings: { ...s.settings, keybindingOverrides: next } };
      });
      scheduleSettingsPersist(mage, get);
    },

    resetAllKeybindings: () => {
      set((s) => ({ settings: { ...s.settings, keybindingOverrides: [] } }));
      scheduleSettingsPersist(mage, get);
    },

    // Anade o actualiza un proveedor del usuario (E2). Upsert por id EN SU SITIO (map en vez de
    // filter+push) para que editar uno no lo mande al final de la lista de Configuracion.
    saveCustomProvider: async (provider, apiKeyUpdate = { kind: 'keep' }) => {
      if (apiKeyUpdate.kind === 'set') await mage.setProviderApiKey({ providerId: provider.id, apiKey: apiKeyUpdate.value });
      if (apiKeyUpdate.kind === 'delete') await mage.deleteProviderApiKey(provider.id);
      set((s) => {
        const known = s.settings.customProviders.some((p) => p.id === provider.id);
        const customProviders = known
          ? s.settings.customProviders.map((p) => (p.id === provider.id ? provider : p))
          : [...s.settings.customProviders, provider];
        return { settings: { ...s.settings, customProviders } };
      });
      scheduleSettingsPersist(mage, get);
    },

    // Elimina un proveedor y, con el, su modelo por defecto (F3): dejar la clave huerfana en
    // defaultModelByProvider haria que volver a crear un proveedor con el mismo id heredara ese modelo.
    removeCustomProvider: (id) => {
      // Y su clave, de la boveda de main: un proveedor recreado con el mismo id no hereda la del viejo.
      if (get().settings.customProviders.find((p) => p.id === id)?.hasApiKey === true) {
        void mage.deleteProviderApiKey(id).catch((err: unknown) => console.error(`No se pudo borrar la clave de ${id}:`, describeError(err)));
      }
      set((s) => {
        const defaultModelByProvider = { ...s.settings.defaultModelByProvider };
        delete defaultModelByProvider[id];
        // Y su ESFUERZO por defecto, que vive en el mismo mapa bajo `<id>#effort`. Por el mismo motivo
        // que el modelo: recrear un proveedor con el mismo id no debe heredar los ajustes del viejo.
        delete defaultModelByProvider[effortSettingKey(id)];
        return {
          settings: {
            ...s.settings,
            customProviders: s.settings.customProviders.filter((p) => p.id !== id),
            defaultModelByProvider,
          },
        };
      });
      scheduleSettingsPersist(mage, get);
    },

    // Crea una pestana nueva clonando {cuenta, proyecto, modelo} de la activa y envia `prompt`. newTab
    // fija la nueva pestana como activa, asi sendActiveMessage la usa como destino.
    startChatWithPrompt: async (prompt) => {
      const text = prompt.trim();
      if (text.length === 0) return;
      const src = get().tabs.find((t) => t.id === get().activeTabId);
      if (src === undefined) return;
      await get().newTab({ accountId: src.accountId, cwd: src.cwd, model: src.model, provider: src.provider, privacy: src.privacy });
      await get().sendActiveMessage(text);
    },

    // Elimina una cuenta: cierra sus pestanas (para sus sesiones) y re-descubre. refreshAccounts
    // reajusta la cuenta activa si era la borrada.
    // El ORDEN importa (auditoria B.1.1): primero se cierran sus pestañas y se ESPERA, y solo despues
    // se borra el config dir. Al reves se borraba la carpeta con procesos `claude` corriendo bajo ella
    // —en Windows eso falla o deja residuo—. Y las pestañas que estuvieran trabajando no se paran al
    // cerrarlas (se van a segundo plano): esas hay que descartarlas a mano, o quedaria un CLI vivo
    // apuntando a una cuenta que ya no existe, sin fila en el sidebar que lo muestre.
    deleteAccount: async (configDir) => {
      await Promise.all(get().tabs.filter((t) => t.accountId === configDir).map((t) => get().closeTab(t.id)));
      const huerfanas = Object.values(get().backgroundSessions).filter((b) => b.accountId === configDir);
      await Promise.all(huerfanas.map((b) => get().discardBackgroundSession(b.sessionId)));
      await mage.deleteAccount(configDir);
      await get().refreshAccounts();
    },

    hydrateBlocks: (tabId, blocks) => {
      if (blocks.length === 0) return;
      set((s) => {
        const vivos = s.blocksByChat[tabId] ?? EMPTY_BLOCKS;
        // El historial se ANTEPONE, no se descarta (B6). Antes, si el usuario escribia antes de que
        // la transcripcion terminase de cargar, su bloque optimista hacia que esto se rindiera y el
        // historial no volvia hasta cerrar y reabrir la pestaña. Y la app INVITA a escribir:
        // `openConversation` ya hace focusPrompt(). Anteponer es lo correcto en los dos casos, y
        // sigue siendo idempotente: si ya se hidrato, `vivos` empieza por esos mismos bloques.
        if (vivos.length === 0) return { blocksByChat: { ...s.blocksByChat, [tabId]: blocks } };
        // Conversacion NUEVA con contenido ya en pantalla: no hay nada que rescatar (auditoria B.1.4,
        // REPRODUCIDO en `workbenchStore.test.ts`). B6 se diseño para la conversacion REANUDADA, donde
        // el historial vive en disco y el chat arranca vacio. En una nueva, el primer `open()` no
        // encuentra .jsonl, asi que los bloques llevan ids del STREAM (`blk<n>`); cuando al acabar el
        // turno llega la transcripcion con los suyos (`tb-<i>-<slot>`), la guarda de idempotencia de
        // abajo compara ids que NUNCA pueden coincidir y anteponia otra vez el turno que ya estaba.
        const tab = s.tabs.find((t) => t.id === tabId);
        if (tab !== undefined && tab.resumeSessionId === undefined) return {};
        const yaHidratado = vivos[0] !== undefined && blocks[0] !== undefined && vivos[0].id === blocks[0].id;
        if (yaHidratado) return {};
        return { blocksByChat: { ...s.blocksByChat, [tabId]: [...blocks, ...vivos] } };
      });
    },

    ensureSession: (tabId) => {
      const existing = get().sessionIdByChat[tabId];
      if (existing !== undefined) return Promise.resolve(existing);
      // Guarda de REENTRADA (B16). El `if` de arriba no basta: entre que la primera llamada mira el
      // mapa y que `createSession` responde hay un viaje de ida y vuelta por IPC entero, y una
      // segunda llamada en esa ventana veia `undefined` tambien. Resultado: DOS procesos `claude`
      // para una pestaña (en una conversacion nueva no hay guarda en main, porque el sessionId es un
      // randomUUID distinto). Pasa de verdad: "Compactar ahora" dispara sendActiveMessage y basta con
      // pulsar Enter en el borrador mientras va el round-trip.
      const inFlight = sessionCreationInFlight.get(tabId);
      if (inFlight !== undefined) return inFlight;
      const creation = createSessionFor(mage, get, set, tabId).finally(() => sessionCreationInFlight.delete(tabId));
      sessionCreationInFlight.set(tabId, creation);
      return creation;
    },

    // Envia un mensaje del usuario en la pestana activa: bloque optimista + sesion + envio al motor.
    sendActiveMessage: (text, attachments = []) => get().sendMessageToTab(get().activeTabId, text, attachments),

    setRateLimitAutoContinue: (tabId, enabled) => {
      const notice = get().rateLimitByChat[tabId];
      if (notice === undefined) return;
      const { autoContinue: _previo, ...rest } = notice;
      set((s) => ({ rateLimitByChat: { ...s.rateLimitByChat, [tabId]: enabled ? { ...rest, autoContinue: true } : rest } }));
      syncAutoContinueTimer(get);
    },

    sendMessageToTab: async (tabId, text, attachments = []) => {
      const trimmed = text.trim();
      // Un mensaje SIN texto pero CON imagen es valido (mandar solo un pantallazo es un caso real).
      if ((trimmed.length === 0 && attachments.length === 0) || tabId.length === 0) return;
      // Un `/rename` tecleado es el nombre mas nuevo: el pendiente de la UI ya no debe pisarlo al
      // acabar el turno (gana el ultimo, D3). Tambien si espera en la cola: saldria detras del pendiente.
      if (get().tabs.find((t) => t.id === tabId)?.pendingCliTitle !== undefined && /^\/rename\b/.test(trimmed)) {
        set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? withoutPendingCliTitle(t) : t)) }));
      }
      // Con un turno en marcha el mensaje espera en la cola de Mage (0.1.1 R2, punto 30), tambien un
      // comando `/`: ni burbuja, ni stdin, ni reloj nuevo. Sale como turno propio al acabar este.
      if (isTurnRunning(get().statusByChat[tabId])) {
        const message = { id: nextBlockId(), text: trimmed, attachments };
        set((s) => ({ queuedByChat: { ...s.queuedByChat, [tabId]: enqueueMessage(s.queuedByChat[tabId] ?? [], message) } }));
        return;
      }
      // Auto-titulo (M2.6): el primer mensaje de una conversacion aun sin titulo lo fija desde el prompt.
      // Un comando "/" no titula (P-028): la pestaña sigue «Nuevo chat» hasta el primer prompt real.
      const activeTab = get().tabs.find((t) => t.id === tabId);
      if (activeTab !== undefined && shouldAutoTitle(activeTab, get().blocksByChat[tabId] ?? EMPTY_BLOCKS, trimmed)) {
        get().renameTab(tabId, deriveTitleFromPrompt(trimmed));
      }
      // El bloque optimista lleva ya los adjuntos, asi que la miniatura se ve al instante, sin esperar a
      // que la transcripcion se relea.
      patchBlocks(set, tabId, (blocks) => appendUserBlock(blocks, { id: nextBlockId(), text: trimmed, time: currentTime(), attachments }));
      setStatus(set, tabId, 'streaming');
      // El turno que lleva el prompt de «Crear PR» arma sus barreras hasta su `result` (como Desktop).
      if (trimmed.includes(CREATE_PR_PROMPT)) set((s) => ({ prGuardByChat: { ...s.prGuardByChat, [tabId]: true } }));
      // El aviso de limite se retira al escribir: o la ventana ya se restablecio, o el CLI lo volvera a
      // mandar en este mismo turno. Dejarlo puesto ofreceria mudarse de cuenta por un limite caducado.
      set((s) => ({ rateLimitByChat: without(s.rateLimitByChat, tabId) }));
      // Marca el inicio del turno y la actividad (feedback de "pensando": timer + deteccion de cuelgue).
      const startedAt = Date.now();
      set((s) => ({
        turnStartByChat: { ...s.turnStartByChat, [tabId]: startedAt },
        lastActivityByChat: { ...s.lastActivityByChat, [tabId]: startedAt },
        // ESCRIBIR es lo que sube la conversacion al principio del sidebar (abrirla no, A6).
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, lastMessageAtMs: startedAt } : t)),
      }));
      schedulePersist(mage, get);
      try {
        const sessionId = await get().ensureSession(tabId);
        await mage.sendMessage({ sessionId, text: trimmed, ...(attachments.length === 0 ? {} : { attachments }) });
      } catch (err) {
        failChat(set, tabId, describeError(err));
      }
    },

    // Compacta el contexto de la sesion activa (M2.4, solo Claude): envia el slash-command /compact
    // como mensaje de usuario (asi funciona el CLI; no es un control_request). El compact_boundary
    // resultante pinta el marcador "Contexto compactado".
    compactActiveSession: async () => {
      const tab = get().tabs.find((t) => t.id === get().activeTabId);
      if (tab === undefined || tab.provider !== 'claude') return;
      await get().sendActiveMessage('/compact');
    },

    // Cambia el modelo de la pestana activa (M2.4, solo Claude). Guard clauses: modelo no vacio,
    // pestana Claude existente. La Tab se actualiza siempre (el modelo ya se persiste con el
    // workspace); el set_model solo se envia si hay sesion viva.
    setActiveCwd: (cwd, targetTabId) => {
      const trimmed = cwd.trim();
      if (trimmed.length === 0) throw new Error(`cwd vacio al cambiar la carpeta: ${JSON.stringify(cwd)}`);
      const tabId = targetTabId ?? get().activeTabId;
      const tab = get().tabs.find((t) => t.id === tabId);
      if (tab === undefined) throw new Error(`No hay pestana activa al cambiar la carpeta (id=${JSON.stringify(tabId)})`);
      // No se confia en que la UI haya deshabilitado el boton: entre el clic y el dialogo del SO puede
      // haber arrancado una sesion, y mover el cwd entonces partiria la conversacion en dos carpetas.
      const verdict = canChangeCwd({
        hasLiveSession: get().sessionIdByChat[tabId] !== undefined,
        hasResumeTarget: tab.resumeSessionId !== undefined,
      });
      if (!verdict.allowed) throw new Error(`No se puede cambiar la carpeta: ${verdict.reason}`);
      if (tab.cwd === trimmed) return;
      // El titulo se deriva del ultimo segmento del cwd (misma regla que al crear la pestana), pero solo
      // si el usuario no le habia puesto uno propio: no se le pisa un titulo escrito a mano.
      const keepsDerivedTitle = tab.title === deriveTitle(tab.cwd) || isPlaceholderTitle(tab.title);
      const title = keepsDerivedTitle ? deriveTitle(trimmed) : tab.title;
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, cwd: trimmed, title } : t)) }));
      schedulePersist(mage, get);
    },

    setActiveModel: (model) => {
      const trimmed = model.trim();
      const tabId = get().activeTabId;
      const tab = get().tabs.find((t) => t.id === tabId);
      if (trimmed.length === 0 || tab === undefined || !['claude', CODEX_PROVIDER_ID].includes(tab.provider) || tab.model === trimmed) return;
      const supported = (get().modelCatalogByAccount[tab.accountId] ?? providerModels(CODEX_PROVIDER_ID, []) ?? [])
        .find((option) => option.id === trimmed)?.supportedEfforts;
      const effort = tab.provider === CODEX_PROVIDER_ID && supported !== undefined && tab.effort !== undefined && !supported.includes(tab.effort)
        ? undefined : tab.effort;
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, model: trimmed, effort } : t)) }));
      persistConversationPrefs(mage, get(), tabId);
      const sessionId = get().sessionIdByChat[tabId];
      if (sessionId !== undefined) {
        void mage
          .setModel({ sessionId, model: trimmed })
          .catch((err: unknown) => failChat(set, tabId, describeError(err)));
        if (tab.provider === CODEX_PROVIDER_ID && effort === undefined && tab.effort !== undefined) {
          void mage.setEffort({ sessionId, effort: '' })
            .catch((err: unknown) => failChat(set, tabId, describeError(err)));
        }
      }
      schedulePersist(mage, get);
    },

    // Fija el modo de permiso de la pestana activa (M2.6, solo Claude). La Tab se actualiza siempre
    // (persiste + aplica al arrancar via --permission-mode); si hay sesion viva envia set_permission_mode.
    setActivePermissionMode: (mode) => {
      const tabId = get().activeTabId;
      const tab = get().tabs.find((t) => t.id === tabId);
      if (tab === undefined || !hasPermissionModes(tab.provider) || (tab.permissionMode ?? 'default') === mode) return;
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, permissionMode: mode } : t)) }));
      persistConversationPrefs(mage, get(), tabId);
      const sessionId = get().sessionIdByChat[tabId];
      if (sessionId !== undefined) {
        void mage
          .setPermissionMode({ sessionId, mode })
          .catch((err: unknown) => failChat(set, tabId, describeError(err)));
      }
      schedulePersist(mage, get);
    },

    // Rota el modo de permiso de la pestana activa por PERMISSION_MODES (Manual -> Auto-editar -> Plan -> Auto -> Omitir permisos).
    cyclePermissionMode: () => {
      const tab = get().tabs.find((t) => t.id === get().activeTabId);
      if (tab === undefined) return;
      const current = tab.permissionMode ?? 'default';
      // El ciclo sigue el orden de siempre con los modos que de verdad expone el CLI (en el runtime propio,
      // los cinco de Mage). Un modo desconocido (`dontAsk`) no esta en el ciclo: -1, y el siguiente es el primero.
      const cycle = permissionCycleForProvider(tab.provider, get().permissionModes?.claude ?? null);
      if (cycle.length === 0) return;
      const index = cycle.findIndex((mode) => mode === current);
      const next = cycle[(index + 1) % cycle.length] ?? 'default';
      get().setActivePermissionMode(next);
    },

    // Fija el nivel de esfuerzo de la pestana activa. `--effort` es un flag de ARRANQUE del CLI (no hay
    // control_request para cambiarlo en caliente): se guarda en la Tab, se persiste y aplica la proxima
    // vez que arranque/reanude la sesion. Cadena vacia -> sin flag (default del CLI).
    setActiveEffort: (effort) => {
      const clean = effort.trim().toLowerCase();
      const tabId = get().activeTabId;
      const tab = get().tabs.find((t) => t.id === tabId);
      if (tab === undefined || !['claude', CODEX_PROVIDER_ID].includes(tab.provider) || (tab.effort ?? '') === clean) return;
      const supported = (get().modelCatalogByAccount[tab.accountId] ?? providerModels(CODEX_PROVIDER_ID, []) ?? [])
        .find((option) => option.id === tab.model)?.supportedEfforts;
      if (tab.provider === CODEX_PROVIDER_ID && clean.length > 0 && !supported?.includes(clean)) return;
      set((s) => ({
        tabs: s.tabs.map((t) => {
          if (t.id !== tabId) return t;
          const { effort: _dropped, ...rest } = t;
          return clean.length === 0 ? rest : { ...rest, effort: clean };
        }),
      }));
      persistConversationPrefs(mage, get(), tabId);
      if (tab.provider === CODEX_PROVIDER_ID) {
        const sessionId = get().sessionIdByChat[tabId];
        if (sessionId !== undefined) void mage.setEffort({ sessionId, effort: clean })
          .catch((err: unknown) => failChat(set, tabId, describeError(err)));
      }
      schedulePersist(mage, get);
    },

    // Interrumpe el turno en curso de la pestana activa (boton "Parar"). Sin sesion viva no hay nada que
    // parar. El CLI cierra el turno y emite su `result`, que devuelve el chat a 'idle'.
    interruptActiveSession: () => {
      const tabId = get().activeTabId;
      // Un Stop no envia la cola (0.1.1 R2, punto 30): sus mensajes vuelven al input para que el usuario
      // decida. Antes de pedir el interrupt: su `result` ya no debe encontrar nada que mandar.
      returnQueueToDraft(get, set, tabId);
      const sessionId = get().sessionIdByChat[tabId];
      if (sessionId === undefined) return;
      void mage
        .interrupt(sessionId)
        .catch((err: unknown) => failChat(set, tabId, describeError(err)));
    },

    stopSubagent: (tabId, taskId) => {
      const sessionId = get().sessionIdByChat[tabId];
      if (sessionId === undefined || taskId.length === 0) return;
      void mage.stopTask({ sessionId, taskId }).catch((err: unknown) => failChat(set, tabId, describeError(err)));
    },

    // Responde a una elicitation MCP. La tarjeta se cierra cuando main confirma con `elicitation_resolved`.
    answerElicitation: async (tabId, answer) => {
      const sessionId = get().sessionIdByChat[tabId];
      if (sessionId === undefined) return;
      const request = get().elicitationsByChat[tabId]?.find((e) => e.request.requestId === answer.requestId)?.request;
      if (request?.mode === 'url' && answer.action === 'accept') await mage.openExternal(request.url);
      await mage.answerElicitation({ ...answer, sessionId });
    },

    // Responde al permiso pendiente de la pestana activa y limpia el panel.
    answerActivePermission: (decision) => get().answerPermissionFor(get().activeTabId, decision),

    // Responde el permiso pendiente de UNA pestaña. Ademas de limpiar el panel, CIERRA la tarjeta del
    // hilo con la decision (2.3b): la tarjeta se queda como registro, no desaparece.
    answerPermissionFor: (tabId, decision, requestId) => {
      const queue = get().pendingByChat[tabId] ?? [];
      const pending = requestId === undefined ? queue[0] : queue.find((p) => p.requestId === requestId);
      const sessionId = get().sessionIdByChat[tabId];
      if (pending === undefined || sessionId === undefined) return;
      const resolved = decision.behavior === 'allow' ? 'allowed' : 'denied';
      const rest = queue.filter((p) => p !== pending);
      set((s) => ({
        ...withBlocks(s, tabId, resolvePermissionBlock(blocksOf(s, tabId), pending.requestId, resolved)),
        pendingByChat: { ...s.pendingByChat, [tabId]: rest },
        statusByChat: { ...s.statusByChat, [tabId]: rest.length > 0 ? 'needs_permission' : 'streaming' },
      }));
      void mage
        .answerPermission({ sessionId, requestId: pending.requestId, decision })
        .catch((err: unknown) => failChat(set, tabId, describeError(err)));
    },

    // "Permitir siempre <tool> aqui" (2.3b): la regla y luego las respuestas. Se conceden todas las de
    // esa tool que esperan en la cola (lo mismo que `shouldAutoAllow` haria si llegaran ahora), menos
    // las PREGUNTAS, que no son una autorizacion sino un turno de palabra.
    allowAlwaysAndAnswer: (toolName, tabId = get().activeTabId) => {
      const matching = (get().pendingByChat[tabId] ?? []).filter(
        (p) => p.view.toolLabel === toolName && p.view.rememberable && parseAskUserQuestion(p.input) === null,
      );
      if (matching.length === 0) return; // sin peticion viva no hay nada que conceder
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, alwaysAllowTools: addAlwaysAllow(t.alwaysAllowTools ?? [], toolName) } : t)),
      }));
      persistConversationPrefs(mage, get(), tabId);
      for (const p of matching) get().answerPermissionFor(tabId, { behavior: 'allow' }, p.requestId);
    },

    // Revoca una regla desde el panel de Permisos. No toca ningun permiso en vuelo: solo deja de
    // auto-aprobar los SIGUIENTES.
    revokeAlwaysAllow: (tabId, toolName) => {
      set((s) => ({
        tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, alwaysAllowTools: removeAlwaysAllow(t.alwaysAllowTools ?? [], toolName) } : t)),
      }));
      persistConversationPrefs(mage, get(), tabId);
    },

    // Contesta una tarjeta de AskUserQuestion (2.3). Es EL MISMO can_use_tool que veria el panel de
    // permiso, asi que va por la misma via: `allow` con `updatedInput = {...input, answers}` — sin ese
    // updatedInput el CLI usa el input original y el modelo recibe "no me han contestado".
    //
    // Guard por requestId: si la peticion ya no esta en la cola (se cancelo o ya se contesto), no se
    // contesta nada. Contestar dos veces el mismo can_use_tool hace que main lance.
    answerQuestion: (requestId, answers) => {
      const tabId = get().activeTabId;
      const pending = (get().pendingByChat[tabId] ?? []).find((p) => p.requestId === requestId);
      if (pending === undefined) return;
      patchBlocks(set, tabId, (blocks) => answerQuestionBlock(blocks, requestId, answers));
      get().answerPermissionFor(tabId, { behavior: 'allow', updatedInput: buildUpdatedInput(pending.input, answers) }, requestId);
    },

    // Enruta un evento del motor a la pestana correspondiente y aplica el reducer puro.
    handleEvent: (sessionId, event) => {
      // Un MCP del runtime pide login (D3 de P-033): aviso con boton, uno por login aunque lo pidan
      // varias pestañas (el login es de la app). Vale igual con la pestaña cerrada.
      if (event.kind === 'mcp_login_required') {
        notifyMcpLogin(mage, event.server, event.loginId);
        return;
      }
      const tabId = tabIdForSession(get(), sessionId);
      // Sin pestaña: o es una sesion en SEGUNDO PLANO (se cerro con trabajo en vuelo y sigue viva) o
      // es un evento rezagado de una sesion ya parada, que se ignora como hasta ahora.
      if (tabId === null) {
        applyBackgroundEvent(mage, get, set, sessionId, event);
        return;
      }
      // El `result` de un `/rename` que mando Mage (D3) no es un turno: ni cierra nada ni notifica.
      if (event.kind === 'result' && consumeSilentRename(sessionId, event.result.numTurns)) return;
      // UN SOLO `set` por evento (P5). Cada `set` de zustand ejecuta los selectores de TODOS los
      // componentes montados, asi que dos parches por evento eran el doble de trabajo por token. La
      // señal de actividad (que usa el indicador de "pensando" para el timer y para detectar cuelgues)
      // viaja en el mismo parche que el reducer.
      const activeAt = Date.now();
      const blocksBefore = get().blocksByChat[tabId] ?? EMPTY_BLOCKS;
      // Un turno que abre el CLI solo (sin mensaje del usuario) arranca su reloj aqui (P-028 37d).
      const opensTurn = event.kind === 'request_started' && (get().statusByChat[tabId] ?? 'idle') === 'idle';
      set((s) => ({
        ...reduceEvent(s, tabId, event),
        lastActivityByChat: { ...s.lastActivityByChat, [tabId]: activeAt },
        ...(opensTurn ? { turnStartByChat: { ...s.turnStartByChat, [tabId]: activeAt } } : {}),
      }));
      // El registro de artifacts vive AQUI y no dentro de `reduceEvent` (3.8): el reducer esta
      // documentado y testeado como PURO, y llamar al IPC desde dentro lo hacia mentir — ademas de
      // reventar en Vitest, donde no hay `window`. Se compara antes/despues para no reescribir en
      // cada tool_result.
      // Solo en `tool_result`: es el unico evento en el que una escritura puede haber TERMINADO (y el
      // unico en el que `applyToolResult` puede completar la publicacion de un artifact), y asi estos
      // dos barridos de bloques no se pagan en cada delta de texto (que son miles por turno).
      if (event.kind === 'tool_result') {
        const blocksAfter = get().blocksByChat[tabId] ?? EMPTY_BLOCKS;
        recordPublishedArtifacts(mage, get(), tabId, blocksBefore, blocksAfter);
        revealFilesPanelIfCreated(get(), tabId, blocksBefore, blocksAfter);
      }
      // Auto-permitido (2.3b): el reducer ya decidio que esta peticion no lleva tarjeta ni entra en la
      // cola; la RESPUESTA va aqui, que es donde el store puede hablar por IPC, con el requestId del
      // propio evento. Mismo criterio (`isAutoAllowedRequest`) en los dos sitios. Nunca la pestaña
      // "activa": el evento manda la suya.
      const autoAllowed = event.kind === 'permission_request' && isAutoAllowedRequest(get(), tabId, event.request);
      if (autoAllowed) {
        void mage
          .answerPermission({ sessionId, requestId: event.request.requestId, decision: { behavior: 'allow' } })
          .catch((err: unknown) => failChat(set, tabId, describeError(err)));
      }
      // Se deja `find` a proposito: `tabs` son unidades, no miles. Un indice por id habria que
      // mantenerlo sincronizado en cada alta/baja/reorden de pestaña — complejidad real a cambio de
      // una ganancia que no se puede medir. Si 0.1 llegara a señalarlo, entonces se indexa.
      const tab = get().tabs.find((t) => t.id === tabId);
      // Al terminar un turno, refresca el uso de la cuenta de esa pestana (el consumo acaba de subir).
      // El main cachea >=180 s, asi que llamadas seguidas no golpean la red de mas.
      if (event.kind === 'result' && tab !== undefined) void get().refreshUsage(tab.accountId);
      // Y el de git (P-026 3.5): el agente acaba de tocar ficheros, quiza de hacer commit.
      if (event.kind === 'result' && tab !== undefined) void get().refreshGit(tab.id);
      // Y el del PR (grupo D): quiza acaba de hacer push o de abrirlo. Las barreras del turno de PR caen.
      if (event.kind === 'result' && tab !== undefined) {
        set((s) => ({ prGuardByChat: without(s.prGuardByChat, tab.id) }));
        void get().refreshPr(tab.id).catch((err: unknown) => console.warn('No se pudo leer el PR:', describeError(err)));
      }
      detectPrBinding(get, tabId, event);
      denyPrTurnCommand(mage, get, set, sessionId, tabId, event);
      // El id de conversación de Codex/agy se conoce al arrancar: se persiste para poder reabrir la conversación.
      if (event.kind === 'session_init' && tab !== undefined && OWN_CONVERSATION_PROVIDERS.includes(tab.provider)) schedulePersist(mage, get);
      // Y es el momento de mandar un nombre que el usuario puso con el turno en marcha (D3).
      if (event.kind === 'result') flushPendingCliTitle(mage, get, set, tabId);
      // Y el primer mensaje de la cola sale como turno propio (0.1.1 R2, punto 30).
      if (event.kind === 'result') sendNextQueuedMessage(get, tabId, set);
      // Comandos locales con efecto en la pestaña (P-028): `/rename` la renombra al instante y `/clear`
      // deja persistido el id nuevo, para que reabrir Mage reanude la conversacion de despues.
      if (event.kind === 'local_command_output' && event.command === 'rename') applyCliRename(get, tabId, event);
      if (event.kind === 'conversation_reset') {
        schedulePersist(mage, get);
        persistConversationPrefs(mage, get(), tabId);
      }
      // Notificacion del SO (M2.3): main solo la muestra si la ventana no tiene el foco. Se pasa el
      // titulo de la pestana como cuerpo; los eventos de ruido devuelven null (no se notifica).
      // Un permiso que Mage contesto sola («Permitir siempre aqui») no pide nada al usuario (P-026, 1.8).
      if (tab !== undefined) {
        // Tampoco uno que denego la barrera del turno de PR: ya esta contestado.
        const answered = autoAllowed || (event.kind === 'permission_request' && prTurnDenial(get(), tabId, event.request) !== null);
        const content = notificationForEvent(event, { tabTitle: tab.title, rules: get().settings.notificationRules, autoAllowed: answered });
        if (content !== null) void mage.notify(toNotifyParams(content, { tabId, sessionId })).catch(() => undefined);
        toastIfHidden(get, event, { tabId, tabTitle: tab.title, target: { tabId, sessionId }, autoAllowed: answered });
      }
    },
  }));
  followFocusedTabAccount(store);
  return store;
}

// La cuenta activa sigue a la conversacion enfocada (P-028, punto 26). Suscripcion y no un cambio en
// `setActiveTab`: el foco cambia por muchos caminos (cerrar, mover, adoptar, restaurar) y todos pasan
// por `activeTabId`. `setActiveAccount` refresca uso e historial de la cuenta nueva.
function followFocusedTabAccount(store: { subscribe: (fn: (s: WorkbenchState, prev: WorkbenchState) => void) => unknown }): void {
  store.subscribe((state, prev) => {
    if (state.activeTabId === prev.activeTabId) return;
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    if (tab === undefined || tab.accountId === state.activeAccountId) return;
    if (!state.accounts.some((a) => a.id === tab.accountId)) return; // cuenta borrada o aun sin descubrir
    state.setActiveAccount(tab.accountId);
  });
}

// `window.mage` se resuelve EN CADA LLAMADA, no al importar el modulo. Es lo que permite que un test
// de Vitest (entorno node, sin `window`) pueda importar este fichero: solo estalla si de verdad se
// llama al IPC, que es justo lo que un test con mock no hace.
const browserMage: MageClient = new Proxy({} as MageClient, {
  get: (_target, prop: string | symbol) => (window.mage as unknown as Record<string | symbol, unknown>)[prop],
});

// Instancia de la app. Los tests no usan esta: crean la suya con `createWorkbenchStore(mock)`.
export const useWorkbenchStore = createWorkbenchStore(browserMage);

// ¿Esta tool tiene "Permitir siempre aqui" en ESTA conversacion? (2.3b). Lo consultan los dos lados de
// la misma decision —el reducer, para no pintar tarjeta, y `handleEvent`, para mandar la respuesta— y
// tienen que coincidir exactamente: con dos criterios distintos saldria una tarjeta que se contesta
// sola, o una peticion que se queda colgada sin tarjeta.
export interface PendingPermission {
  readonly requestId: string;
  // El `input` original de la tool: hace falta para responder a un AskUserQuestion (2.3), donde la
  // respuesta viaja como `updatedInput = {...input, answers}`.
  readonly input: Readonly<Record<string, unknown>>;
  readonly view: PermissionView;
}

// La peticion que contestan el panel de Permisos, los atajos y el dock de preguntas: la que MAS lleva
// esperando. Devuelve la referencia guardada, asi que vale como selector de zustand sin re-render de mas.
// Cierra una elicitation (queda como registro en la lista) y devuelve la pestaña a 'streaming' si ya no
// espera nada del usuario.
function settleElicitation(state: WorkbenchState, tabId: string, requestId: string, outcome: 'accept' | 'decline' | 'cancel'): Partial<WorkbenchState> {
  const list = state.elicitationsByChat[tabId] ?? [];
  if (!list.some((e) => e.request.requestId === requestId && e.state === 'pending')) return {};
  const next = list.map((e) => (e.request.requestId === requestId ? { ...e, state: outcome } : e));
  const waiting = next.some((e) => e.state === 'pending') || (state.pendingByChat[tabId]?.length ?? 0) > 0;
  return {
    elicitationsByChat: { ...state.elicitationsByChat, [tabId]: next },
    ...(waiting || state.statusByChat[tabId] !== 'needs_permission' ? {} : { statusByChat: { ...state.statusByChat, [tabId]: 'streaming' as const } }),
  };
}

// Uso de la suscripción de agy (su `/usage`, gratis; main cachea 180 s). Un fallo queda como `unavailable`.
async function refreshAgyUsage(set: SetFn, accountId: string): Promise<void> {
  const snapshot = await window.mage.readAgyUsage(accountId).catch((err: unknown): AgyUsageSnapshot => ({ status: 'unavailable', reason: describeError(err), fetchedAt: Date.now() }));
  set((s) => ({ agyUsageByAccount: { ...s.agyUsageByAccount, [accountId]: snapshot } }));
}

// Migra la conversación de una pestaña a una cuenta de otro proveedor (o de otra cuenta de Codex/agy) y la reabre
// ahí. Se cierra la pestaña y se para su sesión ANTES: el origen se retira al acabar y nadie debe estar escribiéndolo.
async function migrateToOtherProvider(
  get: () => WorkbenchState,
  mage: MageClient,
  ctx: { readonly tabId: string; readonly sessionId: string; readonly destAccountId: string },
): Promise<void> {
  const tab = get().tabs.find((t) => t.id === ctx.tabId);
  const source = get().accounts.find((a) => a.id === tab?.accountId);
  const dest = get().accounts.find((a) => a.id === ctx.destAccountId);
  if (tab === undefined || source === undefined || dest === undefined || tab.provider !== source.providerId) {
    throw new Error(`Esta conversacion (${tab?.provider ?? 'sin pestana'}) no se puede migrar a ${dest?.providerId ?? ctx.destAccountId}`);
  }
  await closeMatchingTab(get, ctx.sessionId);
  await get().discardBackgroundSession(ctx.sessionId);
  const result = await mage.migrateConversation({
    sourceAccountDir: source.id, sourceProvider: asAccountProvider(source.providerId), sessionId: ctx.sessionId, cwd: tab.cwd, privacy: tab.privacy,
    destAccountDir: dest.id, destProvider: asAccountProvider(dest.providerId),
  });
  get().setActiveAccount(dest.id);
  await get().loadConversationHistory();
  const migrated = get().conversationHistory.find((c) => c.sessionId === result.sessionId);
  if (migrated !== undefined) get().openConversation(migrated);
}

function asAccountProvider(id: string): AccountProviderId {
  if (id === 'claude' || id === 'codex' || id === 'agy') return id;
  throw new Error(`Proveedor de cuenta desconocido: ${JSON.stringify(id)}`);
}

// Proveedores cuyo historial en disco sabe leer Mage (un lector por CLI: el de Claude y el rollout de Codex).
const HISTORY_PROVIDERS: readonly string[] = ['claude', CODEX_PROVIDER_ID, AGY_PROVIDER_ID];
// Los que llevan su propia conversación (su id viene del CLI en el `session_init`).
const OWN_CONVERSATION_PROVIDERS: readonly string[] = [CODEX_PROVIDER_ID, AGY_PROVIDER_ID];

// El id de conversación de una pestaña de Codex o agy, la primera vez que se conoce. Es lo que permite
// reabrirla (`thread/resume`, `--conversation`) y leer su historial; Claude y el runtime propio usan el de Mage.
function codexThreadBinding(state: WorkbenchState, tabId: string, threadId: string): Partial<WorkbenchState> {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (tab === undefined || !OWN_CONVERSATION_PROVIDERS.includes(tab.provider) || tab.resumeSessionId !== undefined || threadId.length === 0) return {};
  return { tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, resumeSessionId: threadId } : t)) };
}

export function headPermission(state: Pick<WorkbenchState, 'pendingByChat'>, tabId: string): PendingPermission | null {
  return state.pendingByChat[tabId]?.[0] ?? null;
}

// Una PREGUNTA no se auto-permite ni habiendo regla: no es una autorizacion, es un turno de palabra
// que hay que contestar con datos (y su regla no puede existir — la tarjeta de permiso, que es la unica
// que crea reglas, no se pinta para preguntas).
function isAutoAllowedRequest(state: WorkbenchState, tabId: string, request: PermissionRequest): boolean {
  // Fuera del proyecto o red (runtime propio, D2 de P-033): la regla nunca la cubre.
  if (request.outsideProject === true) return false;
  return parseAskUserQuestion(request.input) === null && shouldAutoAllow(state, tabId, request.toolName);
}

export function shouldAutoAllow(state: WorkbenchState, tabId: string, toolName: string): boolean {
  const tab = state.tabs.find((t) => t.id === tabId);
  if (tab === undefined) return false;
  return isAlwaysAllowed(tab.alwaysAllowTools ?? [], toolName);
}

// --- Reducer del motor (fuera del store: logica de lectura pura sobre el estado) ----------------

// Se exporta para poder testearlo como la funcion PURA que es (evento + estado -> parche de estado),
// sin montar el store ni simular `window.mage`. No es parte de la API que consumen los componentes:
// ellos usan `handleEvent`.
export function reduceEvent(state: WorkbenchState, tabId: string, event: MageEvent): Partial<WorkbenchState> {
  const blocks = blocksOf(state, tabId);
  const streamingId = state.streamingIdByChat[tabId] ?? null;
  switch (event.kind) {
    case 'stream_delta': {
      // Un delta de texto cierra el pensamiento en curso: el agente ha pasado de pensar a escribir.
      const result = appendDelta(closeThinking(blocks, null), streamingId, event.text, nextBlockId());
      // Solo se emiten las claves que CAMBIAN de verdad (P4). Emitir siempre un mapa nuevo hacia que
      // `TabBar` y `ChatSidebar` —que se suscriben al mapa entero— se re-renderizasen en cada delta
      // aunque el estado ya fuese "streaming" desde el primer token. Mismo criterio que
      // `cancelQuestionBlock`, que devuelve el mismo array cuando no hay nada que cambiar.
      const sameStreamingId = state.streamingIdByChat[tabId] === result.streamingId;
      const alreadyStreaming = state.statusByChat[tabId] === 'streaming';
      return {
        ...withBlocks(state, tabId, result.blocks),
        ...(sameStreamingId ? {} : { streamingIdByChat: { ...state.streamingIdByChat, [tabId]: result.streamingId } }),
        ...(alreadyStreaming ? {} : { statusByChat: { ...state.statusByChat, [tabId]: 'streaming' } }),
      };
    }
    case 'tool_use': {
      // Un `Task`/`Agent` NO es una tool mas: tiene bloque propio, con su transcripcion aparte (2.5).
      // Al empezar una tool tambien se cierra el pensamiento en curso: ya no esta pensando, esta
      // haciendo.
      const closed = closeThinking(closeStreaming(blocks, streamingId), null);
      const next = SUBAGENT_TOOL_NAMES.has(event.tool.toolName)
        ? appendSubagentBlock(closed, event.tool, nextBlockId())
        : appendToolUse(closed, event.tool, nextBlockId());
      return {
        ...withBlocks(state, tabId, next),
        streamingIdByChat: { ...state.streamingIdByChat, [tabId]: null },
        statusByChat: { ...state.statusByChat, [tabId]: 'streaming' },
      };
    }
    case 'tool_result': {
      // Un `Task`/`Agent` tiene bloque propio: su resultado rellena el subagente, no una caja de tool.
      const withSubagent = applySubagentResult(blocks, event.result);
      if (withSubagent !== blocks) return withBlocks(state, tabId, withSubagent);
      const next = applyToolResult(blocks, event.result);
      // Artifact recien publicado (2.4): se apunta QUIEN lo publico, porque es con esa cuenta con la que
      // habra que reabrirlo — aunque la conversacion se mire luego desde otra. Es aqui y no en `main`
      // porque el reconocimiento del artifact vive en un solo sitio (el modulo puro compartido).
      return withBlocks(state, tabId, next);
    }
    // Nueva peticion al modelo con la pestaña parada: el CLI abre un turno solo (el de la notificacion de
    // una tarea en segundo plano, P-028 37d). Cuenta como turno en marcha: la cola de Mage espera.
    case 'request_started': {
      const idle = (state.statusByChat[tabId] ?? 'idle') === 'idle';
      return idle ? { statusByChat: { ...state.statusByChat, [tabId]: 'streaming' } } : {};
    }
    // Progreso o fin de un subagente en segundo plano (P-028 37a): llega aunque la pestaña este `idle`.
    case 'subagent_update': {
      const next = applySubagentUpdate(blocks, event);
      if (next === blocks) return {};
      return { ...withBlocks(state, tabId, next), ...undismissSubagent(state, tabId, event.toolUseId) };
    }
    // Pensamiento EN VIVO (2.5). Solo existe mientras el turno corre: al reanudar la conversacion, el
    // CLI persiste los bloques `thinking` vacios (medido), asi que alli queda el "▸ Pensó" sin cuerpo.
    case 'thinking_delta':
      return withBlocks(state, tabId, appendThinkingDelta(blocks, event.text, nextBlockId()));
    case 'permission_request': {
      // Una peticion de permiso deja SIEMPRE la peticion pendiente (`pendingByChat`) y, salvo que haya
      // regla, una tarjeta en el hilo. Panel y tarjeta comparten esa peticion: quien contesta primero
      // deja al otro sin nada que contestar, y eso es lo que hace ESTRUCTURALMENTE imposible la doble
      // respuesta (contestar dos veces el mismo can_use_tool hace que main lance).
      //
      // AskUserQuestion (2.3) es un can_use_tool como cualquier otro, pero se pinta como tarjeta de
      // PREGUNTA. Se reconoce por la FORMA del input, no por el nombre de la tool.
      const questions = parseAskUserQuestion(event.request.input);
      const view = mapPermissionToView(event.request);
      const queue = state.pendingByChat[tabId] ?? [];
      // Un reenvio del mismo can_use_tool no se encola dos veces: se contestaria dos veces.
      const pending = queue.some((p) => p.requestId === event.request.requestId)
        ? {}
        : { pendingByChat: { ...state.pendingByChat, [tabId]: [...queue, { requestId: event.request.requestId, input: event.request.input, view }] } };

      // Auto-permitido por regla de la conversacion (2.3b, "Permitir siempre <tool> aqui"): ni tarjeta,
      // ni cola, ni panel, ni estado "necesita permiso" — el usuario ya dijo que si a esta tool aqui.
      // La respuesta la manda `handleEvent`, que es donde viven los efectos.
      if (isAutoAllowedRequest(state, tabId, event.request)) return {};
      // Barrera del turno de «Crear PR»: la deniega `handleEvent`, sin tarjeta.
      if (prTurnDenial(state, tabId, event.request) !== null) return {};

      // La tarjeta: de pregunta si el input tiene esa forma, de permiso si no. En los dos casos, una
      // sola por requestId.
      const yaTieneTarjeta = questions === null
        ? hasPermissionBlock(blocks, event.request.requestId)
        : hasQuestionBlock(blocks, event.request.requestId);
      const conTarjeta = yaTieneTarjeta
        ? {}
        : withBlocks(
            state,
            tabId,
            questions === null
              ? appendPermissionBlock(blocks, {
                  id: nextBlockId(),
                  requestId: event.request.requestId,
                  toolName: event.request.toolName,
                  prompt: view.prompt,
                  target: view.target,
                  summary: view.summary,
                  rememberable: view.rememberable,
                })
              : appendQuestionBlock(blocks, { id: nextBlockId(), requestId: event.request.requestId, questions }),
          );

      return {
        ...conTarjeta,
        ...pending,
        statusByChat: { ...state.statusByChat, [tabId]: 'needs_permission' },
      };
    }
    case 'elicitation_request': {
      const list = state.elicitationsByChat[tabId] ?? [];
      if (list.some((e) => e.request.requestId === event.request.requestId)) return {};
      return {
        elicitationsByChat: { ...state.elicitationsByChat, [tabId]: [...list, { request: event.request, state: 'pending' }] },
        statusByChat: { ...state.statusByChat, [tabId]: 'needs_permission' },
      };
    }
    case 'elicitation_cancelled':
      return settleElicitation(state, tabId, event.requestId, 'cancel');
    case 'elicitation_resolved':
      return settleElicitation(state, tabId, event.requestId, event.action);
    case 'permission_cancelled': {
      // Si no habia tarjeta para ese requestId, `cancelQuestionBlock` devuelve el MISMO array y no se
      // emite parche de bloques: un parche vacio tiene que seguir siendo vacio.
      const cancelled = resolvePermissionBlock(cancelQuestionBlock(blocks, event.requestId), event.requestId, 'cancelled');
      return {
        ...(cancelled === blocks ? {} : withBlocks(state, tabId, cancelled)),
        ...clearPermissionIfMatches(state, tabId, event.requestId),
      };
    }
    // Fin de turno. Si el proveedor reporta uso en su terminador (E3, `agy`), se deja como marcador de
    // sistema: es el unico sitio donde ese gasto se puede ver (el panel de Uso lee el historial de la
    // cuenta de Claude y no sabe nada de otros proveedores).
    case 'result': {
      const closed = closeStreaming(blocks, streamingId);
      const usageText = event.result.usage === undefined ? null : turnUsageText(event.result.usage);
      return {
        ...withBlocks(state, tabId, usageText === null ? closed : appendSystemBlock(closed, usageText, nextBlockId())),
        streamingIdByChat: { ...state.streamingIdByChat, [tabId]: null },
        statusByChat: { ...state.statusByChat, [tabId]: 'idle' },
      };
    }
    case 'session_state':
      return { statusByChat: { ...state.statusByChat, [tabId]: mapSessionState(event.state) } };
    // Compactacion de contexto (M2.4): marcador visual tenue en la conversacion.
    // Reinicio automatico del agente (C1): marcador de sistema + estado a 'idle'. Se cierra el bloque
    // en streaming (si habia uno a medias, ese texto ya no va a continuar) y se deja la pestana viva:
    // el motor esta reanudando la conversacion por su cuenta.
    case 'session_restarting': {
      const next = appendSystemBlock(
        closeStreaming(blocks, streamingId),
        restartingText(event.attempt, event.delayMs),
        nextBlockId(),
      );
      return {
        ...withBlocks(state, tabId, next),
        streamingIdByChat: { ...state.streamingIdByChat, [tabId]: null },
        statusByChat: { ...state.statusByChat, [tabId]: 'idle' },
      };
    }
    // Modo de permiso (M2.6): refleja el modo actual venga de donde venga (nuestro cambio, ExitPlanMode,
    // /plan...). Se coacciona a los modos que Mage maneja (bypass/dontAsk que no ofrecemos -> default).
    // Se ENSEÑA el que diga el CLI, tambien uno que Mage no ofrece: coaccionarlo a 'default' hacia que
    // la pestaña dijera «Manual» con el CLI en otro modo (P-026 2.3).
    case 'permission_mode':
      return { tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, permissionMode: event.mode } : t)) };
    case 'error': {
      const next = appendErrorBlock(closeStreaming(blocks, streamingId), event.message, nextBlockId(), event.deniedCommand);
      return {
        ...withBlocks(state, tabId, next),
        streamingIdByChat: { ...state.streamingIdByChat, [tabId]: null },
        statusByChat: { ...state.statusByChat, [tabId]: 'error' },
      };
    }
    // session_init: no cambia la conversacion, pero trae los comandos "/" REALES de la sesion (D4) y
    // los servidores MCP que REALMENTE cargo (D1 Fase 2, comun vs propio en el Inspector). Solo los
    // NOMBRES de comandos; las descripciones llegan luego en commands_available (si el CLI las da).
    case 'session_init':
      return {
        // Codex lleva su propia conversación: su id de hilo es lo que reanuda y lo que localiza su historial.
        ...codexThreadBinding(state, tabId, event.sessionId),
        slashCommandsByChat: {
          ...state.slashCommandsByChat,
          [tabId]: event.slashCommands.map((name) => ({ name, description: '', argumentHint: null, aliases: [] })),
        },
        mcpServersByChat: { ...state.mcpServersByChat, [tabId]: event.mcpServers },
        toolsByChat: { ...state.toolsByChat, [tabId]: event.tools },
        extensionsByChat: { ...state.extensionsByChat, [tabId]: { skills: event.skills, plugins: event.plugins, pluginErrors: event.pluginErrors } },
        resolvedModelByChat: { ...state.resolvedModelByChat, [tabId]: event.model },
      };
    // Catalogo de comandos con DESCRIPCION real, de la respuesta al `initialize` (D2). Pisa lo que
    // hubiera del init: es la misma lista, con mejor informacion.
    case 'commands_available':
      return { slashCommandsByChat: { ...state.slashCommandsByChat, [tabId]: event.commands } };
    // Subagentes declarados por el CLI al arrancar (los consume la Fase F, panel "Subagentes").
    case 'subagents_available':
      return { subagentsByChat: { ...state.subagentsByChat, [tabId]: event.subagents } };
    // Catalogo de modelos de la sesion viva (P-026 2.4): manda sobre la cache, y va por config dir
    // EFECTIVO (el perfil privado tiene el suyo: medido, 5 modelos frente a 11).
    case 'models_available': {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (tab === undefined) return {};
      const configDir = tab.resolvedConfigDir ?? tab.accountId;
      return { modelCatalogByAccount: { ...state.modelCatalogByAccount, [configDir]: event.models } };
    }
    // Salida de un comando local (P-028, grupo C): sin esto el chat se quedaba vacio, porque el CLI no
    // manda deltas para un comando local, solo un `assistant` sintetico.
    case 'local_command_output':
      return withBlocks(state, tabId, appendCommandOutputBlock(blocks, event, nextBlockId()));
    // `/clear` (P-028): conversacion nueva en el mismo proceso. El chat se vacia y la pestaña adopta el
    // id nuevo, que es el que leen la transcripcion, la persistencia y el `--resume`. La anterior sigue
    // en el historial. El desglose de contexto era de la vieja: fuera hasta el siguiente.
    case 'conversation_reset':
      return {
        blocksByChat: { ...state.blocksByChat, [tabId]: appendSystemBlock(EMPTY_BLOCKS, CONVERSATION_RESET_TEXT, nextBlockId()) },
        streamingIdByChat: { ...state.streamingIdByChat, [tabId]: null },
        sessionIdByChat: { ...state.sessionIdByChat, [tabId]: event.newSessionId },
        contextUsageByChat: without(state.contextUsageByChat, tabId),
        tabs: state.tabs.map((t) => (t.id === tabId && t.resumeSessionId !== undefined ? { ...t, resumeSessionId: event.newSessionId } : t)),
      };
    // Desglose de contexto del propio CLI (D3): no toca la conversacion, alimenta el Inspector.
    case 'context_usage':
      return { contextUsageByChat: { ...state.contextUsageByChat, [tabId]: event.usage } };
    // Limite de uso (H4). Ademas de la linea tenue en el hilo —que sigue yendo, porque es parte del
    // relato— queda MARCADO en `rateLimitByChat`, y eso es lo que enciende la oferta de continuar en
    // otra cuenta. La linea sola no servia: contaba el problema y dejaba al usuario sin salida.
    // P-028, 20: el CLI avisa dos veces del mismo limite; la segunda funde la marca y reescribe la
    // linea que ya hay en vez de añadir otra. El texto del CLI va al tooltip.
    case 'rate_limit': {
      const previous = state.rateLimitByChat[tabId];
      const merged = mergeRateLimitNotice(previous, event);
      const marked = { rateLimitByChat: { ...state.rateLimitByChat, [tabId]: merged } };
      const line = { text: rateLimitLineText(merged.resetsAtMs), ...(merged.summary.length === 0 ? {} : { tip: merged.summary }) };
      const lastIndex = previous === undefined ? -1 : lastRateLimitLineIndex(blocks);
      if (lastIndex < 0) return { ...marked, ...withBlocks(state, tabId, [...blocks, { kind: 'system', id: nextBlockId(), ...line }]) };
      return { ...marked, ...withBlocks(state, tabId, blocks.map((b, i) => (i === lastIndex && b.kind === 'system' ? { ...b, ...line } : b))) };
    }
    default: {
      // Avisos del CLI que SI van al hilo como linea de sistema (2.5): limite de uso, cambio de modo de
      // permiso y las notificaciones que piden atencion. Que entra y que no lo decide `cliNotices`, y
      // lo que no entra se queda en el panel de Logs, que es para lo que existe.
      const notice = noticeTextFor(event);
      if (notice === null) return {};
      return withBlocks(state, tabId, appendSystemBlock(blocks, notice, nextBlockId()));
    }
  }
}

// Ultima linea de limite de uso del hilo (para fundir el segundo aviso en ella), o -1.
function lastRateLimitLineIndex(blocks: readonly Block[]): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block?.kind === 'system' && block.text.startsWith(RATE_LIMIT_LINE)) return i;
  }
  return -1;
}

// Un subagente oculto del dock vuelve en cuanto el CLI cuenta algo nuevo de el (P-028 37c).
function undismissSubagent(state: WorkbenchState, tabId: string, toolUseId: string): Partial<WorkbenchState> {
  const dismissed = state.dismissedSubagentsByChat[tabId];
  if (dismissed === undefined || !dismissed.includes(toolUseId)) return {};
  return { dismissedSubagentsByChat: { ...state.dismissedSubagentsByChat, [tabId]: dismissed.filter((id) => id !== toolUseId) } };
}

function clearPermissionIfMatches(
  state: WorkbenchState,
  tabId: string,
  requestId: string,
): Partial<WorkbenchState> {
  const queue = state.pendingByChat[tabId] ?? [];
  const rest = queue.filter((p) => p.requestId !== requestId);
  if (rest.length === queue.length) return {};
  return {
    pendingByChat: { ...state.pendingByChat, [tabId]: rest },
    statusByChat: { ...state.statusByChat, [tabId]: rest.length > 0 ? 'needs_permission' : 'idle' },
  };
}

function mapSessionState(sessionState: 'idle' | 'running' | 'requires_action'): ChatStatus {
  if (sessionState === 'running') return 'streaming';
  if (sessionState === 'requires_action') return 'needs_permission';
  return 'idle';
}

// --- Helpers de mutacion (reducen la repeticion de spreads) -------------------------------------

type SetFn = (fn: (s: WorkbenchState) => Partial<WorkbenchState>) => void;

// Generando o esperando permiso: un mensaje nuevo espera en la cola (0.1.1 R2, punto 30).
function isTurnRunning(status: ChatStatus | undefined): boolean {
  return status === 'streaming' || status === 'needs_permission';
}

const NO_DRAFT: PromptDraft = { text: '', attachments: [] };

// Al acabar un turno sale el PRIMERO de la cola; el siguiente espera a que acabe ese.
// Vinculacion del PR (grupo D, `prBinding.ts`): la URL del `gh pr create` o la marca `<pr-created>`.
function detectPrBinding(get: () => WorkbenchState, tabId: string, event: MageEvent): void {
  if (event.kind === 'tool_use' && event.tool.toolName === 'Bash' && isPrCreateCommand(String(event.tool.input.command ?? ''))) {
    prCreateToolUses.add(`${tabId}:${event.tool.toolUseId}`);
    return;
  }
  let number: number | null = null;
  if (event.kind === 'tool_result' && prCreateToolUses.delete(`${tabId}:${event.result.toolUseId}`) && !event.result.isError) number = prNumberFromUrl(event.result.output);
  if (event.kind === 'assistant_text') number = prNumberFromCreatedTag(event.text);
  if (number !== null) get().bindPr(tabId, number);
}

// Worktree de la pestaña al arrancar su sesion (grupo D, bloque 3). Nueva + casilla marcada + repo con
// rama → se crea desde la rama del selector (DN-4) con el nombre del primer mensaje (DN-5). Ya en un
// worktree de Mage → se recrea si no existe (se archivo limpio).
async function prepareWorktree(mage: MageClient, get: () => WorkbenchState, set: SetFn, tabId: string): Promise<void> {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (tab === undefined) return;
  if (worktreeOfCwd(tab.cwd) !== null) {
    await mage.worktreeRestore({ cwd: tab.cwd, accountDir: tab.accountId });
    return;
  }
  const snapshot = get().gitByCwd[tab.cwd]?.snapshot;
  if (!wantsNewWorktree(tab, snapshot)) return;
  const firstMessage = (get().blocksByChat[tabId] ?? []).find((b) => b.kind === 'user');
  const created = await mage.worktreeCreate({ cwd: tab.cwd, accountDir: tab.accountId, base: snapshot.branch, firstMessage: firstMessage?.kind === 'user' ? firstMessage.text : '' });
  if (created === null) return;
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, cwd: created.path } : t)) }));
  schedulePersist(mage, get);
}

function wantsNewWorktree(tab: Tab, snapshot: GitSnapshot | undefined): snapshot is Extract<GitSnapshot, { kind: 'repo' }> & { readonly branch: string } {
  return tab.resumeSessionId === undefined && tab.worktreeOff !== true && snapshot?.kind === 'repo' && snapshot.branch !== null;
}

const KEPT_WORKTREE_REASON: Readonly<Record<'dirty' | 'unknown', string>> = {
  dirty: 'tiene cambios sin confirmar',
  unknown: 'no se pudo comprobar si tenía cambios',
};

// Con cambios (o sin poder comprobarlo) el worktree se queda, y se avisa con una notificacion: la pestaña
// que lo explicaria ya no existe. No se pierde nada: vuelve al reabrir la conversacion.
function archiveWorktree(mage: MageClient, tab: Tab): void {
  if (worktreeOfCwd(tab.cwd) === null) return;
  const path = tab.cwd;
  const dedupeKey = `worktree-kept:${path}`;
  void mage
    .worktreeRemove({ cwd: path, accountDir: tab.accountId })
    .then((result) => {
      if (result.removed) return;
      console.warn(`Worktree conservado (${KEPT_WORKTREE_REASON[result.reason]}): ${path}`);
      notify({
        level: 'warning',
        title: `Worktree conservado: ${KEPT_WORKTREE_REASON[result.reason]}`,
        body: path,
        source: 'worktree',
        dedupeKey,
        actions: [
          { label: 'Abrir carpeta', run: () => mage.openPath(path) },
          { label: 'Copiar ruta', run: () => navigator.clipboard.writeText(path) },
        ],
      });
    })
    .catch((err: unknown) => {
      console.warn('No se pudo archivar el worktree:', describeError(err));
      notify({ level: 'error', title: 'No se pudo archivar el worktree', body: `${path}: ${describeError(err)}`, source: 'worktree', dedupeKey });
    });
}

// Con la ventana enfocada main no enseña la notificacion del SO: si la conversacion que avisa no esta a la
// vista (otra pestaña, segundo plano), sale un toast que lleva a ella. Sin foco manda la del SO.
interface HiddenConversationContext {
  readonly tabId: string | null;
  readonly tabTitle: string;
  readonly target: NotificationTarget;
  readonly autoAllowed?: boolean;
}

function toastIfHidden(get: () => WorkbenchState, event: MageEvent, context: HiddenConversationContext): void {
  if (typeof document === 'undefined' || !document.hasFocus()) return;
  if (context.tabId !== null && visibleTabIds(get().splitLayout).includes(context.tabId)) return;
  const notice = inAppNoticeForEvent(event, { tabTitle: context.tabTitle, rules: get().settings.notificationRules, autoAllowed: context.autoAllowed === true });
  if (notice === null) return;
  const target: NotificationTarget = notice.content.opensActivity === true ? { ...context.target, opensActivity: true } : context.target;
  notify({
    level: notice.level,
    title: notice.content.title,
    body: notice.content.body,
    source: 'conversation',
    dedupeKey: `conversation:${context.target.sessionId}:${notice.content.title}`,
    actions: [{ label: 'Ir a la conversación', run: () => get().focusNotificationTarget(target) }],
  });
}

// Motivo por el que la barrera del turno de PR rechaza este permiso, o null.
function prTurnDenial(state: WorkbenchState, tabId: string, request: PermissionRequest): string | null {
  if (state.prGuardByChat[tabId] !== true || request.toolName !== 'Bash') return null;
  return prTurnBlockReason(String(request.input.command ?? ''));
}

function denyPrTurnCommand(mage: MageClient, get: () => WorkbenchState, set: SetFn, sessionId: string, tabId: string, event: MageEvent): void {
  if (event.kind !== 'permission_request') return;
  const blocked = prTurnDenial(get(), tabId, event.request);
  if (blocked === null) return;
  const message = `Mage no permite \`${blocked}\` en el turno de crear el PR: haz un push normal de la rama, sin forzar ni saltar los hooks, y abre el PR en este repositorio.`;
  patchBlocks(set, tabId, (blocks) => [...blocks, { kind: 'system', id: nextBlockId(), text: `Bloqueado durante «Crear PR»: ${blocked}` }]);
  void mage
    .answerPermission({ sessionId, requestId: event.request.requestId, decision: { behavior: 'deny', message } })
    .catch((err: unknown) => failChat(set, tabId, describeError(err)));
}

function sendNextQueuedMessage(get: () => WorkbenchState, tabId: string, set: SetFn): void {
  if (isTurnRunning(get().statusByChat[tabId])) return;
  const { next, rest } = takeNextMessage(get().queuedByChat[tabId] ?? []);
  if (next === null) return;
  set((s) => ({ queuedByChat: rest.length === 0 ? without(s.queuedByChat, tabId) : { ...s.queuedByChat, [tabId]: rest } }));
  void get().sendMessageToTab(tabId, next.text, next.attachments);
}

// Vacia la cola en el input, en orden y delante de lo que ya hubiera escrito.
function returnQueueToDraft(get: () => WorkbenchState, set: SetFn, tabId: string): void {
  const queue = get().queuedByChat[tabId] ?? [];
  if (queue.length === 0) return;
  set((s) => ({ queuedByChat: without(s.queuedByChat, tabId) }));
  get().setDraft(tabId, mergeIntoDraft(queue, get().draftByChat[tabId] ?? NO_DRAFT));
}

function patchBlocks(set: SetFn, tabId: string, fn: (blocks: readonly Block[]) => readonly Block[]): void {
  set((s) => withBlocks(s, tabId, fn(blocksOf(s, tabId))));
}

function setStatus(set: SetFn, tabId: string, status: ChatStatus): void {
  set((s) => ({ statusByChat: { ...s.statusByChat, [tabId]: status } }));
}

function failChat(set: SetFn, tabId: string, message: string): void {
  set((s) => ({
    ...withBlocks(s, tabId, appendErrorBlock(blocksOf(s, tabId), message, nextBlockId())),
    statusByChat: { ...s.statusByChat, [tabId]: 'error' },
  }));
}

function blocksOf(state: WorkbenchState, tabId: string): readonly Block[] {
  return state.blocksByChat[tabId] ?? EMPTY_BLOCKS;
}

function withBlocks(state: WorkbenchState, tabId: string, blocks: readonly Block[]): Partial<WorkbenchState> {
  return { blocksByChat: { ...state.blocksByChat, [tabId]: blocks } };
}

function tabIdForSession(state: WorkbenchState, sessionId: string): string | null {
  for (const [tabId, id] of Object.entries(state.sessionIdByChat)) {
    if (id === sessionId) return tabId;
  }
  return null;
}

// Devuelve una copia del record sin la clave indicada (para limpiar el estado de una pestana cerrada).
function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}

// Cierra la pestana cuya sesion (viva o a reanudar) coincide con sessionId, si existe. Evita que el
// CLI siga con el fichero abierto al borrarlo/moverlo.
async function closeMatchingTab(get: () => WorkbenchState, sessionId: string): Promise<void> {
  const state = get();
  const tab = state.tabs.find((t) => (state.sessionIdByChat[t.id] ?? t.resumeSessionId) === sessionId);
  if (tab !== undefined) await state.closeTab(tab.id);
}

// Cuenta activa por defecto: la primera SUSCRIPCION de Claude con login; si no, cualquiera con login;
// si no, la primera disponible; si no, "". Una cuenta que factura la API nunca es la de por defecto
// (grupo E): usarla tiene que ser una eleccion.
function pickDefaultAccountId(accounts: readonly Account[]): string {
  const subscription = accounts.find((a) => a.loginStatus === 'logged_in' && a.providerId === 'claude' && !a.apiBilled);
  const loggedIn = accounts.find((a) => a.loginStatus === 'logged_in' && !a.apiBilled);
  return (subscription ?? loggedIn ?? accounts[0])?.id ?? '';
}

// Pestaña nueva en una cuenta de otro CLI: su proveedor, el modelo por defecto de ese proveedor (o el
// primero de su catalogo) y su esfuerzo por defecto.
function newTabForProviderAccount(
  account: Account,
  cwd: string,
  privacy: ConversationPrivacy,
  settings: AppSettings,
): Parameters<WorkbenchState['newTab']>[0] {
  const provider = account.providerId;
  const model = defaultModelForProvider(settings.defaultModelByProvider, provider) || (providerFallbackModel(provider, settings.customProviders) ?? '');
  const effort = defaultEffortForProvider(settings.defaultModelByProvider, provider);
  return {
    accountId: account.id,
    cwd,
    model,
    provider,
    title: NEW_CONVERSATION_TITLE,
    privacy,
    ...(effort.length === 0 ? {} : { effort }),
  };
}

export function notifyMcpLogin(mage: Pick<MageClient, 'openMcpLogin'>, server: string, loginId: string): void {
  notify({
    level: 'warning',
    title: `El servidor MCP ${server} pide iniciar sesión`,
    body: 'Sus herramientas llegarán cuando termines en el navegador.',
    actions: [{ label: 'Iniciar sesión', run: () => mage.openMcpLogin(loginId) }],
    timeoutMs: null,
    dedupeKey: `mcp-login:${loginId}`,
    source: 'mcp-login',
  });
}

// Pestaña del runtime propio cuando no hay ninguna cuenta: el proveedor por defecto si es del usuario y,
// si no, el primero que haya dado de alta. null = no hay ninguno (no se puede abrir nada).
function runtimeTabWithoutAccount(settings: AppSettings, privacy: ConversationPrivacy): Omit<Parameters<WorkbenchState['newTab']>[0], 'cwd'> | null {
  const byDefault = settings.customProviders.find((p) => p.id === settings.defaultProvider);
  const provider = byDefault ?? settings.customProviders[0];
  if (provider === undefined) return null;
  const model = defaultModelForProvider(settings.defaultModelByProvider, provider.id) || (providerFallbackModel(provider.id, settings.customProviders) ?? '');
  if (model.length === 0) return null;
  return { accountId: '', model, provider: provider.id, title: NEW_CONVERSATION_TITLE, privacy };
}

function providerLabel(provider: string, customProviders: readonly CustomProvider[]): string {
  return customProviders.find((p) => p.id === provider)?.label ?? provider;
}

// Titulo de pestana: ultimo segmento no vacio del cwd (cross-platform: separa por / y \).
function deriveTitle(cwd: string): string {
  const segments = cwd.split(/[\\/]+/).filter((s) => s.length > 0);
  return segments[segments.length - 1] ?? cwd;
}

// Hora local HH:MM para el bloque de usuario (presentacion; el store no depende de esto para logica).
function currentTime(): string {
  return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// Contrato de error: mensaje legible que incluye el valor recibido; nunca tragar el error.
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : `Error desconocido: ${String(err)}`;
}

const EMPTY_BLOCKS: readonly Block[] = [];

// Linea que deja `/clear` en el chat vaciado (P-028).
export const CONVERSATION_RESET_TEXT = 'Conversación reiniciada';

export function selectAccount(state: WorkbenchState, accountId: string): Account | undefined {
  return state.accounts.find((a) => a.id === accountId);
}

// Panel (camino) donde debe aterrizar una pestaña nueva: el que la pidio por su ancla, y si esa
// pestaña ya no existe —se cerro con el dialogo abierto—, el panel enfocado. Nunca lanza: 'firstLeafPath'
// siempre devuelve una hoja porque el arbol nunca esta vacio.
// A quien pasa el foco al cerrar la pestaña ACTIVA: la primera conversacion; sin ninguna, la de
// novedades si sigue abierta en algun panel (si no, el panel mostraria la pantalla vacia con la pestaña
// de novedades al lado sin seleccionar); y si no, nadie.
function nextActiveAfterClose(tabs: readonly Tab[], layout: SplitLayout, closedTabId: string): string {
  const first = tabs[0]?.id;
  if (first !== undefined) return first;
  const notesStayOpen = closedTabId !== RELEASE_NOTES_TAB_ID && findLeafPath(layout, RELEASE_NOTES_TAB_ID) !== null;
  return notesStayOpen ? RELEASE_NOTES_TAB_ID : '';
}

// En dev la regla de novedades dice «no abrir» (el dev comparte `userData` con la instalada). El harness
// de `verify:gui` la quiere medir, asi que puede levantar esa condicion con una variable de Vite.
function isReleaseNotesDevRun(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_MAGE_RELEASE_NOTES_IN_DEV !== '1';
}

function paneForNewTab(s: { readonly splitLayout: SplitLayout; readonly activeTabId: string; readonly newTabAnchorTabId: string | null }): SplitPath {
  const porAncla = s.newTabAnchorTabId === null ? null : findLeafPath(s.splitLayout, s.newTabAnchorTabId);
  return porAncla ?? findLeafPath(s.splitLayout, s.activeTabId) ?? firstLeafPath(s.splitLayout);
}
