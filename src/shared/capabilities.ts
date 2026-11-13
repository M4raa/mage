// Capacidades de una cuenta de Claude (skills, plugins y políticas de la organización) tal y como las deja el CLI en su
// config dir. Medido con Claude Code 2.1.319 el 2026-11-13. Main lee y resume; el renderer solo pinta. Ningún valor que
// pueda ser un secreto cruza el IPC (`safeValueText`, main\capabilities\overview\policyFiles.ts).
export type CapabilityFileState = 'absent' | 'ok' | 'unreadable';
// Un dato ajeno ya convertido a texto seguro: un objeto viaja como la lista de sus claves, nunca con sus valores.
export interface PolicyEntryView { readonly name: string; readonly value: string }
export interface PolicyRestrictionView { readonly name: string; readonly allowed: boolean }
// policy-limits.json + remote-settings.json de UNA cuenta.
export interface AccountPoliciesView {
  readonly state: CapabilityFileState;
  readonly restrictions: readonly PolicyRestrictionView[];
  readonly defaults: readonly PolicyEntryView[];
  readonly complianceTaints: readonly string[];
  readonly monitoringNotice: readonly PolicyEntryView[] | null;
  readonly extra: readonly PolicyEntryView[];
  readonly remoteState: CapabilityFileState;
  readonly remote: readonly PolicyEntryView[];
}
export interface ManagedFileView { readonly file: string; readonly state: CapabilityFileState; readonly entries: readonly PolicyEntryView[] }
// Ajustes gestionados del EQUIPO (managed-settings.json y managed-settings.d/*.json). Sin ficheros, `files` vacío.
export interface ManagedSettingsView { readonly dir: string; readonly files: readonly ManagedFileView[] }
export type PluginScope = 'user' | 'project' | 'local';
export interface InstalledPluginView {
  readonly id: string; // nombre@marketplace, la clave de installed_plugins.json
  readonly name: string;
  readonly marketplace: string;
  readonly scopes: readonly PluginScope[];
  readonly version: string | null;
  readonly enabled: boolean; // settings.json → enabledPlugins[id] === true
}
export interface CapabilitiesOverview {
  readonly accountDir: string;
  readonly policies: AccountPoliciesView;
  readonly managed: ManagedSettingsView;
  readonly pluginsState: CapabilityFileState;
  readonly plugins: readonly InstalledPluginView[];
}
export interface MarketplaceView { readonly name: string; readonly sourceKind: string; readonly state: CapabilityFileState; readonly count: number }
export interface DiscoverPluginView {
  readonly id: string; readonly name: string; readonly marketplace: string; readonly description: string;
  readonly category: string | null; readonly author: string | null; readonly homepage: string | null;
  readonly installs: number | null; readonly skills: number | null; readonly installed: boolean;
}
export interface PluginCatalogView { readonly marketplaces: readonly MarketplaceView[]; readonly plugins: readonly DiscoverPluginView[] }
export type PluginAction = 'install' | 'uninstall' | 'enable' | 'disable';
export interface PluginActionParams { readonly accountDir: string; readonly action: PluginAction; readonly plugin: string; readonly marketplace: string }
