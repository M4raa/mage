import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import {
  keysOf,
  transportOf,
  type McpCommonView,
  type McpImportCandidate,
  type McpImportPick,
  type McpInventory,
  type McpInventoryRow,
  type McpOrigin,
  type McpOriginKind,
  type McpUnsharedAccount,
} from '@shared/mcp';

// Inventario de TODAS las fuentes de servidores MCP que conoce la maquina (P-028, punto 5) y la
// importacion bajo demanda a mcp-common.json (punto 34). Modulo PURO: el FS llega inyectado.
//
// Seguridad: de un `.claude.json` se lee SOLO `mcpServers` (raiz y `projects[*]`): `oauthAccount`,
// `userID` y demas no salen de aqui. Las declaraciones crudas (con los valores de `env`/`headers`) se
// quedan en main: lo que devuelve este modulo hacia el renderer (filas, candidatos) lleva nombres de
// clave, nunca valores, y los avisos nombran el fichero, nunca su contenido.

export interface McpInventoryDeps {
  readonly exists: (path: string) => boolean;
  readonly readFile: (path: string) => string;
  readonly listDir: (path: string) => readonly string[];
}

export interface McpAccountLocation {
  readonly configDir: string;
  readonly label: string; // «claude-p»
  readonly stateFile: string; // su .claude.json
}

export interface McpSourceLocations {
  readonly commonPath: string;
  readonly legacySharedPath: string | null; // null = no se lee (inventario); ruta = se lee (importacion)
  readonly accounts: readonly McpAccountLocation[];
  readonly projectDirs: readonly string[];
  readonly desktopDirs: readonly string[];
  readonly homedir: string;
  readonly pathSeparator: string;
}

// Una declaracion concreta en una fuente concreta. `config` es CRUDO: no sale de main.
export interface McpSourceEntry {
  readonly name: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly origin: McpOrigin;
  readonly disabled: boolean;
  readonly blockedReason: string | null;
}

export interface McpSourceRead {
  readonly entries: readonly McpSourceEntry[];
  readonly warnings: readonly string[];
}

// Clave propia de Mage en mcp-common.json para los comunes DESACTIVADOS: fuera de `mcpServers`, asi que
// el CLI no los carga, pero siguen en el fichero. MEDIDO en 2.1.284 (`spike/init-spike.mjs --mcp`): el
// `--mcp-config` acepta una clave de nivel superior desconocida y carga el resto sin quejarse.
export const DISABLED_SERVERS_KEY = 'mageDisabledServers';

const UTF8_BOM = /^﻿/;
const DESKTOP_CONFIG_FILE = 'claude_desktop_config.json';
const PROJECT_MCP_FILE = '.mcp.json';
const EXTENSIONS_DIR = 'Claude Extensions';
const EXTENSIONS_SETTINGS_DIR = 'Claude Extensions Settings';
const EXTENSION_MANIFEST = 'manifest.json';
const DESKTOP_EXTENSION_NOTE = 'Depende de que Claude Desktop siga instalado.';
const USER_CONFIG_PLACEHOLDER = '${user_config.';
const PLACEHOLDER_PATTERN = /\$\{[^}]*\}/;

// --- Rutas de Claude Desktop por SO -------------------------------------------------------------

export interface DesktopDirContext {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homedir: string;
  readonly exists: (path: string) => boolean;
  readonly listDir: (path: string) => readonly string[];
}

// Carpetas de datos de Claude Desktop que EXISTEN. En Windows hay dos instalaciones posibles: la clasica
// (`%APPDATA%\Claude`) y la MSIX, cuyo nombre de paquete lleva un sufijo de editor (`Claude_<hash>`), de
// ahi el recorrido de `Packages`. Medido en esta maquina: solo existe la MSIX.
export function resolveClaudeDesktopDirs(ctx: DesktopDirContext): readonly string[] {
  return desktopDirCandidates(ctx).filter((dir) => ctx.exists(dir));
}

