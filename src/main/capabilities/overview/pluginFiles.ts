// installed_plugins.json MEDIDO con Claude Code 2.1.319: { version: 2, plugins: { "<nombre>@<marketplace>": [ { scope: 'user'|'project'|'local', projectPath?, installPath, version, installedAt, lastUpdated, gitCommitSha } ] } }.
// Si un plugin está activo lo dice settings.json → enabledPlugins (Mage lo hereda entre cuentas, accountService.ts:37-40).
// De settings.json SOLO se lee esa clave: el resto (env, permisos…) nunca sale de aquí.
import { z } from 'zod';
import type { CapabilityFileState, InstalledPluginView, PluginScope } from '@shared/capabilities';
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
