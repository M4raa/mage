import { IpcChannel } from '@shared/ipc';
import type {
  McpAuthParams,
  McpAuthResult,
  McpCommonMutateParams,
  McpImportApplyParams,
  McpImportPreview,
  McpInventory,
  McpInventoryParams,
  McpRevealedSecrets,
  McpStatusByAccount,
  McpWriteResult,
} from '@shared/mcp';
import { applyMcpCommonMutation, revealMcpCommonSecrets } from './mcpCommonEdit';
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

// Canales IPC de «MCP y conectores» (P-028 puntos 5 y 34). Aqui solo hay cableado: la logica vive en
// los modulos puros (mcpInventory, mcpCommonEdit, mcpStatusProbe) y el FS/Electron llegan inyectados.

export interface McpIpcDeps {
  readonly handle: (channel: string, listener: (event: unknown, ...args: never[]) => unknown) => void;
  readonly service: SharedConfigService;
  readonly fs: McpInventoryDeps;
  readonly commonPath: () => string;
  readonly accounts: () => readonly McpAccountLocation[];
  // Rutas de fuentes que no son de Mage (legado y Claude Desktop), ya resueltas por SO.
  readonly legacySharedPath: () => string;
  readonly desktopDirs: () => readonly string[];
  readonly homedir: string;
  readonly pathSeparator: string;
  readonly probeStatuses: () => Promise<McpStatusByAccount>;
  readonly authenticate: (accountDir: string, serverName: string) => Promise<McpAuthResult>;
}

const EMPTY_COMMON_TEXT = '{"mcpServers": {}}';

export function registerMcpIpc(deps: McpIpcDeps): void {
  const locations = (projectDirs: readonly string[], withLegacy: boolean): McpSourceLocations => ({
    commonPath: deps.commonPath(),
    legacySharedPath: withLegacy ? deps.legacySharedPath() : null,
    accounts: deps.accounts(),
    projectDirs,
    desktopDirs: deps.desktopDirs(),
    homedir: deps.homedir,
    pathSeparator: deps.pathSeparator,
  });
  // `.mcp.json` que se leen al importar: los de las carpetas abiertas y los de cada proyecto que el CLI
  // conoce (las claves `projects` de los .claude.json, que ya lee el inventario como ambito local).
  const importDirs = (projectDirs: readonly string[]): readonly string[] => {
    const known = readMcpSources(deps.fs, locations([], false)).entries.flatMap((entry) => entry.origin.projectDir ?? []);
    return [...new Set([...projectDirs, ...known])];
  };
  const version = (): string | null => mcpCommonVersion(deps.service.readBaseline(deps.commonPath()));

  deps.handle(IpcChannel.McpInventoryLoad, (_e, params: McpInventoryParams): McpInventory => {
    const accountDirs = deps.accounts().map((account) => account.configDir);
    return buildInventory(readMcpSources(deps.fs, locations(params.projectDirs, false)), accountDirs, version());
  });

  deps.handle(IpcChannel.McpCommonMutate, (_e, params: McpCommonMutateParams): McpWriteResult =>
    writeCommon(deps, params.expected, (text) => ({ text: applyMcpCommonMutation(text, params.mutation), notes: [] })),
  );

  deps.handle(IpcChannel.McpCommonReveal, (_e, name: string): McpRevealedSecrets => {
    const baseline = deps.service.readBaseline(deps.commonPath());
    return revealMcpCommonSecrets(baseline ?? EMPTY_COMMON_TEXT, name);
  });

  deps.handle(IpcChannel.McpImportPreview, (_e, params: McpInventoryParams): McpImportPreview => {
    const read = readMcpSources(deps.fs, locations(importDirs(params.projectDirs), true));
    return { candidates: buildImportCandidates(read.entries), commonVersion: version() };
  });

  // El renderer solo manda ids: main RELEE las fuentes y escribe con el mismo CAS que el editor.
  deps.handle(IpcChannel.McpImportApply, (_e, params: McpImportApplyParams): McpWriteResult => {
    const read = readMcpSources(deps.fs, locations(importDirs(params.projectDirs), true));
    return writeCommon(deps, params.expected, (text) => applyImportPicks(text, read.entries, params.picks));
  });

  deps.handle(IpcChannel.McpStatusProbe, (): Promise<McpStatusByAccount> => deps.probeStatuses());

  // Frontera: el renderer solo puede pedirlo para una cuenta que Mage conoce (su configDir decide donde
  // guarda el CLI el token).
  deps.handle(IpcChannel.McpAuthenticate, (_e, params: McpAuthParams): Promise<McpAuthResult> => {
    const { accountDir, serverName } = params ?? {};
    if (typeof accountDir !== 'string' || !deps.accounts().some((account) => account.configDir === accountDir)) {
      throw new Error(`McpAuthenticate: cuenta desconocida (${JSON.stringify(accountDir)})`);
    }
    if (typeof serverName !== 'string') throw new Error(`McpAuthenticate: serverName no es texto (${JSON.stringify(serverName)})`);
    return deps.authenticate(accountDir, serverName);
  });
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
