import { z } from 'zod';
import { IpcChannel } from '@shared/ipc';
import type {
  McpAgySyncPreview,
  McpAgySyncResult,
  McpAgySyncState,
  McpAuthParams,
  McpAuthResult,
  McpCommonMutateParams,
  McpExtensionInstallPreview,
  McpExtensionList,
  McpImportApplyParams,
  McpImportPreview,
  McpInventory,
  McpInventoryParams,
  McpRevealedSecrets,
  McpStatusByAccount,
  McpStatusCache,
  McpWriteResult,
} from '@shared/mcp';
import type { AgySyncService } from './mcpAgySync';
import { applyMcpCommonMutation, revealMcpCommonSecrets } from './mcpCommonEdit';
import type { McpExtensionService } from './mcpExtensionService';
import {
  applyImportPicks,
  buildImportCandidates,
  buildInventory,
  mcpCommonVersion,
  readMcpSources,
  type McpAccountLocation,
  type McpInventoryDeps,
  type McpSourceLocations,
} from './mcpInventory';
import type { SharedConfigService } from './sharedConfigService';

// Canales IPC de «MCP y conectores» (P-028 puntos 5 y 34; 0.1.2 grupo C). Aqui solo hay cableado y
// validacion de la frontera: la logica vive en los modulos puros y el FS/Electron llegan inyectados.

export interface McpIpcDeps {
  readonly handle: (channel: string, listener: (event: unknown, ...args: never[]) => unknown) => void;
  readonly service: SharedConfigService;
  readonly fs: McpInventoryDeps;
  readonly commonPath: () => string;
  readonly accounts: () => readonly McpAccountLocation[];
  // Rutas de fuentes que no son de Mage (legado, Claude Desktop, agy), ya resueltas por SO.
  readonly legacySharedPath: () => string;
  readonly desktopDirs: () => readonly string[];
  readonly agyConfigPath: () => string;
  readonly probeStatuses: () => Promise<McpStatusByAccount>;
  readonly authenticate: (accountDir: string, serverName: string) => Promise<McpAuthResult>;
  readonly extensions: McpExtensionService;
  readonly agySync: AgySyncService;
  readonly loadStatusCache: () => McpStatusCache;
  readonly saveStatuses: (fresh: McpStatusByAccount) => McpStatusCache;
  // Dialogos nativos de main (null = cancelado).
  readonly pickArchive: () => Promise<string | null>;
  readonly pickFile: () => Promise<string | null>;
  // Tras cualquier cambio de lo que Mage comparte (comunes, extensiones): la sincronizacion automatica
  // con agy, si esta activada.
  readonly onSharedChanged: () => void;
}

const EMPTY_COMMON_TEXT = '{"mcpServers": {}}';
const ID = z.string().min(1);
const SCOPE = z.array(z.string().min(1)).min(1).nullable();
const USER_VALUE = z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]);

export function registerMcpIpc(deps: McpIpcDeps): void {
  registerInventory(deps);
  registerStatus(deps);
  registerExtensions(deps);
  registerAgySync(deps);
}

function sourceLocations(deps: McpIpcDeps, projectDirs: readonly string[], withLegacy: boolean): McpSourceLocations {
  return {
    commonPath: deps.commonPath(),
    legacySharedPath: withLegacy ? deps.legacySharedPath() : null,
    accounts: deps.accounts(),
    projectDirs,
    desktopDirs: deps.desktopDirs(),
    agyConfigPath: deps.agyConfigPath(),
    agyExported: deps.agySync.state().exported,
    // Codex: lo rellena su adapter (grupo E) con `codex mcp list --json` por cuenta.
    codex: [],
  };
}

