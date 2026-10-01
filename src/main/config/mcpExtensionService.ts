import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import {
  familiesInScope,
  type McpDesktopExtensionCandidate,
  type McpExtensionInstallPreview,
  type McpExtensionList,
  type McpExtensionView,
  type McpProviderFamily,
  type McpScope,
  type McpUserConfigValue,
} from '@shared/mcp';
import { MCPB_MANIFEST, readMcpb, resolveInside } from './mcpbArchive';
import {
  applyUserConfigValues,
  bareCommand,
  buildUserConfigFields,
  DEFAULT_EXTENSION_SETTINGS,
  extensionIdOf,
  extensionSecretId,
  missingRequiredFields,
  parseExtensionSettings,
  parseMcpbManifest,
  platformProblem,
  resolveExtensionServer,
  type ExtensionSettings,
  type McpbManifest,
} from './mcpExtensions';
import type { ResolvedMcpList, ResolvedMcpServer, ResolvedStdioServer } from './mcpResolved';

// Extensiones de Mage en disco: `<root>/<id>/` con el paquete descomprimido (mismo formato que Claude
// Desktop) y `<settingsRoot>/<id>.json` con `{isEnabled, userConfig, onlyIn}` sin los valores
// sensibles, que van a la boveda. FS inyectado.

export interface ExtensionFs {
  readonly exists: (path: string) => boolean;
  readonly readText: (path: string) => string;
  readonly readBytes: (path: string) => Uint8Array;
  readonly writeBytes: (path: string, data: Uint8Array) => void;
  readonly writeTextAtomic: (path: string, text: string) => void;
  readonly mkdir: (path: string) => void;
  readonly removeTree: (path: string) => void;
  readonly rename: (from: string, to: string) => void;
  readonly copyTree: (from: string, to: string) => void;
  readonly listDir: (path: string) => readonly string[];
}

export interface ExtensionVault {
  readonly get: (id: string) => string | null;
  readonly set: (id: string, value: string) => void;
  readonly has: (id: string) => boolean;
  readonly delete: (id: string) => void;
}

export interface ExtensionServiceDeps {
  readonly root: string;
  readonly settingsRoot: string;
  readonly fs: ExtensionFs;
  readonly vault: ExtensionVault;
  readonly platform: NodeJS.Platform;
  readonly homedir: string;
  readonly pathSeparator: string;
  readonly isCommandAvailable: (command: string) => boolean;
  readonly newToken: () => string;
  // Carpetas de datos de Claude Desktop (ya resueltas por SO).
  readonly desktopDirs: () => readonly string[];
}

const DESKTOP_EXTENSIONS_DIR = 'Claude Extensions';

interface Installed {
  readonly id: string;
  readonly dir: string;
  readonly manifest: McpbManifest;
  readonly settings: ExtensionSettings;
}

interface PendingInstall {
  readonly archivePath: string;
  readonly sha256: string;
}

export class McpExtensionService {
  private readonly pending = new Map<string, PendingInstall>();

  constructor(private readonly deps: ExtensionServiceDeps) {}

  // Lo instalado (con su estado) y lo que hay en Claude Desktop para importar. `commonNames`: comunes
  // con los que puede chocar; `exportedToAgy`: ids que la ultima sincronizacion dejo en agy.
  list(commonNames: ReadonlySet<string>, exportedToAgy: ReadonlySet<string>): McpExtensionList {
    const warnings: string[] = [];
    const installed = this.readInstalled(warnings);
    const ids = new Set(installed.map((item) => item.id));
    return {
      extensions: installed.map((item) => this.viewOf(item, commonNames, exportedToAgy.has(item.id))),
      desktop: this.desktopCandidates(ids, warnings),
      warnings,
    };
  }

  // Lee y valida el paquete que eligio el dialogo nativo (main); no escribe nada. El `token` es lo unico
  // que vuelve del renderer para instalar.
  previewInstall(archivePath: string): McpExtensionInstallPreview {
    const bytes = this.deps.fs.readBytes(archivePath);
    const contents = readMcpb(bytes);
    const manifest = parseMcpbManifest(new TextDecoder().decode(contents.files.get(MCPB_MANIFEST)));
    const id = extensionIdOf(manifest);
    const problem = platformProblem(manifest, this.deps.platform);
    if (problem !== null) throw new Error(`«${manifest.display_name ?? manifest.name}» no se puede instalar aquí: ${problem}`);
    const token = this.deps.newToken();
    this.pending.set(token, { archivePath, sha256: sha256(bytes) });
    const previous = this.readOne(id);
    return {
      token,
      id,
      displayName: manifest.display_name ?? manifest.name,
      version: manifest.version,
      author: manifest.author?.name ?? '',
      serverType: manifest.server.type,
      platforms: manifest.compatibility?.platforms ?? [],
      replacesVersion: previous?.manifest.version ?? null,
      fileCount: contents.files.size,
      unpackedBytes: contents.unpackedBytes,
    };
  }

