import { useEffect, useMemo, useState } from 'react';
import type { CapabilitiesOverview, DiscoverPluginView, InstalledPluginView, PluginAction, PluginCatalogView } from '@shared/capabilities';
import type { MessageKey } from '@shared/i18n/messageKeys.generated';
import type { Translate } from '@shared/i18n/translator';
import type { LibraryKind } from '@shared/ipc';
import { useT } from '../../../i18n/uiLanguage';
import { describeError } from '../../describeError';
import type { Account } from '../../types';
import {
  accountChoice,
  CAPABILITY_PAGE_CLASS,
  CapabilityHeader,
  CapabilityList,
  CapabilityRow,
  useClaudeAccountChoice,
  type CapabilityChoice,
  type CapabilityTab,
} from './CapabilityPage';
import { LibrarySection } from './LibrarySection';
import { MCP_BUTTON_CLASS } from './mcpStyles';
import { MetaChip, type RowMenuItem } from './McpRow';
import {
  ALL_CATEGORIES,
  categoriesOf,
  DISCOVER_SORTS,
  filterDiscover,
  filterInstalled,
  INSTALLED_FILTERS,
  isUserInstalled,
  parseDiscoverSort,
  parseInstalledFilter,
  sortDiscover,
  type DiscoverSort,
  type InstalledFilter,
} from './pluginsModel';

// Página Plugins de Capacidades (DEVOLUCION-094): «Tuyos» = installed_plugins.json de la cuenta; «Descubrir» = los
// marketplaces que ya conoce el CLI (D-3). Toda acción la hace el CLI de la cuenta (D-4) y se aplica en su siguiente
// conversación.

const FILTER_LABELS = {
  all: 'capabilities.plugins.filter.all',
  user: 'capabilities.plugins.filter.user',
  project: 'capabilities.plugins.filter.project',
  disabled: 'capabilities.plugins.filter.disabled',
} as const satisfies Record<InstalledFilter, MessageKey>;
const SORT_LABELS = {
  installs: 'capabilities.plugins.sort.installs',
  name: 'capabilities.plugins.sort.name',
} as const satisfies Record<DiscoverSort, MessageKey>;
const PLUGIN_LIBRARY_KINDS: readonly LibraryKind[] = ['plugin'];
const MESSAGE_CLASS = 'text-[11px] text-mg-muted';

type PluginData = {
  readonly overview: CapabilitiesOverview | null;
  readonly catalog: PluginCatalogView | null;
  readonly error: string | null;
  readonly reload: () => void;
};
type RunPlugin = (action: PluginAction, plugin: string, marketplace: string) => void;
type PluginNotice = { readonly ok: boolean; readonly text: string } | null;
type PluginActionState = { readonly busy: boolean; readonly notice: PluginNotice; readonly run: RunPlugin };

