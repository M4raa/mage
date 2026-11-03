// La vista previa dice qué ficheros, comandos y componentes se incorporarían, y por construcción no puede tener
// efectos: no recibe sistema de ficheros ni ejecutor, solo datos.
import { isAbsolute, join } from 'node:path';
import type { CapabilityEngine } from '../capabilityPackage';
import { claudeSkillRoot, installRouteFor, type InstallRoute } from '../installRoute';
import { configDirEnvVar, nativeInstallCommands, withPlatformLauncher, type NativeCommand } from '../nativeCommands';
import type { LibraryCatalogEntry, LibraryComponent } from './libraryCatalog';

export const INSTALL_BLOCKS = [
  'engineNotDeclared',
  'platformUnsupported',
  'needsSecrets',
  'kindNotInstallable',
  'codexSkillsUnmeasured',
] as const;
export type InstallBlock = (typeof INSTALL_BLOCKS)[number];

const SAFE_DISPLAY_ARG = /^[A-Za-z0-9@%+=:,./#_-]+$/;

export interface PreviewRequest {
  readonly entry: LibraryCatalogEntry;
  readonly engine: CapabilityEngine;
  readonly accountDir: string; // CLAUDE_CONFIG_DIR o CODEX_HOME de la cuenta elegida
  readonly platform: NodeJS.Platform;
}

export interface PreviewFile {
  readonly absPath: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface InstallPreview {
  readonly packageId: string;
  readonly version: string;
  readonly engine: CapabilityEngine;
  readonly accountDir: string;
  readonly block: InstallBlock | null;
  readonly route: InstallRoute | null; // null si está bloqueado
  readonly files: readonly PreviewFile[];
  readonly commands: readonly string[]; // tal como se verían en una terminal, con el nombre corto del CLI
  readonly envVar: 'CLAUDE_CONFIG_DIR' | 'CODEX_HOME';
  readonly components: readonly LibraryComponent[]; // solo los de este motor o 'both'
  readonly runsCode: boolean;
  readonly requiresCommands: readonly string[];
  readonly requiresSecrets: readonly string[];
}

// El primer bloqueo que se cumpla, en este orden.
export function installBlockFor(
  entry: LibraryCatalogEntry,
  engine: CapabilityEngine,
  platform: NodeJS.Platform,
): InstallBlock | null {
  const { package: pkg } = entry;
  if (!pkg.engines.includes(engine)) return 'engineNotDeclared';
  if (!(entry.platforms as readonly string[]).includes(platform)) return 'platformUnsupported';
  if ((pkg.requires.secrets ?? []).length > 0) return 'needsSecrets';
  if (pkg.kind === 'agent' || pkg.kind === 'hook') return 'kindNotInstallable';
  if (pkg.kind === 'skill' && engine === 'codex') return 'codexSkillsUnmeasured';
  return null;
}

function quoteForDisplay(arg: string): string {
  return SAFE_DISPLAY_ARG.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`;
}

// Solo es para mostrar: nunca se ejecuta.
export function formatCommand(command: NativeCommand): string {
  return [command.engine, ...command.args].map(quoteForDisplay).join(' ');
}

function previewFiles(request: PreviewRequest, contents: ReadonlyMap<string, Buffer> | null): PreviewFile[] {
  const { entry, accountDir } = request;
  if (contents === null) throw new Error(`Vista previa de ${entry.id}: faltan los contenidos que se copiarían`);
  const root = claudeSkillRoot(accountDir, entry.package.id);
  return entry.package.files.map(({ relPath, sha256 }) => {
    const data = contents.get(relPath);
    if (data === undefined) throw new Error(`Vista previa de ${entry.id}: falta el contenido de ${relPath}`);
    return { absPath: join(root, relPath), bytes: data.length, sha256 };
  });
}

function previewCommands(request: PreviewRequest): string[] {
  const { entry, engine, platform } = request;
  const { native } = entry.package;
  if (native === undefined) throw new Error(`Vista previa de ${entry.id}: el paquete no declara native`);
  return nativeInstallCommands(engine, withPlatformLauncher(native, platform)).map(formatCommand);
}

export function previewInstall(request: PreviewRequest, contents: ReadonlyMap<string, Buffer> | null): InstallPreview {
  const { entry, engine, accountDir, platform } = request;
  if (accountDir === '' || !isAbsolute(accountDir)) {
    throw new Error(`Vista previa sin config dir absoluto de la cuenta: ${JSON.stringify(accountDir)}`);
  }
  const block = installBlockFor(entry, engine, platform);
  const route = block === null ? installRouteFor(entry.package, engine) : null;
  return {
    packageId: entry.package.id,
    version: entry.package.version,
    engine,
    accountDir,
    block,
    route,
    files: route === 'ownedFiles' ? previewFiles(request, contents) : [],
    commands: route === 'native' ? previewCommands(request) : [],
    envVar: configDirEnvVar(engine),
    components: entry.components.filter((c) => c.engine === engine || c.engine === 'both'),
    runsCode: entry.runsCode,
    requiresCommands: entry.package.requires.commands ?? [],
    requiresSecrets: entry.package.requires.secrets ?? [],
  };
}