function registerInventory(deps: McpIpcDeps): void {
  // `.mcp.json` que se leen al importar: los de las carpetas abiertas y los de cada proyecto que el CLI
  // conoce (las claves `projects` de los .claude.json, que ya lee el inventario como ambito local).
  const importDirs = (projectDirs: readonly string[]): readonly string[] => {
    const known = readMcpSources(deps.fs, sourceLocations(deps, [], false)).entries.flatMap((entry) => entry.origin.projectDir ?? []);
    return [...new Set([...projectDirs, ...known])];
  };
  const version = (): string | null => mcpCommonVersion(deps.service.readBaseline(deps.commonPath()));

  deps.handle(IpcChannel.McpInventoryLoad, (_e, params: McpInventoryParams): McpInventory => {
    const accountDirs = deps.accounts().map((account) => account.configDir);
    return buildInventory(readMcpSources(deps.fs, sourceLocations(deps, params.projectDirs, false)), accountDirs, version(), deps.agySync.state().exported);
  });

  deps.handle(IpcChannel.McpCommonMutate, (_e, params: McpCommonMutateParams): McpWriteResult =>
    afterWrite(deps, writeCommon(deps, params.expected, (text) => ({ text: applyMcpCommonMutation(text, params.mutation), notes: [] }))),
  );

  deps.handle(IpcChannel.McpCommonReveal, (_e, name: string): McpRevealedSecrets => {
    const baseline = deps.service.readBaseline(deps.commonPath());
    return revealMcpCommonSecrets(baseline ?? EMPTY_COMMON_TEXT, name);
  });

  deps.handle(IpcChannel.McpImportPreview, (_e, params: McpInventoryParams): McpImportPreview => {
    const read = readMcpSources(deps.fs, sourceLocations(deps, importDirs(params.projectDirs), true));
    return { candidates: buildImportCandidates(read.entries), commonVersion: version() };
  });

  // El renderer solo manda ids: main RELEE las fuentes y escribe con el mismo CAS que el editor.
  deps.handle(IpcChannel.McpImportApply, (_e, params: McpImportApplyParams): McpWriteResult => {
    const read = readMcpSources(deps.fs, sourceLocations(deps, importDirs(params.projectDirs), true));
    return afterWrite(deps, writeCommon(deps, params.expected, (text) => applyImportPicks(text, read.entries, params.picks)));
  });
}

function registerStatus(deps: McpIpcDeps): void {
  deps.handle(IpcChannel.McpStatusProbe, async (): Promise<McpStatusCache> => deps.saveStatuses(await deps.probeStatuses()));
  deps.handle(IpcChannel.McpStatusCacheLoad, (): McpStatusCache => deps.loadStatusCache());

  // Frontera: el renderer solo puede pedirlo para una cuenta que Mage conoce (su configDir decide donde
  // guarda el CLI el token). El ultimo estado que devuelva se guarda en la cache.
  deps.handle(IpcChannel.McpAuthenticate, async (_e, params: McpAuthParams): Promise<McpAuthResult> => {
    const { accountDir, serverName } = params ?? {};
    if (typeof accountDir !== 'string' || !deps.accounts().some((account) => account.configDir === accountDir)) {
      throw new Error(`McpAuthenticate: cuenta desconocida (${JSON.stringify(accountDir)})`);
    }
    if (typeof serverName !== 'string') throw new Error(`McpAuthenticate: serverName no es texto (${JSON.stringify(serverName)})`);
    const result = await deps.authenticate(accountDir, serverName);
    if (result.kind !== 'error' && result.statuses !== null) deps.saveStatuses({ [accountDir]: result.statuses });
    return result;
  });
}