function usePluginData(accountDir: string | null): PluginData {
  const [round, setRound] = useState(0);
  const [state, setState] = useState<Omit<PluginData, 'reload'>>({ overview: null, catalog: null, error: null });
  useEffect(() => {
    if (accountDir === null) return undefined;
    let cancelled = false;
    Promise.all([window.mage.capabilitiesOverview(accountDir), window.mage.capabilitiesPluginCatalog(accountDir)])
      .then(([overview, catalog]) => {
        if (!cancelled) setState({ overview, catalog, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ overview: null, catalog: null, error: describeError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [accountDir, round]);
  return { ...state, reload: () => setRound((n) => n + 1) };
}

function usePluginAction(accountDir: string | null, reload: () => void): PluginActionState {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<PluginNotice>(null);
  const run: RunPlugin = (action, plugin, marketplace) => {
    if (accountDir === null || busy) return;
    setBusy(true);
    setNotice(null);
    window.mage
      .capabilitiesPluginAction({ accountDir, action, plugin, marketplace })
      .then(() => setNotice({ ok: true, text: t('capabilities.plugins.done') }))
      .catch((err: unknown) => setNotice({ ok: false, text: t('capabilities.plugins.failed', { error: describeError(err) }) }))
      .finally(() => {
        setBusy(false);
        reload();
      });
  };
  return { busy, notice, run };
}

function copyId(id: string): void {
  void navigator.clipboard.writeText(id).catch((err: unknown) => console.warn('No se pudo copiar el id del plugin:', describeError(err)));
}

function ActionNotice({ busy, notice }: { readonly busy: boolean; readonly notice: PluginNotice }): React.JSX.Element | null {
  const t = useT();
  if (busy) return <p data-plugin-busy="true" className="text-[11px] text-mg-sec">{t('capabilities.plugins.running')}</p>;
  if (notice === null) return null;
  return (
    <div
      role="status"
      data-plugin-notice={notice.ok ? 'done' : 'error'}
      className={`rounded-[7px] border border-mg-border-subtle p-[7px_10px] text-[10.5px] ${notice.ok ? '' : 'text-mg-danger'}`}
    >
      {notice.text}
    </div>
  );
}

function installedMenu(
  t: Translate,
  plugin: InstalledPluginView,
  run: RunPlugin,
  setConfirming: (value: boolean) => void,
): readonly RowMenuItem[] {
  const copy: RowMenuItem = { label: t('capabilities.plugins.action.copyId', { id: plugin.id }), onSelect: () => copyId(plugin.id) };
  if (!isUserInstalled(plugin)) return [copy];
  const toggle: RowMenuItem = plugin.enabled
    ? { label: t('capabilities.plugins.action.disable'), onSelect: () => run('disable', plugin.name, plugin.marketplace) }
    : { label: t('capabilities.plugins.action.enable'), onSelect: () => run('enable', plugin.name, plugin.marketplace) };
  const uninstall: RowMenuItem = { label: t('capabilities.plugins.action.uninstall'), onSelect: () => setConfirming(true), danger: true };
  return [toggle, uninstall, copy];
}

function InstalledRow({ plugin, busy, run }: { readonly plugin: InstalledPluginView; readonly busy: boolean; readonly run: RunPlugin }): React.JSX.Element {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const stateText = t(plugin.enabled ? 'capabilities.plugins.enabled' : 'capabilities.plugins.disabled');
  const aside = confirming ? (
    <button
      data-plugin-confirm-uninstall="true"
      disabled={busy}
      onClick={() => run('uninstall', plugin.name, plugin.marketplace)}
      className={`${MCP_BUTTON_CLASS} text-mg-danger`}
    >
      {t('capabilities.plugins.action.confirmUninstall')}
    </button>
  ) : (
    stateText
  );
  return (
    <CapabilityRow
      icon="diamond"
      name={plugin.name}
      chips={[plugin.marketplace, ...(plugin.version === null ? [] : [`v${plugin.version}`])]}
      origin={t(isUserInstalled(plugin) ? 'capabilities.plugins.origin.user' : 'capabilities.plugins.origin.project')}
      description=""
      aside={aside}
      menu={installedMenu(t, plugin, run, setConfirming)}
      dataAttrs={{ 'data-capability-row': plugin.id, 'data-plugin-enabled': String(plugin.enabled) }}
    />
  );
}

interface InstalledListProps {
  readonly data: PluginData;
  readonly query: string;
  readonly filter: InstalledFilter;
  readonly action: PluginActionState;
}

function InstalledList({ data, query, filter, action }: InstalledListProps): React.JSX.Element {
  const t = useT();
  if (data.error !== null) return <div role="alert" className="text-[11px] text-mg-danger">{t('capabilities.loadError', { error: data.error })}</div>;
  if (data.overview === null) return <p className={MESSAGE_CLASS}>{t('mcp.common.loading')}</p>;
  if (data.overview.plugins.length === 0) return <p className={MESSAGE_CLASS}>{t('capabilities.plugins.empty')}</p>;
  const visible = filterInstalled(data.overview.plugins, query, filter);
  if (visible.length === 0) return <p className={MESSAGE_CLASS}>{t('capabilities.noMatches')}</p>;
  return (
    <CapabilityList label={t('capabilities.plugins.listAria')}>
      {visible.map((plugin) => (
        <InstalledRow key={plugin.id} plugin={plugin} busy={action.busy} run={action.run} />
      ))}
    </CapabilityList>
  );
}

function DiscoverRow({ plugin, busy, run }: { readonly plugin: DiscoverPluginView; readonly busy: boolean; readonly run: RunPlugin }): React.JSX.Element {
  const t = useT();
  const { homepage } = plugin;
  const menu: RowMenuItem[] = [];
  if (homepage !== null) menu.push({ label: t('capabilities.plugins.action.homepage'), onSelect: () => void window.mage.openExternal(homepage) });
  menu.push({ label: t('capabilities.plugins.action.copyId', { id: plugin.id }), onSelect: () => copyId(plugin.id) });
  const install = plugin.installed ? (
    <MetaChip>{t('capabilities.plugins.installed')}</MetaChip>
  ) : (
    <button data-plugin-install="true" disabled={busy} onClick={() => run('install', plugin.name, plugin.marketplace)} className={MCP_BUTTON_CLASS}>
      {t('capabilities.plugins.action.install')}
    </button>
  );
  return (
    <CapabilityRow
      icon="diamond"
      name={plugin.name}
      chips={[plugin.marketplace, ...(plugin.category === null ? [] : [plugin.category])]}
      origin={plugin.author === null ? '' : t('capabilities.plugins.discover.by', { author: plugin.author })}
      description={plugin.description}
      aside={
        <span className="flex items-center gap-[8px]">
          {plugin.installs !== null && t('capabilities.plugins.discover.installs', { count: plugin.installs })}
          {install}
        </span>
      }
      menu={menu}
      dataAttrs={{ 'data-discover-plugin': plugin.id, 'data-discover-installed': String(plugin.installed) }}
    />
  );
}

interface DiscoverListProps {
  readonly catalog: PluginCatalogView | null;
  readonly query: string;
  readonly category: string;
  readonly sort: DiscoverSort;
  readonly action: PluginActionState;
  readonly accountDir: string;
}

function DiscoverList({ catalog, query, category, sort, action, accountDir }: DiscoverListProps): React.JSX.Element {
  const t = useT();
  const visible = useMemo(
    () => (catalog === null ? [] : sortDiscover(filterDiscover(catalog.plugins, query, category), sort)),
    [catalog, query, category, sort],
  );
  if (catalog === null) return <p className={MESSAGE_CLASS}>{t('mcp.common.loading')}</p>;
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="text-[11px] text-mg-sec">{t('capabilities.plugins.discover.note')}</p>
      <p data-plugins-shared-warning="true" className="text-[11px] text-mg-warn-text">{t('capabilities.plugins.discover.sharedFolder')}</p>
      {catalog.marketplaces
        .filter((m) => m.state !== 'ok')
        .map((m) => (
          <p key={m.name} data-marketplace-missing={m.name} className="text-[10.5px] text-mg-warn-text">
            {t('capabilities.plugins.discover.marketplaceMissing', { name: m.name })}
          </p>
        ))}
      {catalog.plugins.length === 0 ? (
        <p className={MESSAGE_CLASS}>{t('capabilities.plugins.discover.empty')}</p>
      ) : (
        <CapabilityList label={t('capabilities.plugins.discoverAria')}>
          {visible.map((plugin) => (
            <DiscoverRow key={plugin.id} plugin={plugin} busy={action.busy} run={action.run} />
          ))}
        </CapabilityList>
      )}
      <span className="text-[9.5px] font-bold uppercase tracking-[.08em] text-mg-ter">{t('capabilities.plugins.discover.libraryTitle')}</span>
      <LibrarySection kinds={PLUGIN_LIBRARY_KINDS} accountDir={accountDir} />
    </div>
  );
}

interface ChoiceContext {
  readonly accounts: readonly Account[];
  readonly accountDir: string;
  readonly setAccountDir: (dir: string) => void;
  readonly tab: CapabilityTab;
  readonly filter: InstalledFilter;
  readonly setFilter: (filter: InstalledFilter) => void;
  readonly category: string;
  readonly setCategory: (category: string) => void;
  readonly sort: DiscoverSort;
  readonly setSort: (sort: DiscoverSort) => void;
  readonly catalog: PluginCatalogView | null;
}

function pluginChoices(t: Translate, ctx: ChoiceContext): readonly CapabilityChoice[] {
  const account = accountChoice(t, ctx.accounts, ctx.accountDir, ctx.setAccountDir);
  if (ctx.tab === 'mine') {
    const filter: CapabilityChoice = {
      id: 'filter',
      ariaLabel: t('capabilities.filter.aria'),
      value: ctx.filter,
      options: INSTALLED_FILTERS.map((id) => ({ id, label: t(FILTER_LABELS[id]) })),
      onChange: (value) => ctx.setFilter(parseInstalledFilter(value)),
    };
    return [account, filter];
  }
  const categories = categoriesOf(ctx.catalog?.plugins ?? []).map((id) => ({ id, label: id }));
  const category: CapabilityChoice = {
    id: 'category',
    ariaLabel: t('capabilities.filter.aria'),
    value: ctx.category,
    options: [{ id: ALL_CATEGORIES, label: t('capabilities.plugins.category.all') }, ...categories],
    onChange: ctx.setCategory,
  };
  const sort: CapabilityChoice = {
    id: 'sort',
    ariaLabel: t('capabilities.sort.aria'),
    value: ctx.sort,
    options: DISCOVER_SORTS.map((id) => ({ id, label: t(SORT_LABELS[id]) })),
    onChange: (value) => ctx.setSort(parseDiscoverSort(value)),
  };
  return [account, category, sort];
}

export function PluginsPage(): React.JSX.Element {
  const t = useT();
  const { accounts, accountDir, setAccountDir } = useClaudeAccountChoice();
  const [tab, setTab] = useState<CapabilityTab>('mine');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<InstalledFilter>('all');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [sort, setSort] = useState<DiscoverSort>('installs');
  const data = usePluginData(accountDir);
  const action = usePluginAction(accountDir, data.reload);
  if (accountDir === null) return <div className={CAPABILITY_PAGE_CLASS}>{t('capabilities.noClaudeAccounts')}</div>;
  const choices = pluginChoices(t, { accounts, accountDir, setAccountDir, tab, filter, setFilter, category, setCategory, sort, setSort, catalog: data.catalog });
  return (
    <div data-capabilities-page="plugins" className={CAPABILITY_PAGE_CLASS}>
      <CapabilityHeader
        tab={tab}
        onTab={setTab}
        query={query}
        onQuery={setQuery}
        placeholder={t('capabilities.plugins.searchPlaceholder')}
        choices={choices}
        add={[{ label: t('capabilities.plugins.addFromMarketplace'), onSelect: () => setTab('discover') }]}
      />
      <ActionNotice busy={action.busy} notice={action.notice} />
      {tab === 'mine' ? (
        <InstalledList data={data} query={query} filter={filter} action={action} />
      ) : (
        <DiscoverList catalog={data.catalog} query={query} category={category} sort={sort} action={action} accountDir={accountDir} />
      )}
    </div>
  );
}