  // Instala lo confirmado. Se relee el archivo y se exige el mismo hash que en la vista previa: lo que
  // se instala es exactamente lo que el usuario vio.
  install(token: string): string {
    const pending = this.pending.get(token);
    if (pending === undefined) throw new Error(`Instalación caducada o desconocida: ${JSON.stringify(token)}`);
    this.pending.delete(token);
    const bytes = this.deps.fs.readBytes(pending.archivePath);
    if (sha256(bytes) !== pending.sha256) throw new Error('El paquete ha cambiado desde la vista previa: vuelve a elegirlo.');
    const contents = readMcpb(bytes);
    const manifest = parseMcpbManifest(new TextDecoder().decode(contents.files.get(MCPB_MANIFEST)));
    const id = extensionIdOf(manifest);
    this.replaceDir(id, (staging) => {
      for (const [relative, data] of contents.files) {
        const target = resolveInside(staging, relative);
        this.deps.fs.mkdir(dirname(target));
        this.deps.fs.writeBytes(target, data);
      }
    });
    return id;
  }

  // Copia una extension de Claude Desktop (ya descomprimida alli). Deja de depender de Desktop.
  importFromDesktop(dirName: string): string {
    if (dirName.length === 0 || /[\\/]|\.\./.test(dirName)) throw new Error(`Nombre de extensión de Desktop inválido: ${JSON.stringify(dirName)}`);
    const source = this.deps
      .desktopDirs()
      .map((dir) => join(dir, DESKTOP_EXTENSIONS_DIR, dirName))
      .find((dir) => this.deps.fs.exists(join(dir, MCPB_MANIFEST)));
    if (source === undefined) throw new Error(`No hay ninguna extensión «${dirName}» en Claude Desktop`);
    const manifest = parseMcpbManifest(this.deps.fs.readText(join(source, MCPB_MANIFEST)));
    const id = extensionIdOf(manifest);
    this.replaceDir(id, (staging) => this.deps.fs.copyTree(source, staging));
    return id;
  }

  setEnabled(id: string, enabled: boolean): void {
    const item = this.require(id);
    this.writeSettings(id, { ...item.settings, isEnabled: enabled });
  }

  setOnlyIn(id: string, onlyIn: McpScope): void {
    const item = this.require(id);
    this.writeSettings(id, { ...item.settings, onlyIn: onlyIn === null ? null : [...onlyIn] });
  }

  saveConfig(id: string, values: Readonly<Record<string, McpUserConfigValue>>): void {
    const item = this.require(id);
    const next = applyUserConfigValues(item.manifest, item.settings, values);
    for (const [key, value] of next.secrets) {
      if (value === null) this.deps.vault.delete(extensionSecretId(id, key));
      else this.deps.vault.set(extensionSecretId(id, key), value);
    }
    this.writeSettings(id, next.settings);
  }

  remove(id: string): void {
    const item = this.require(id);
    for (const [key, spec] of Object.entries(item.manifest.user_config)) {
      if (spec.sensitive) this.deps.vault.delete(extensionSecretId(id, key));
    }
    this.deps.fs.removeTree(item.dir);
    this.deps.fs.removeTree(this.settingsPath(id));
  }

  // Las activas y completas, ya resueltas. Una que no se puede lanzar se omite con su motivo.
  resolveActive(): ResolvedMcpList {
    const warnings: string[] = [];
    const servers: ResolvedMcpServer[] = [];
    for (const item of this.readInstalled(warnings)) {
      if (!item.settings.isEnabled) continue;
      try {
        servers.push(this.resolve(item));
      } catch (error) {
        warnings.push(`Extensión «${item.id}» omitida: ${describeError(error)}`);
      }
    }
    return { servers, warnings };
  }

  private resolve(item: Installed): ResolvedStdioServer {
    const platform = platformProblem(item.manifest, this.deps.platform);
    if (platform !== null) throw new Error(platform);
    return resolveExtensionServer(
      {
        id: item.id,
        dir: item.dir,
        manifest: item.manifest,
        settings: item.settings,
        secret: (key) => this.deps.vault.get(extensionSecretId(item.id, key)),
        platform: this.deps.platform,
        homedir: this.deps.homedir,
        pathSeparator: this.deps.pathSeparator,
      },
      item.settings.onlyIn,
    );
  }