function registerExtensions(deps: McpIpcDeps): void {
  const ext = deps.extensions;
  const changed = (action: () => void): void => {
    action();
    deps.onSharedChanged();
  };
  deps.handle(IpcChannel.McpExtensionsList, (): McpExtensionList => {
    const common = new Set(Object.keys(deps.service.loadMcpCommon(deps.commonPath())?.mcpServers ?? {}));
    return ext.list(common, new Set(deps.agySync.state().exported));
  });
  deps.handle(IpcChannel.McpExtensionPick, async (): Promise<McpExtensionInstallPreview | null> => {
    const path = await deps.pickArchive();
    return path === null ? null : ext.previewInstall(path);
  });
  deps.handle(IpcChannel.McpExtensionInstall, (_e, token: unknown) => changed(() => void ext.install(parseWith(ID, token, 'token'))));
  deps.handle(IpcChannel.McpExtensionImportDesktop, (_e, dirName: unknown) => changed(() => void ext.importFromDesktop(parseWith(ID, dirName, 'dirName'))));
  deps.handle(IpcChannel.McpExtensionSetEnabled, (_e, raw: unknown) => {
    const { id, enabled } = parseWith(z.object({ id: ID, enabled: z.boolean() }), raw, 'setEnabled');
    changed(() => ext.setEnabled(id, enabled));
  });
  deps.handle(IpcChannel.McpExtensionSetOnlyIn, (_e, raw: unknown) => {
    const { id, onlyIn } = parseWith(z.object({ id: ID, onlyIn: SCOPE }), raw, 'setOnlyIn');
    changed(() => ext.setOnlyIn(id, onlyIn));
  });
  deps.handle(IpcChannel.McpExtensionSaveConfig, (_e, raw: unknown) => {
    // El mensaje de error nunca cita los valores: pueden ser la propia clave.
    const result = z.object({ id: ID, values: z.record(z.string(), USER_VALUE) }).safeParse(raw);
    if (!result.success) throw new Error(`Ajustes de extensión inválidos: ${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
    changed(() => ext.saveConfig(result.data.id, result.data.values));
  });
  deps.handle(IpcChannel.McpExtensionRemove, (_e, id: unknown) => changed(() => ext.remove(parseWith(ID, id, 'id'))));
  deps.handle(IpcChannel.McpPickFile, (): Promise<string | null> => deps.pickFile());
}

function registerAgySync(deps: McpIpcDeps): void {
  deps.handle(IpcChannel.McpAgySyncState, (): McpAgySyncState => deps.agySync.state());
  const confirmed = z.array(z.string().min(1)).optional();
  deps.handle(IpcChannel.McpAgySyncPreview, (_e, secretsConfirmed: unknown): McpAgySyncPreview =>
    deps.agySync.preview(parseWith(confirmed, secretsConfirmed, 'secretsConfirmed')),
  );
  deps.handle(IpcChannel.McpAgySyncApply, (_e, raw: unknown): McpAgySyncResult => {
    const params = parseWith(z.object({ expected: z.string().nullable(), secretsConfirmed: z.array(z.string().min(1)) }), raw, 'apply');
    return deps.agySync.apply(params.expected, params.secretsConfirmed);
  });
  deps.handle(IpcChannel.McpAgySyncSetAuto, (_e, auto: unknown): McpAgySyncState => {
    const state = deps.agySync.setAuto(parseWith(z.boolean(), auto, 'auto'));
    if (state.auto) deps.onSharedChanged();
    return deps.agySync.state();
  });
}

function afterWrite(deps: McpIpcDeps, result: McpWriteResult): McpWriteResult {
  if (result.status === 'saved') deps.onSharedChanged();
  return result;
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown, what: string): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new Error(`Parámetro ${what} inválido: ${JSON.stringify(raw)}`);
  return result.data;
}

// Escritura de mcp-common.json con compare-and-swap en dos niveles: la huella que tenia el renderer
// contra lo que hay ahora (alguien lo toco mientras la pantalla estaba abierta) y los bytes leidos
// contra los de disco en el momento de escribir (`writeGuarded`).
function writeCommon(
  deps: McpIpcDeps,
  expected: string | null,
  build: (text: string) => { readonly text: string; readonly notes: readonly string[] },
): McpWriteResult {
  const path = deps.commonPath();
  const baseline = deps.service.readBaseline(path);
  if (mcpCommonVersion(baseline) !== expected) {
    return { status: 'stale', message: 'mcp-common.json ha cambiado fuera de esta pantalla. Se ha recargado: revisa la lista y repite el cambio.' };
  }
  const next = build(baseline ?? EMPTY_COMMON_TEXT);
  const outcome = deps.service.saveMcpCommonText(path, next.text, baseline);
  if (outcome.status === 'stale') return outcome;
  return { status: 'saved', notes: [...next.notes, ...outcome.warnings] };
}
