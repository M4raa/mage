import { contextBridge, ipcRenderer, webFrame } from 'electron';
import {
  EVENT_CHANNEL,
  IpcChannel,
  JUMP_LIST_OPEN_CHANNEL,
  TRANSCRIPT_BATCH_CHANNEL,
  WIDGET_ENABLED_CHANGED_CHANNEL,
  WIDGET_FOCUS_TAB_CHANNEL,
  WIDGET_SNAPSHOT_CHANNEL,
  SETTINGS_CHANGED_CHANNEL,
  WINDOW_TAB_RECEIVED_CHANNEL,
} from '@shared/ipc';
import type {
  AnswerPermissionParams,
  CreateSessionParams,
  HandoffPromptParams,
  JumpListOpenPayload,
  EditCommandName,
  TitleBarOverlayColors,
  ImprovePromptParams,
  LoadPanelLayoutParams,
  MageApi,
  NotifyParams,
  OpenEditorParams,
  OpenTranscriptParams,
  ProviderProbeParams,
  ReadInstructionsParams,
  ReadProjectFileParams,
  WriteProjectFileParams,
  ReadMemoryParams,
  OpenArtifactParams,
  RecordArtifactParams,
  SaveConversationPrefsParams,
  SaveSharedConfigParams,
  SendMessageParams,
  SessionEventPayload,
  SetModelParams,
  SetPermissionModeParams,
  TranscriptBatchPayload,
  MoveTabToWindowParams,
} from '@shared/ipc';
import type { WidgetSnapshot } from '@shared/widget';
import type { FetchThemeParams } from '@shared/themeMarket';
import { DebugChannel } from '@shared/debug';
import type { LogEntry, MageDebugApi, RendererLogInput } from '@shared/debug';
import type { PersistedTab, PersistedWorkspace } from '@shared/state';
import type { AppSettings } from '@shared/settings';
import type { PanelLayoutState } from '@shared/panelLayout';
import type { DeleteConversationParams, MoveConversationParams } from '@shared/conversations';

