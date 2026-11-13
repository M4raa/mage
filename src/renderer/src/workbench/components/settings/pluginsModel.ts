// Modelo PURO de la página Plugins: filtros, orden y categorías de «Tuyos» y «Descubrir».
import type { DiscoverPluginView, InstalledPluginView } from '@shared/capabilities';

export const INSTALLED_FILTERS = ['all', 'user', 'project', 'disabled'] as const;
export type InstalledFilter = (typeof INSTALLED_FILTERS)[number];
export const DISCOVER_SORTS = ['installs', 'name'] as const;
export type DiscoverSort = (typeof DISCOVER_SORTS)[number];
export const ALL_CATEGORIES = '';
// Un plugin sin dato de instalaciones va después de cualquiera que lo tenga (incluido 0).
const NO_INSTALLS = -1;

export function parseInstalledFilter(value: string): InstalledFilter {
  return INSTALLED_FILTERS.find((filter) => filter === value) ?? 'all';
}

export function parseDiscoverSort(value: string): DiscoverSort {
  return DISCOVER_SORTS.find((sort) => sort === value) ?? 'installs';
}

export function isUserInstalled(plugin: InstalledPluginView): boolean {
  return plugin.scopes.includes('user');
}

function matches(texts: readonly (string | null)[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;
  return texts.some((text) => text !== null && text.toLowerCase().includes(needle));
}

const INSTALLED_PREDICATES: Record<InstalledFilter, (plugin: InstalledPluginView) => boolean> = {
  all: () => true,
  user: isUserInstalled,
  project: (plugin) => !isUserInstalled(plugin),
  disabled: (plugin) => !plugin.enabled,
};

export function filterInstalled(
  plugins: readonly InstalledPluginView[],
  query: string,
  filter: InstalledFilter,
): readonly InstalledPluginView[] {
  return plugins.filter((plugin) => INSTALLED_PREDICATES[filter](plugin) && matches([plugin.name, plugin.marketplace], query));
}

export function filterDiscover(
  plugins: readonly DiscoverPluginView[],
  query: string,
  category: string,
): readonly DiscoverPluginView[] {
  return plugins.filter(
    (plugin) =>
      (category === ALL_CATEGORIES || plugin.category === category) &&
      matches([plugin.name, plugin.description, plugin.marketplace, plugin.author], query),
  );
}

export function sortDiscover(plugins: readonly DiscoverPluginView[], sort: DiscoverSort): readonly DiscoverPluginView[] {
  const byName = (a: DiscoverPluginView, b: DiscoverPluginView): number => a.name.localeCompare(b.name, 'en');
  const byInstalls = (a: DiscoverPluginView, b: DiscoverPluginView): number =>
    (b.installs ?? NO_INSTALLS) - (a.installs ?? NO_INSTALLS) || byName(a, b);
  return [...plugins].sort(sort === 'name' ? byName : byInstalls);
}

export function categoriesOf(plugins: readonly DiscoverPluginView[]): readonly string[] {
  const categories = new Set<string>();
  for (const plugin of plugins) if (plugin.category !== null) categories.add(plugin.category);
  return [...categories].sort((a, b) => a.localeCompare(b, 'en'));
}
