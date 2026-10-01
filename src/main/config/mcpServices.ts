import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { McpStatusByAccount, McpStatusCache } from '@shared/mcp';
import { writeAtomic, type AtomicWriteDeps } from '../os/atomicFile';
import { AgySyncService } from './mcpAgySync';
import { McpExtensionService, type ExtensionVault } from './mcpExtensionService';
import type { ClaudeMcpConfigWriter } from './mcpProviderTranslate';
import { selectForTarget, type ResolvedMcpList } from './mcpResolved';
import { mergeStatusCache, parseStatusCache, pruneStatusCache } from './mcpStatusCache';
import { resolveSharedMcp, type McpCommonConfig } from './sharedConfigService';

// Composicion de lo de MCP que vive en disco (extensiones, sincronizacion con agy, cache de estado y los
// `--mcp-config` generados), con el FS real. Todo lo que decide esta en los modulos puros; aqui solo
// se eligen rutas y se enchufa `node:fs`.

export interface McpServicesContext {
  readonly userDataDir: string;
  readonly homedir: string;
  readonly platform: NodeJS.Platform;
  readonly pathSeparator: string;
  readonly vault: ExtensionVault;
  readonly isCommandAvailable: (command: string) => boolean;
  readonly desktopDirs: () => readonly string[];
  // mcp_config.json de agy (el real, o el falso de verify:gui).
  readonly agyConfigPath: string;
  readonly loadCommon: () => McpCommonConfig | null;
  readonly accountDirs: () => readonly string[];
  readonly warn: (message: string) => void;
}

export interface McpServices {
  readonly extensions: McpExtensionService;
  readonly agySync: AgySyncService;
  // Comunes activos + extensiones activas, en formato neutro (SIN filtrar por destino).
  readonly sharedMcp: () => ResolvedMcpList;
  readonly writeClaudeMcpConfig: ClaudeMcpConfigWriter;
  readonly loadStatusCache: () => McpStatusCache;
  readonly saveStatuses: (fresh: McpStatusByAccount) => McpStatusCache;
}

const GENERATED_DIR = join('shared-config', 'generated');
const STATUS_CACHE_FILE = 'mcp-status-cache.json';

export function createMcpServices(ctx: McpServicesContext): McpServices {
  const atomic = atomicDeps();
  const extensions = new McpExtensionService({
    root: join(ctx.userDataDir, 'extensions'),
    settingsRoot: join(ctx.userDataDir, 'extensions-settings'),
    fs: {
      exists: existsSync,
      readText: (path) => readFileSync(path, 'utf8'),
      readBytes: (path) => readFileSync(path),
      writeBytes: (path, data) => writeFileSync(path, data),
      writeTextAtomic: (path, text) => writeAtomic(atomic, path, text),
      mkdir: (path) => mkdirSync(path, { recursive: true }),
      removeTree: (path) => rmSync(path, { recursive: true, force: true }),
      rename: renameSync,
      // Sin seguir enlaces: una extension de Desktop con un enlace dentro se copia como enlace, no como
      // lo que haya al otro lado.
      copyTree: (from, to) => cpSync(from, to, { recursive: true, verbatimSymlinks: true }),
      listDir: (path) => readdirSync(path),
    },
    vault: ctx.vault,
    platform: ctx.platform,
    homedir: ctx.homedir,
    pathSeparator: ctx.pathSeparator,
    isCommandAvailable: ctx.isCommandAvailable,
    newToken: () => randomUUID(),
    desktopDirs: ctx.desktopDirs,
  });
  const sharedMcp = (): ResolvedMcpList => resolveSharedMcp(ctx.loadCommon(), extensions.resolveActive());
  const agySync = new AgySyncService({
    configPath: ctx.agyConfigPath,
    statePath: join(ctx.userDataDir, 'shared-config', 'agy-sync.json'),
    backupDir: join(ctx.userDataDir, 'agy-backups'),
    fs: { ...atomic, mkdir: (path) => mkdirSync(path, { recursive: true }), listDir: (path) => readdirSync(path), removeFile: (path) => rmSync(path, { force: true }) },
    now: () => new Date(),
    servers: () => selectForTarget(sharedMcp().servers, { family: 'agy', accountId: null }),
  });
  return { extensions, agySync, sharedMcp, writeClaudeMcpConfig: claudeConfigWriter(ctx.userDataDir, atomic), ...statusCacheIo(ctx, atomic) };
}

// Un fichero por cuenta (lo que carga depende de su «Solo en…»), nombrado por la huella de su config
// dir. Lleva los valores de env/cabeceras: vive en la carpeta de Mage, como mcp-common.json.
function claudeConfigWriter(userDataDir: string, atomic: AtomicWriteDeps): ClaudeMcpConfigWriter {
  return (accountDir, text) => {
    const dir = join(userDataDir, GENERATED_DIR);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `claude-${createHash('sha256').update(accountDir).digest('hex').slice(0, 16)}.mcp.json`);
    writeAtomic(atomic, path, text);
    return path;
  };
}

function statusCacheIo(ctx: McpServicesContext, atomic: AtomicWriteDeps): Pick<McpServices, 'loadStatusCache' | 'saveStatuses'> {
  const path = join(ctx.userDataDir, STATUS_CACHE_FILE);
  const load = (): McpStatusCache => pruneStatusCache(parseStatusCache(existsSync(path) ? readFileSync(path, 'utf8') : null, ctx.warn), ctx.accountDirs());
  return {
    loadStatusCache: load,
    saveStatuses: (fresh) => {
      const next = mergeStatusCache(load(), fresh, new Date());
      writeAtomic(atomic, path, `${JSON.stringify(next, null, 2)}\n`);
      return next;
    },
  };
}

function atomicDeps(): AtomicWriteDeps & { readonly removeFile: (path: string) => void } {
  return {
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: (path, data) => writeFileSync(path, data, 'utf8'),
    rename: renameSync,
    tempSuffix: () => randomUUID(),
    removeFile: (path) => rmSync(path, { force: true }),
  };
}
