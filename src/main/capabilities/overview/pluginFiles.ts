// installed_plugins.json MEDIDO con Claude Code 2.1.319: { version: 2, plugins: { "<nombre>@<marketplace>": [ { scope: 'user'|'project'|'local', projectPath?, installPath, version, installedAt, lastUpdated, gitCommitSha } ] } }. Medido de punta a punta en `spike/plugin-cli-spike.mjs`.
// Si un plugin está activo lo dice settings.json → enabledPlugins (Mage lo hereda entre cuentas, accountService.ts:37-40).
// De settings.json SOLO se lee esa clave: el resto (env, permisos…) nunca sale de aquí.
import { z } from 'zod';
import { isAbsolute } from 'node:path';
import type {
  CapabilityFileState,
  DiscoverPluginView,
  InstalledPluginView,
  MarketplaceView,
  PluginCatalogView,
  PluginScope,
} from '@shared/capabilities';
import { parseJsonObject } from './policyFiles';

const PLUGIN_SCOPES: ReadonlySet<string> = new Set<PluginScope>(['user', 'project', 'local']);
const INSTALL = z.object({ scope: z.string().catch(''), version: z.string().nullable().optional().catch(null) }).passthrough();
const INSTALLED = z.object({ plugins: z.record(z.string(), z.array(INSTALL).catch([])).catch({}) }).passthrough();
const SETTINGS = z.object({ enabledPlugins: z.record(z.string(), z.boolean()).catch({}) }).passthrough();

type Install = z.infer<typeof INSTALL>;

// settings.json ilegible o ausente: ninguno activo, que es como lo carga el CLI.
export function parseEnabledPlugins(settingsText: string | null): ReadonlySet<string> {
  const parsed = parseJsonObject(settingsText);
  if (parsed.state !== 'ok') return new Set();
  const { enabledPlugins } = SETTINGS.parse(parsed.value);
  return new Set(Object.entries(enabledPlugins).filter(([, on]) => on).map(([id]) => id));
}