function desktopDirCandidates(ctx: DesktopDirContext): readonly string[] {
  if (ctx.platform === 'darwin') return [join(ctx.homedir, 'Library', 'Application Support', 'Claude')];
  if (ctx.platform !== 'win32') return [join(ctx.env.XDG_CONFIG_HOME ?? join(ctx.homedir, '.config'), 'Claude')];
  const dirs: string[] = [];
  if (ctx.env.APPDATA !== undefined) dirs.push(join(ctx.env.APPDATA, 'Claude'));
  if (ctx.env.LOCALAPPDATA === undefined) return dirs;
  const packages = join(ctx.env.LOCALAPPDATA, 'Packages');
  if (!ctx.exists(packages)) return dirs;
  for (const entry of ctx.listDir(packages)) {
    if (entry.startsWith('Claude_')) dirs.push(join(packages, entry, 'LocalCache', 'Roaming', 'Claude'));
  }
  return dirs;
}

// --- Lectura de fuentes -------------------------------------------------------------------------

// Lee todas las fuentes. El comun va PRIMERO (manda en las filas y en «gana lo que existe»), luego las
// cuentas en su orden (la principal delante), los proyectos, el legado y Claude Desktop.
export function readMcpSources(deps: McpInventoryDeps, locations: McpSourceLocations): McpSourceRead {
  const reader = new SourceReader(deps);
  reader.readCommon(locations.commonPath);
  for (const account of locations.accounts) reader.readAccount(account);
  for (const dir of locations.projectDirs) reader.readProjectFile(dir);
  if (locations.legacySharedPath !== null) reader.readLegacy(locations.legacySharedPath);
  for (const dir of locations.desktopDirs) {
    reader.readDesktopConfig(dir);
    reader.readDesktopExtensions(dir, locations);
  }
  return { entries: reader.entries, warnings: reader.warnings };
}

class SourceReader {
  readonly entries: McpSourceEntry[] = [];
  readonly warnings: string[] = [];

  constructor(private readonly deps: McpInventoryDeps) {}

  readCommon(path: string): void {
    const root = this.readJson(path, 'mcp-common.json');
    if (root === null) return;
    const origin = (name: string): McpOrigin => makeOrigin('common', name, { label: 'Mage', path });
    this.addServers(root.mcpServers, origin, false);
    this.addServers(root[DISABLED_SERVERS_KEY], origin, true);
  }

  readAccount(account: McpAccountLocation): void {
    const root = this.readJson(account.stateFile, `.claude.json de ${account.label}`);
    if (root === null) return;
    const base = { path: account.stateFile, accountDir: account.configDir };
    this.addServers(root.mcpServers, (name) => makeOrigin('account', name, { ...base, label: `Cuenta ${account.label}` }), false);
    if (!isRecord(root.projects)) return;
    for (const [projectDir, project] of Object.entries(root.projects)) {
      if (!isRecord(project)) continue;
      const label = `Local de ${projectName(projectDir)}`;
      this.addServers(project.mcpServers, (name) => makeOrigin('projectLocal', name, { ...base, label, projectDir }), false);
    }
  }

  readProjectFile(dir: string): void {
    const path = join(dir, PROJECT_MCP_FILE);
    const root = this.readJson(path, path);
    if (root === null) return;
    const label = `Proyecto ${projectName(dir)}`;
    this.addServers(root.mcpServers, (name) => makeOrigin('project', name, { label, path, projectDir: dir }), false);
  }

  readLegacy(path: string): void {
    const root = this.readJson(path, basename(path));
    if (root === null) return;
    this.addServers(root.mcpServers, (name) => makeOrigin('legacy', name, { label: basename(path), path }), false);
  }

  readDesktopConfig(dir: string): void {
    const path = join(dir, DESKTOP_CONFIG_FILE);
    const root = this.readJson(path, DESKTOP_CONFIG_FILE);
    if (root === null) return;
    this.addServers(root.mcpServers, (name) => makeOrigin('desktop', name, { label: 'Claude Desktop', path }), false);
  }