// Puente unico entre renderer y main. El renderer solo ve esta API tipada (window.mage);
// no tiene acceso a Node, FS ni procesos. Cada metodo reenvia por un canal del contrato IPC.
const api: MageApi = {
  createSession: (params: CreateSessionParams) => ipcRenderer.invoke(IpcChannel.SessionCreate, params),
  sendMessage: (params: SendMessageParams) => ipcRenderer.invoke(IpcChannel.SessionSendMessage, params),
  answerPermission: (params: AnswerPermissionParams) =>
    ipcRenderer.invoke(IpcChannel.SessionAnswerPermission, params),
  interrupt: (sessionId: string) => ipcRenderer.invoke(IpcChannel.SessionInterrupt, sessionId),
  setModel: (params: SetModelParams) => ipcRenderer.invoke(IpcChannel.SessionSetModel, params),
  setPermissionMode: (params: SetPermissionModeParams) =>
    ipcRenderer.invoke(IpcChannel.SessionSetPermissionMode, params),
  stop: (sessionId: string) => ipcRenderer.invoke(IpcChannel.SessionStop, sessionId),
  getScratchDir: () => ipcRenderer.invoke(IpcChannel.SessionGetScratchDir),
  getScratchRoot: () => ipcRenderer.invoke(IpcChannel.SessionGetScratchRoot),
  isAgyInstalled: () => ipcRenderer.invoke(IpcChannel.AgyInstalled),
  probeProvider: (params: ProviderProbeParams) => ipcRenderer.invoke(IpcChannel.ProviderProbe, params),
  revealFile: (path: string) => ipcRenderer.invoke(IpcChannel.FileReveal, path),
  saveFileAs: (path: string) => ipcRenderer.invoke(IpcChannel.FileSaveAs, path),
  openPath: (path: string) => ipcRenderer.invoke(IpcChannel.OpenPath, path),
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannel.OpenExternal, url),
  setTitleBarOverlay: (colors: TitleBarOverlayColors) => ipcRenderer.invoke(IpcChannel.TitleBarOverlay, colors),
  runEditCommand: (command: EditCommandName) => ipcRenderer.invoke(IpcChannel.EditCommand, command),
  openTerminal: (cwd: string) => ipcRenderer.invoke(IpcChannel.OpenTerminal, cwd),
  listEditors: () => ipcRenderer.invoke(IpcChannel.EditorsList),
  openEditor: (params: OpenEditorParams) => ipcRenderer.invoke(IpcChannel.OpenEditor, params),
  listAccounts: () => ipcRenderer.invoke(IpcChannel.AccountsList),
  createAccount: (name: string) => ipcRenderer.invoke(IpcChannel.AccountsCreate, name),
  startLogin: (params) => ipcRenderer.invoke(IpcChannel.AccountsLoginStart, params),
  submitLoginCode: (code: string) => ipcRenderer.invoke(IpcChannel.AccountsLoginSubmitCode, code),
  cancelLogin: () => ipcRenderer.invoke(IpcChannel.AccountsLoginCancel),
  adoptLogin: (params) => ipcRenderer.invoke(IpcChannel.AccountsAdoptLogin, params),
  deleteAccount: (configDir: string) => ipcRenderer.invoke(IpcChannel.AccountsDelete, configDir),
  pickDirectory: () => ipcRenderer.invoke(IpcChannel.DialogPickDirectory),
  isFolderTrusted: (params) => ipcRenderer.invoke(IpcChannel.TrustIsFolderTrusted, params),
  readThinking: (sessionId) => ipcRenderer.invoke(IpcChannel.ThinkingRead, sessionId),
  getUsage: (configDir: string) => ipcRenderer.invoke(IpcChannel.UsageGet, configDir),
  getStatus: () => ipcRenderer.invoke(IpcChannel.StatusGet),
  getAppVersion: () => ipcRenderer.invoke(IpcChannel.AppVersionGet),
  getAbout: () => ipcRenderer.invoke(IpcChannel.AboutGet),
  setWindowOpacity: (percent: number) => ipcRenderer.invoke(IpcChannel.WindowOpacitySet, percent),
  // Escala de la interfaz: el zoom propio de Chromium. Va por `webFrame` y no por IPC porque es del
  // frame que lo pide — asi cada ventana (principal, widget, artifact) escala la suya sin coordinar
  // nada, y no hay un viaje a main por cada paso del deslizador.
  setUiScale: (percent: number) => {
    webFrame.setZoomFactor(percent / 100);
  },
  onSessionEvent: (listener: (payload: SessionEventPayload) => void) => {
    // Envolvemos el listener para no filtrar el objeto `event` de Electron al renderer.
    const handler = (_: unknown, payload: SessionEventPayload) => listener(payload);
    ipcRenderer.on(EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, handler);
  },
  openTranscript: (transcriptId: string, params: OpenTranscriptParams) => ipcRenderer.invoke(IpcChannel.TranscriptOpen, transcriptId, params),
  cancelTranscript: (transcriptId: string) => ipcRenderer.invoke(IpcChannel.TranscriptCancel, transcriptId),
  onTranscriptBatch: (listener: (payload: TranscriptBatchPayload) => void) => {
    const handler = (_: unknown, payload: TranscriptBatchPayload) => listener(payload);
    ipcRenderer.on(TRANSCRIPT_BATCH_CHANNEL, handler);
    return () => ipcRenderer.removeListener(TRANSCRIPT_BATCH_CHANNEL, handler);
  },
  readMemory: (params: ReadMemoryParams) => ipcRenderer.invoke(IpcChannel.MemoryRead, params),
  listConversations: (accountDir: string) => ipcRenderer.invoke(IpcChannel.ConversationsList, accountDir),
  deleteConversation: (params: DeleteConversationParams) => ipcRenderer.invoke(IpcChannel.ConversationsDelete, params),
  moveConversation: (params: MoveConversationParams) => ipcRenderer.invoke(IpcChannel.ConversationsMove, params),
  loadWorkspace: () => ipcRenderer.invoke(IpcChannel.StateLoad),
  saveWorkspace: (state: PersistedWorkspace) => ipcRenderer.invoke(IpcChannel.StateSave, state),
  loadCommandCatalog: (accountDir: string) => ipcRenderer.invoke(IpcChannel.CommandCatalogLoad, accountDir),
  loadConversationPrefs: (sessionId: string) => ipcRenderer.invoke(IpcChannel.ConversationPrefsLoad, sessionId),
  saveConversationPrefs: (params: SaveConversationPrefsParams) => ipcRenderer.invoke(IpcChannel.ConversationPrefsSave, params),
  recordArtifact: (params: RecordArtifactParams) => ipcRenderer.invoke(IpcChannel.ArtifactRecordSave, params),
  openArtifact: (params: OpenArtifactParams) => ipcRenderer.invoke(IpcChannel.ArtifactOpen, params),
  lookupArtifactPublisher: (url: string) => ipcRenderer.invoke(IpcChannel.ArtifactPublisherLookup, url),
  readInstructions: (params: ReadInstructionsParams) => ipcRenderer.invoke(IpcChannel.InstructionsRead, params),
  readProjectFile: (params: ReadProjectFileParams) => ipcRenderer.invoke(IpcChannel.ProjectFileRead, params),
  writeProjectFile: (params: WriteProjectFileParams) => ipcRenderer.invoke(IpcChannel.ProjectFileWrite, params),
  readEffectiveSettings: (params: ReadInstructionsParams) => ipcRenderer.invoke(IpcChannel.EffectiveSettingsRead, params),
  loadSettings: () => ipcRenderer.invoke(IpcChannel.SettingsLoad),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke(IpcChannel.SettingsSave, settings),
  improvePrompt: (params: ImprovePromptParams) => ipcRenderer.invoke(IpcChannel.PromptImprove, params),
  generateHandoff: (params: HandoffPromptParams) => ipcRenderer.invoke(IpcChannel.PromptHandoff, params),
  notify: (params: NotifyParams) => ipcRenderer.invoke(IpcChannel.NotifyShow, params),
  setWidgetEnabled: (enabled: boolean) => ipcRenderer.invoke(IpcChannel.WidgetSetEnabled, enabled),
  pushWidgetSnapshot: (snapshot: WidgetSnapshot) => ipcRenderer.send(IpcChannel.WidgetUpdate, snapshot),
  activateWidgetTab: (tabId: string) => ipcRenderer.send(IpcChannel.WidgetActivateTab, tabId),
  onWidgetSnapshot: (listener: (snapshot: WidgetSnapshot) => void) => {
    const handler = (_: unknown, snapshot: WidgetSnapshot) => listener(snapshot);
    ipcRenderer.on(WIDGET_SNAPSHOT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(WIDGET_SNAPSHOT_CHANNEL, handler);
  },
  onWidgetFocusTab: (listener: (tabId: string) => void) => {
    const handler = (_: unknown, tabId: string) => listener(tabId);
    ipcRenderer.on(WIDGET_FOCUS_TAB_CHANNEL, handler);
    return () => ipcRenderer.removeListener(WIDGET_FOCUS_TAB_CHANNEL, handler);
  },
  onJumpListOpen: (listener: (payload: JumpListOpenPayload) => void) => {
    const handler = (_: unknown, payload: JumpListOpenPayload) => listener(payload);
    ipcRenderer.on(JUMP_LIST_OPEN_CHANNEL, handler);
    return () => ipcRenderer.removeListener(JUMP_LIST_OPEN_CHANNEL, handler);
  },
  onWidgetEnabledChanged: (listener: (enabled: boolean) => void) => {
    const handler = (_: unknown, enabled: boolean) => listener(enabled);
    ipcRenderer.on(WIDGET_ENABLED_CHANGED_CHANNEL, handler);
    return () => ipcRenderer.removeListener(WIDGET_ENABLED_CHANGED_CHANNEL, handler);
  },
  searchThemes: (query: string, offset?: number) => ipcRenderer.invoke(IpcChannel.ThemeMarketSearch, query, offset),
  fetchTheme: (params: FetchThemeParams) => ipcRenderer.invoke(IpcChannel.ThemeMarketFetch, params),
  loadSharedConfig: () => ipcRenderer.invoke(IpcChannel.SharedConfigLoad),
  saveSharedConfig: (params: SaveSharedConfigParams) => ipcRenderer.invoke(IpcChannel.SharedConfigSave, params),
  loadPanelLayout: (params: LoadPanelLayoutParams) => ipcRenderer.invoke(IpcChannel.PanelsLoad, params),
  savePanelLayout: (state: PanelLayoutState) => ipcRenderer.invoke(IpcChannel.PanelsSave, state),
  // Varias ventanas del workbench. `loadWorkspace`/`saveWorkspace` NO cambian de firma: main resuelve
  // por el `event.sender` a que ventana pertenece cada llamada y le sirve SU workspace.
  openWindow: () => ipcRenderer.invoke(IpcChannel.WindowsOpen),
  listWindows: () => ipcRenderer.invoke(IpcChannel.WindowsList),
  moveTabToWindow: (params: MoveTabToWindowParams) => ipcRenderer.invoke(IpcChannel.WindowsMoveTab, params),
  onSettingsChanged: (listener: (settings: AppSettings) => void) => {
    const handler = (_: unknown, settings: AppSettings) => listener(settings);
    ipcRenderer.on(SETTINGS_CHANGED_CHANNEL, handler);
    return () => ipcRenderer.removeListener(SETTINGS_CHANGED_CHANNEL, handler);
  },
  onTabReceived: (listener: (tab: PersistedTab) => void) => {
    const handler = (_: unknown, tab: PersistedTab) => listener(tab);
    ipcRenderer.on(WINDOW_TAB_RECEIVED_CHANNEL, handler);
    return () => ipcRenderer.removeListener(WINDOW_TAB_RECEIVED_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('mage', api);

// API del stream de debug (Tarea 1b). Presente en ambas ventanas; en produccion el main no
// crea la ventana de debug ni empuja entradas, pero exponer la API es inocuo (no filtra Node).
const debugApi: MageDebugApi = {
  reportRendererLog: (input: RendererLogInput) => ipcRenderer.send(DebugChannel.RendererLog, input),
  onLog: (listener: (entry: LogEntry) => void) => {
    const handler = (_: unknown, entry: LogEntry) => listener(entry);
    ipcRenderer.on(DebugChannel.Log, handler);
    return () => ipcRenderer.removeListener(DebugChannel.Log, handler);
  },
};

contextBridge.exposeInMainWorld('mageDebug', debugApi);