  private viewOf(item: Installed, commonNames: ReadonlySet<string>, exportedToAgy: boolean): McpExtensionView {
    const fields = buildUserConfigFields(item.manifest, item.settings, (key) => this.deps.vault.has(extensionSecretId(item.id, key)));
    const missingRequired = missingRequiredFields(fields);
    const providers = familiesInScope(item.settings.onlyIn).filter((family: McpProviderFamily) => family !== 'agy' || exportedToAgy);
    return {
      id: item.id,
      displayName: item.manifest.display_name ?? item.manifest.name,
      version: item.manifest.version,
      description: item.manifest.description,
      author: item.manifest.author?.name ?? '',
      platforms: item.manifest.compatibility?.platforms ?? [],
      serverType: item.manifest.server.type,
      enabled: item.settings.isEnabled,
      onlyIn: item.settings.onlyIn,
      fields,
      missingRequired,
      problem: this.problemOf(item, commonNames, missingRequired),
      providers,
      dir: item.dir,
    };
  }

  private problemOf(item: Installed, commonNames: ReadonlySet<string>, missingRequired: readonly string[]): string | null {
    const platform = platformProblem(item.manifest, this.deps.platform);
    if (platform !== null) return platform;
    if (missingRequired.length > 0) return 'Falta configurar: sin eso no arranca.';
    if (commonNames.has(item.id)) return `Un común se llama «${item.id}»: se carga el común, no esta extensión.`;
    let command: string;
    try {
      command = this.resolve(item).command;
    } catch (error) {
      return describeError(error);
    }
    const bare = bareCommand(command);
    if (bare !== null && !this.deps.isCommandAvailable(bare)) return `Necesita «${bare}» en el PATH: Claude Desktop trae el suyo, Mage no.`;
    return null;
  }

  private desktopCandidates(installedIds: ReadonlySet<string>, warnings: string[]): readonly McpDesktopExtensionCandidate[] {
    const candidates: McpDesktopExtensionCandidate[] = [];
    for (const desktopDir of this.deps.desktopDirs()) {
      const root = join(desktopDir, DESKTOP_EXTENSIONS_DIR);
      if (!this.deps.fs.exists(root)) continue;
      for (const dirName of this.deps.fs.listDir(root)) {
        const manifestPath = join(root, dirName, MCPB_MANIFEST);
        if (!this.deps.fs.exists(manifestPath)) continue;
        try {
          const manifest = parseMcpbManifest(this.deps.fs.readText(manifestPath));
          const displayName = manifest.display_name ?? manifest.name;
          candidates.push({ dirName, displayName, version: manifest.version, installed: installedIds.has(extensionIdOf(manifest)) });
        } catch (error) {
          warnings.push(`Extensión de Claude Desktop «${dirName}» ilegible: ${describeError(error)}`);
        }
      }
    }
    return candidates;
  }

  private readInstalled(warnings: string[]): readonly Installed[] {
    if (!this.deps.fs.exists(this.deps.root)) return [];
    const items: Installed[] = [];
    for (const id of this.deps.fs.listDir(this.deps.root)) {
      if (id.startsWith('.')) continue;
      try {
        const item = this.readOne(id);
        if (item !== null) items.push(item);
      } catch (error) {
        warnings.push(`Extensión «${id}» ilegible: ${describeError(error)}`);
      }
    }
    return items;
  }

  private readOne(id: string): Installed | null {
    const dir = join(this.deps.root, id);
    const manifestPath = join(dir, MCPB_MANIFEST);
    if (!this.deps.fs.exists(manifestPath)) return null;
    const manifest = parseMcpbManifest(this.deps.fs.readText(manifestPath));
    const settingsPath = this.settingsPath(id);
    const settings = this.deps.fs.exists(settingsPath) ? parseExtensionSettings(this.deps.fs.readText(settingsPath)) : DEFAULT_EXTENSION_SETTINGS;
    return { id, dir, manifest, settings };
  }

  private require(id: string): Installed {
    const item = this.readOne(id);
    if (item === null) throw new Error(`No hay ninguna extensión «${id}» instalada`);
    return item;
  }

  // Escribe en una carpeta temporal y solo al final sustituye la instalada: un fallo a medias no deja
  // una extension rota en su sitio. Los ajustes se conservan (actualizar no borra la configuracion).
  private replaceDir(id: string, fill: (staging: string) => void): void {
    const target = join(this.deps.root, id);
    const staging = join(this.deps.root, `.staging-${this.deps.newToken()}`);
    this.deps.fs.mkdir(staging);
    try {
      fill(staging);
      this.deps.fs.removeTree(target);
      this.deps.fs.rename(staging, target);
    } catch (error) {
      this.deps.fs.removeTree(staging);
      throw error;
    }
  }

  private writeSettings(id: string, settings: ExtensionSettings): void {
    this.deps.fs.mkdir(this.deps.settingsRoot);
    this.deps.fs.writeTextAtomic(this.settingsPath(id), `${JSON.stringify(settings, null, 2)}\n`);
  }

  private settingsPath(id: string): string {
    return join(this.deps.settingsRoot, `${id}.json`);
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