  readDesktopExtensions(dir: string, locations: McpSourceLocations): void {
    const extensionsDir = join(dir, EXTENSIONS_DIR);
    if (!this.deps.exists(extensionsDir)) return;
    for (const id of this.deps.listDir(extensionsDir)) {
      const extensionDir = join(extensionsDir, id);
      const manifestPath = join(extensionDir, EXTENSION_MANIFEST);
      const manifest = this.readJson(manifestPath, `la extension ${id}`);
      if (manifest === null || !isRecord(manifest.server) || !isRecord(manifest.server.mcp_config)) continue;
      const name = typeof manifest.name === 'string' && manifest.name.length > 0 ? manifest.name : id;
      const resolved = resolveExtensionConfig(manifest.server.mcp_config, extensionDir, locations);
      const origin = makeOrigin('desktopExtension', name, { label: 'Extensión de Claude Desktop', path: manifestPath });
      this.entries.push({ name, config: resolved.config, origin, disabled: !this.isExtensionEnabled(dir, id), blockedReason: resolved.blockedReason });
    }
  }

  // `Claude Extensions Settings/<id>.json` trae `isEnabled` (medido; es su unica clave aqui). Ausente o
  // ilegible -> se da por activa: es solo una etiqueta, no decide nada.
  private isExtensionEnabled(dir: string, id: string): boolean {
    const path = join(dir, EXTENSIONS_SETTINGS_DIR, `${id}.json`);
    const settings = this.readJson(path, `los ajustes de la extension ${id}`);
    return settings === null || settings.isEnabled !== false;
  }

  private addServers(raw: unknown, originFor: (name: string) => McpOrigin, disabled: boolean): void {
    if (!isRecord(raw)) return;
    for (const [name, config] of Object.entries(raw)) {
      if (!isRecord(config)) continue;
      this.entries.push({ name, config, origin: originFor(name), disabled, blockedReason: null });
    }
  }

  // Ausente -> null sin aviso (es lo normal). Ilegible o JSON invalido -> null CON aviso que nombra el
  // fichero y su tamaño, nunca el contenido (lleva los `env`).
  private readJson(path: string, label: string): Record<string, unknown> | null {
    if (!this.deps.exists(path)) return null;
    let text: string;
    try {
      text = this.deps.readFile(path);
    } catch (error) {
      this.warnings.push(`No se pudo leer ${label} (${path}): ${describeError(error)}`);
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(text.replace(UTF8_BOM, ''));
      if (isRecord(parsed)) return parsed;
      this.warnings.push(`${label} (${path}) no es un objeto JSON; se ignora.`);
    } catch {
      this.warnings.push(`${label} (${path}) no es JSON válido (${text.length} caracteres); se ignora.`);
    }
    return null;
  }
}

function makeOrigin(
  kind: McpOriginKind,
  name: string,
  fields: { readonly label: string; readonly path: string; readonly accountDir?: string; readonly projectDir?: string },
): McpOrigin {
  return {
    kind,
    label: fields.label,
    path: fields.path,
    accountDir: fields.accountDir ?? null,
    projectDir: fields.projectDir ?? null,
    importId: `${kind}|${fields.path}|${fields.projectDir ?? ''}|${name}`,
  };
}

function projectName(dir: string): string {
  const name = basename(dir.replace(/[\\/]+$/, ''));
  return name.length > 0 ? name : dir;
}

// Sustituye las variables de una MCPB que Mage sabe resolver (`${__dirname}` -> carpeta de la
// extension, `${/}`/`${pathSeparator}` y `${HOME}`, medidas en la extension real). Si queda alguna —
// sobre todo `${user_config.*}`, que vive en Claude Desktop— no se puede copiar tal cual.
function resolveExtensionConfig(
  raw: Record<string, unknown>,
  extensionDir: string,
  locations: McpSourceLocations,
): { readonly config: Record<string, unknown>; readonly blockedReason: string | null } {
  const replacements: Readonly<Record<string, string>> = {
    '${__dirname}': extensionDir,
    '${/}': locations.pathSeparator,
    '${pathSeparator}': locations.pathSeparator,
    '${HOME}': locations.homedir,
  };
  const text = JSON.stringify(raw).replace(/\$\{[^}]*\}/g, (token) => JSON.stringify(replacements[token] ?? token).slice(1, -1));
  const config = JSON.parse(text) as Record<string, unknown>;
  if (text.includes(USER_CONFIG_PLACEHOLDER)) {
    return { config, blockedReason: 'Necesita datos que se configuran en Claude Desktop (user_config).' };
  }
  const leftover = PLACEHOLDER_PATTERN.exec(text);
  if (leftover !== null) return { config, blockedReason: `Usa ${leftover[0]}, que solo resuelve Claude Desktop.` };
  return { config, blockedReason: null };
}

