// Origen de cada skill de una cuenta de Claude, medido con Claude Code 2.1.319 en
// command-catalog.json, 6 cuentas. La señal más fiable es el sufijo que el CLI pone a la DESCRIPCIÓN. Regla, en orden:
//  - un nombre que acaba en « (MCP)» es un prompt de un servidor MCP, no una skill: fuera;
//  - «(claude.ai sync)» → organización (ANTES que el prefijo: solo 3 de 26 llevan `anthropic-skills:`);
//  - «(project)» → proyecto; «(user)» → instalada por el usuario;
//  - nombre con «:» → plugin (el texto antes del primer «:»; su marketplace sale de installed_plugins.json);
//  - lo demás son comandos de Claude Code: fuera.
// Límite conocido: «(user)» también lo llevan los comandos personales de `<config>/commands/*.md`, y «(project)» es del
// proyecto de la última sesión de la cuenta.
import type { SlashCommandInfo } from '@shared/events';
import type { InstalledPluginView, SkillOrigin } from '@shared/capabilities';

export type SkillOriginKind = SkillOrigin;
export interface SkillEntry {
  readonly name: string;
  readonly description: string;
  readonly origin: SkillOriginKind;
  readonly plugin: string | null;
  readonly marketplace: string | null;
}
export const SKILL_FILTERS = ['all', 'user', 'project', 'plugin', 'organization'] as const;
export type SkillFilter = (typeof SKILL_FILTERS)[number];
export const SKILL_SORTS = ['name', 'origin'] as const;
export type SkillSort = (typeof SKILL_SORTS)[number];

const ORIGIN_SUFFIX = /\s*\((user|project|claude\.ai sync)\)\s*$/;
const SUFFIX_ORIGIN: ReadonlyMap<string, SkillOriginKind> = new Map([
  ['user', 'user'],
  ['project', 'project'],
  ['claude.ai sync', 'organization'],
]);
const MCP_PROMPT_SUFFIX = ' (MCP)';
const ORIGIN_RANK: Readonly<Record<SkillOriginKind, number>> = { user: 0, project: 1, plugin: 2, organization: 3 };

// Un comando del catálogo → su skill con origen, o null si no es una skill.
export function classifySkill(command: SlashCommandInfo, marketplaceOf: ReadonlyMap<string, string>): SkillEntry | null {
  const { name, description } = command;
  if (name.endsWith(MCP_PROMPT_SUFFIX)) return null;
  const match = ORIGIN_SUFFIX.exec(description);
  if (match !== null) {
    const origin = SUFFIX_ORIGIN.get(match[1] ?? '');
    const clean = description.slice(0, match.index);
    if (origin !== undefined) return { name, description: clean, origin, plugin: null, marketplace: null };
  }
  const colon = name.indexOf(':');
  if (colon <= 0) return null;
  const plugin = name.slice(0, colon);
  return { name, description, origin: 'plugin', plugin, marketplace: marketplaceOf.get(plugin) ?? null };
}

// Las skills de una cuenta: sin repetir nombre (se queda la primera).
export function classifySkills(commands: readonly SlashCommandInfo[], plugins: readonly InstalledPluginView[]): readonly SkillEntry[] {
  const marketplaceOf = new Map<string, string>();
  for (const plugin of plugins) if (!marketplaceOf.has(plugin.name)) marketplaceOf.set(plugin.name, plugin.marketplace);
  const byName = new Map<string, SkillEntry>();
  for (const command of commands) {
    const entry = classifySkill(command, marketplaceOf);
    if (entry !== null && !byName.has(entry.name)) byName.set(entry.name, entry);
  }
  return [...byName.values()];
}

// Por origen y por texto (sin mayúsculas, en nombre, descripción y plugin). Sin filtro ni texto, la MISMA lista.
export function filterSkills(entries: readonly SkillEntry[], query: string, filter: SkillFilter): readonly SkillEntry[] {
  const text = query.trim().toLowerCase();
  if (filter === 'all' && text === '') return entries;
  return entries.filter((entry) => {
    if (filter !== 'all' && entry.origin !== filter) return false;
    return text === '' || [entry.name, entry.description, entry.plugin ?? ''].some((field) => field.toLowerCase().includes(text));
  });
}

const byName = (a: SkillEntry, b: SkillEntry): number => a.name.localeCompare(b.name, 'en');

export function sortSkills(entries: readonly SkillEntry[], sort: SkillSort): readonly SkillEntry[] {
  const copy = [...entries];
  if (sort === 'name') return copy.sort(byName);
  return copy.sort((a, b) => ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin] || byName(a, b));
}

export function parseSkillFilter(value: string): SkillFilter {
  return SKILL_FILTERS.find((filter) => filter === value) ?? 'all';
}

export function parseSkillSort(value: string): SkillSort {
  return SKILL_SORTS.find((sort) => sort === value) ?? 'name';
}