// Parte «nombre@marketplace» por el ÚLTIMO «@»; sin «@» (o en la posición 0) no hay marketplace.
export function splitPluginId(id: string): { readonly name: string; readonly marketplace: string } {
  const at = id.lastIndexOf('@');
  if (at <= 0) return { name: id, marketplace: '' };
  return { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

function pluginView(id: string, installs: readonly Install[], enabled: boolean): InstalledPluginView {
  const scopes = [...new Set(installs.map((install) => install.scope))].filter((scope): scope is PluginScope => PLUGIN_SCOPES.has(scope));
  const chosen = installs.find((install) => install.scope === 'user') ?? installs[0];
  return { id, ...splitPluginId(id), scopes, version: chosen?.version ?? null, enabled };
}

// installed_plugins.json + settings.json → plugins instalados, ordenados por id.
export function parseInstalledPlugins(
  installedText: string | null,
  settingsText: string | null,
): { readonly state: CapabilityFileState; readonly plugins: readonly InstalledPluginView[] } {
  const parsed = parseJsonObject(installedText);
  if (parsed.state !== 'ok') return { state: parsed.state, plugins: [] };
  const enabledIds = parseEnabledPlugins(settingsText);
  const plugins = Object.entries(INSTALLED.parse(parsed.value).plugins)
    .map(([id, installs]) => pluginView(id, installs, enabledIds.has(id)))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'));
  return { state: 'ok', plugins };
}

const INSTALL_PATHS = z
  .object({ plugins: z.record(z.string(), z.array(z.object({ installPath: z.string().min(1).optional().catch(undefined) }).passthrough()).catch([])).catch({}) })
  .passthrough();

// installPath de cada instalación de un plugin (por nombre, sin marketplace), en el orden del fichero. Solo rutas absolutas.
export function pluginInstallPaths(installedText: string | null, pluginName: string): readonly string[] {
  const parsed = parseJsonObject(installedText);
  if (parsed.state !== 'ok') return [];
  return Object.entries(INSTALL_PATHS.parse(parsed.value).plugins)
    .filter(([id]) => splitPluginId(id).name === pluginName)
    .flatMap(([, installs]) => installs.map((install) => install.installPath))
    .filter((path): path is string => path !== undefined && isAbsolute(path));
}

// known_marketplaces.json MEDIDO con Claude Code 2.1.319: { "<nombre>": { source: { source: 'github'|'git'|'directory', repo?|url?|path? }, installLocation: <ruta absoluta>, lastUpdated, autoUpdate? } }.
const KNOWN = z
  .object({
    source: z.object({ source: z.string() }).passthrough().catch({ source: 'unknown' }),
    installLocation: z.string().optional().catch(undefined),
  })
  .passthrough();

export interface KnownMarketplace { readonly name: string; readonly sourceKind: string; readonly installLocation: string | null }

export function parseKnownMarketplaces(text: string | null): readonly KnownMarketplace[] {
  const parsed = parseJsonObject(text);
  if (parsed.state !== 'ok') return [];
  const known: KnownMarketplace[] = [];
  for (const [name, raw] of Object.entries(parsed.value)) {
    const entry = KNOWN.safeParse(raw);
    if (!entry.success) continue;
    const location = entry.data.installLocation;
    known.push({
      name,
      sourceKind: entry.data.source.source,
      installLocation: location !== undefined && isAbsolute(location) ? location : null,
    });
  }
  return known.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

// <installLocation>/.claude-plugin/marketplace.json MEDIDO: { name, owner, description?, plugins: [{ name, description, category?, author?: { name }, homepage?, source, version? }] }.
const MANIFEST_PLUGIN = z
  .object({
    name: z.string().min(1),
    description: z.string().catch(''),
    category: z.string().optional().catch(undefined),
    author: z.object({ name: z.string() }).passthrough().optional().catch(undefined),
    homepage: z.string().optional().catch(undefined),
  })
  .passthrough();

export interface MarketplacePluginEntry {
  readonly name: string;
  readonly description: string;
  readonly category: string | null;
  readonly author: string | null;
  readonly homepage: string | null;
}
export interface MarketplaceManifest { readonly state: CapabilityFileState; readonly entries: readonly MarketplacePluginEntry[] }

const HTTPS_PREFIX = 'https://';

export function parseMarketplaceManifest(text: string | null): MarketplaceManifest {
  const parsed = parseJsonObject(text);
  if (parsed.state !== 'ok') return { state: parsed.state, entries: [] };
  const entries: MarketplacePluginEntry[] = [];
  for (const raw of z.array(z.unknown()).catch([]).parse(parsed.value.plugins)) {
    const plugin = MANIFEST_PLUGIN.safeParse(raw);
    if (!plugin.success) continue;
    const { name, description, category, author, homepage } = plugin.data;
    entries.push({
      name,
      description,
      category: category ?? null,
      author: author?.name ?? null,
      homepage: homepage !== undefined && homepage.startsWith(HTTPS_PREFIX) ? homepage : null,
    });
  }
  return { state: 'ok', entries };
}

// plugin-catalog-cache.json MEDIDO (538 KB, solo claude-plugins-official): { version: 1, fetchedAt, catalog: { plugins: { "<nombre>@<marketplace>": { unique_installs: number, components: { skills: [{ name, chars }], commands, agents, hooks, mcpServers, lspServers }, … } } } }.
const STATS = z
  .object({
    unique_installs: z.number().int().nonnegative().optional().catch(undefined),
    components: z.object({ skills: z.array(z.unknown()).optional().catch(undefined) }).passthrough().optional().catch(undefined),
  })
  .passthrough();

export interface PluginStats { readonly installs: number | null; readonly skills: number | null }

export function parseCatalogStats(text: string | null): ReadonlyMap<string, PluginStats> {
  const parsed = parseJsonObject(text);
  if (parsed.state !== 'ok') return new Map();
  const { plugins } = z
    .object({ plugins: z.record(z.string(), z.unknown()).catch({}) })
    .passthrough()
    .catch({ plugins: {} })
    .parse(parsed.value.catalog);
  const stats = new Map<string, PluginStats>();
  for (const [id, raw] of Object.entries(plugins)) {
    const entry = STATS.safeParse(raw);
    if (!entry.success) continue;
    stats.set(id, { installs: entry.data.unique_installs ?? null, skills: entry.data.components?.skills?.length ?? null });
  }
  return stats;
}

export interface PluginCatalogInput {
  readonly marketplaces: readonly KnownMarketplace[];
  readonly manifests: ReadonlyMap<string, MarketplaceManifest>;
  readonly stats: ReadonlyMap<string, PluginStats>;
  readonly installedIds: ReadonlySet<string>;
}

const NO_MANIFEST: MarketplaceManifest = { state: 'absent', entries: [] };

function discoverView(marketplace: string, entry: MarketplacePluginEntry, input: PluginCatalogInput): DiscoverPluginView {
  const id = `${entry.name}@${marketplace}`;
  const stats = input.stats.get(id);
  return {
    id,
    name: entry.name,
    marketplace,
    description: entry.description,
    category: entry.category,
    author: entry.author,
    homepage: entry.homepage,
    installs: stats?.installs ?? null,
    skills: stats?.skills ?? null,
    installed: input.installedIds.has(id),
  };
}

// Marketplaces conocidos + su manifiesto + estadísticas del CLI → lo que enseña «Descubrir».
export function buildPluginCatalog(input: PluginCatalogInput): PluginCatalogView {
  const marketplaces: MarketplaceView[] = [];
  const plugins: DiscoverPluginView[] = [];
  for (const market of input.marketplaces) {
    const manifest = input.manifests.get(market.name) ?? NO_MANIFEST;
    marketplaces.push({ name: market.name, sourceKind: market.sourceKind, state: manifest.state, count: manifest.entries.length });
    for (const entry of manifest.entries) plugins.push(discoverView(market.name, entry, input));
  }
  return { marketplaces, plugins };
}