// --- Filas del inventario (sin valores) ---------------------------------------------------------

// Una fila por NOMBRE, con todas las fuentes que lo declaran. Transporte y claves salen de la primera
// fuente (el comun si lo hay: es el que gana en una sesion de Mage). Legado no entra: ninguna sesion lo
// carga.
export function buildInventoryRows(entries: readonly McpSourceEntry[], accountDirs: readonly string[]): readonly McpInventoryRow[] {
  const byName = new Map<string, McpSourceEntry[]>();
  for (const entry of entries) {
    if (entry.origin.kind === 'legacy') continue;
    const list = byName.get(entry.name) ?? [];
    list.push(entry);
    byName.set(entry.name, list);
  }
  return [...byName.entries()].map(([name, list]) => buildRow(name, list, accountDirs));
}

function buildRow(name: string, list: readonly McpSourceEntry[], accountDirs: readonly string[]): McpInventoryRow {
  const first = list[0]!;
  const common = list.find((entry) => entry.origin.kind === 'common') ?? null;
  const accounts = new Set<string>();
  for (const entry of list) {
    if (common !== null && common.disabled && entry === common) continue;
    for (const dir of accountsThatLoad(entry, accountDirs)) accounts.add(dir);
  }
  return {
    name,
    transport: transportOf(first.config),
    origins: list.map((entry) => entry.origin),
    accounts: accountDirs.filter((dir) => accounts.has(dir)),
    envKeys: keysOf(first.config.env),
    headerKeys: keysOf(first.config.headers),
    disabled: common?.disabled ?? false,
    common: common === null ? null : commonViewOf(common.config),
    blockedReason: first.blockedReason,
  };
}

// Que cuentas cargan una declaracion: los comunes y los `.mcp.json`, todas; lo de una cuenta, esa;
// Claude Desktop y el legado, ninguna (no son de Claude Code).
function accountsThatLoad(entry: McpSourceEntry, accountDirs: readonly string[]): readonly string[] {
  const { kind, accountDir } = entry.origin;
  if (kind === 'common' || kind === 'project') return accountDirs;
  if ((kind === 'account' || kind === 'projectLocal') && accountDir !== null) return [accountDir];
  return [];
}

function commonViewOf(config: Readonly<Record<string, unknown>>): McpCommonView {
  return {
    transport: transportOf(config),
    command: typeof config.command === 'string' ? config.command : '',
    args: Array.isArray(config.args) ? config.args.map((arg) => String(arg)) : [],
    url: typeof config.url === 'string' ? config.url : '',
  };
}

// Aviso del punto 34: MCP de ambito usuario de una cuenta que no estan en los comunes.
export function findUnsharedAccountServers(entries: readonly McpSourceEntry[]): readonly McpUnsharedAccount[] {
  const common = new Set(entries.filter((e) => e.origin.kind === 'common').map((e) => e.name));
  const byAccount = new Map<string, string[]>();
  for (const entry of entries) {
    const dir = entry.origin.accountDir;
    if (entry.origin.kind !== 'account' || dir === null || common.has(entry.name)) continue;
    byAccount.set(dir, [...(byAccount.get(dir) ?? []), entry.name]);
  }
  return [...byAccount.entries()].map(([accountDir, names]) => ({ accountDir, names }));
}

export function buildInventory(read: McpSourceRead, accountDirs: readonly string[], commonVersion: string | null): McpInventory {
  return {
    rows: buildInventoryRows(read.entries, accountDirs),
    unshared: findUnsharedAccountServers(read.entries),
    commonVersion,
    warnings: read.warnings,
  };
}

// Huella de los bytes de mcp-common.json: el renderer no puede tener los bytes (llevan los `env`), asi
// que el compare-and-swap viaja con esto. null = el fichero no existe.
export function mcpCommonVersion(baseline: string | null): string | null {
  return baseline === null ? null : createHash('sha256').update(baseline).digest('hex');
}

// --- Importacion (punto 34) ---------------------------------------------------------------------

// Candidatos a importar: todo lo que no es comun. Estado contra los comunes actuales (activos o no).
// Por defecto se marcan solo los nuevos que se pueden importar y que no son de ambito local de un
// proyecto (esos cambian de significado al hacerse comunes: los veria cualquier carpeta).
export function buildImportCandidates(entries: readonly McpSourceEntry[]): readonly McpImportCandidate[] {
  const common = new Map(entries.filter((e) => e.origin.kind === 'common').map((e) => [e.name, e.config]));
  return entries
    .filter((entry) => entry.origin.kind !== 'common')
    .map((entry) => {
      const existing = common.get(entry.name);
      const status = existing === undefined ? 'new' : stableStringify(existing) === stableStringify(entry.config) ? 'same' : 'different';
      return {
        id: entry.origin.importId,
        name: entry.name,
        group: isDesktopOrigin(entry.origin.kind) ? 'desktop' : 'cli',
        originLabel: entry.origin.label,
        transport: transportOf(entry.config),
        status,
        checkedByDefault: status === 'new' && entry.blockedReason === null && entry.origin.kind !== 'projectLocal',
        blockedReason: entry.blockedReason,
        note: candidateNote(entry),
      };
    });
}

function candidateNote(entry: McpSourceEntry): string | null {
  if (entry.origin.kind === 'projectLocal') return `Era de proyecto ${entry.origin.projectDir ?? ''}`;
  if (entry.origin.kind === 'desktopExtension') return DESKTOP_EXTENSION_NOTE;
  return null;
}

function isDesktopOrigin(kind: McpOriginKind): boolean {
  return kind === 'desktop' || kind === 'desktopExtension';
}

export interface McpImportApplied {
  readonly text: string;
  readonly notes: readonly string[];
}

// Aplica lo elegido sobre el texto ACTUAL de mcp-common.json. Gana lo que existe salvo que la fila pida
// sustituir; un desactivado sustituido sigue desactivado. Dos elegidos con el mismo nombre: el primero
// (y una nota). El resto del fichero se conserva. Lanza con un id que ya no existe o una MCPB bloqueada:
// la vista previa esta desfasada y no se escribe nada a medias.
export function applyImportPicks(commonText: string, entries: readonly McpSourceEntry[], picks: readonly McpImportPick[]): McpImportApplied {
  const root = parseCommonRoot(commonText);
  const active = { ...recordOrEmpty(root.mcpServers) };
  const disabled = { ...recordOrEmpty(root[DISABLED_SERVERS_KEY]) };
  const byId = new Map(entries.map((entry) => [entry.origin.importId, entry]));
  const taken = new Set<string>();
  const notes: string[] = [];
  for (const pick of picks) {
    const entry = byId.get(pick.id);
    if (entry === undefined) throw new Error(`El servidor a importar ya no está en su origen: ${pick.id}`);
    if (entry.blockedReason !== null) throw new Error(`«${entry.name}» no se puede importar: ${entry.blockedReason}`);
    if (taken.has(entry.name)) {
      notes.push(`«${entry.name}» venía de dos sitios: se queda el primero elegido.`);
      continue;
    }
    taken.add(entry.name);
    const target = entry.name in disabled ? disabled : active;
    if (entry.name in target && !pick.replace) continue;
    target[entry.name] = entry.config;
  }
  const next: Record<string, unknown> = { ...root, mcpServers: active };
  if (Object.keys(disabled).length > 0) next[DISABLED_SERVERS_KEY] = disabled;
  else delete next[DISABLED_SERVERS_KEY];
  return { text: `${JSON.stringify(next, null, 2)}\n`, notes };
}

// Raiz de mcp-common.json para escribir sobre ella. Un texto que no se entiende LANZA: escribir sobre
// una base ilegible es como se pierde configuracion ajena. El mensaje lleva el tamaño, nunca el texto.
export function parseCommonRoot(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(UTF8_BOM, ''));
  } catch (error) {
    throw new Error(`mcp-common.json no es JSON válido (${describeError(error)}): ${text.length} caracteres`);
  }
  if (!isRecord(parsed)) throw new Error(`mcp-common.json no es un objeto JSON: ${text.length} caracteres`);
  return parsed;
}

// JSON con las claves ordenadas: dos declaraciones iguales escritas en otro orden son «iguales».
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
