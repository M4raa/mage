import { useEffect, useMemo, useState } from 'react';
import type { LibraryKind } from '@shared/ipc';
import type { MessageKey } from '@shared/i18n/messageKeys.generated';
import type { Translate } from '@shared/i18n/translator';
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
import {
  classifySkills,
  filterSkills,
  parseSkillFilter,
  parseSkillSort,
  SKILL_FILTERS,
  SKILL_SORTS,
  sortSkills,
  type SkillEntry,
  type SkillFilter,
  type SkillSort,
} from './skillsModel';

// Página Skills de Capacidades: las skills de UNA cuenta de Claude con su ORIGEN. Sale de la
// caché del catálogo de comandos, que llena cada sesión al arrancar, y de los plugins instalados.

const FILTER_LABELS = {
  all: 'capabilities.skills.filter.all',
  user: 'capabilities.skills.filter.user',
  project: 'capabilities.skills.filter.project',
  plugin: 'capabilities.skills.filter.plugin',
  organization: 'capabilities.skills.filter.organization',
} as const satisfies Record<SkillFilter, MessageKey>;
const SORT_LABELS = {
  name: 'capabilities.skills.sort.name',
  origin: 'capabilities.skills.sort.origin',
} as const satisfies Record<SkillSort, MessageKey>;
const SKILL_LIBRARY_KINDS: readonly LibraryKind[] = ['skill', 'agent', 'hook'];

type SkillsState = { readonly entries: readonly SkillEntry[] | null; readonly error: string | null };

function useSkillEntries(accountDir: string | null): SkillsState {
  const [state, setState] = useState<SkillsState>({ entries: null, error: null });
  useEffect(() => {
    if (accountDir === null) return undefined;
    let cancelled = false;
    setState({ entries: null, error: null });
    Promise.all([window.mage.loadCommandCatalog(accountDir), window.mage.capabilitiesOverview(accountDir)])
      .then(([commands, overview]) => {
        if (!cancelled) setState({ entries: classifySkills(commands, overview.plugins), error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ entries: null, error: describeError(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [accountDir]);
  return state;
}

function skillOriginText(t: Translate, entry: SkillEntry): string {
  if (entry.origin === 'user') return t('capabilities.skills.origin.user');
  if (entry.origin === 'project') return t('capabilities.skills.origin.project');
  if (entry.origin === 'organization') return t('capabilities.skills.origin.organization');
  const plugin = entry.plugin ?? entry.name;
  if (entry.marketplace === null) return t('capabilities.skills.origin.plugin', { plugin });
  return t('capabilities.skills.origin.pluginMarketplace', { plugin, marketplace: entry.marketplace });
}

function SkillRow({ entry }: { readonly entry: SkillEntry }): React.JSX.Element {
  const t = useT();
  const copy = (): void =>
    void navigator.clipboard.writeText(`/${entry.name}`).catch((err: unknown) => console.warn('No se pudo copiar la skill:', describeError(err)));
  return (
    <CapabilityRow
      icon="brain"
      name={entry.name}
      chips={entry.plugin === null ? [] : [entry.plugin]}
      origin={skillOriginText(t, entry)}
      description={entry.description}
      menu={[{ label: t('capabilities.skills.copy', { name: entry.name }), onSelect: copy }]}
      dataAttrs={{ 'data-capability-row': entry.name, 'data-skill-origin': entry.origin }}
    />
  );
}

function SkillList({ state, visible }: { readonly state: SkillsState; readonly visible: readonly SkillEntry[] }): React.JSX.Element {
  const t = useT();
  const message = 'text-[11px] text-mg-muted';
  if (state.error !== null) return <div role="alert" className="text-[11px] text-mg-danger">{t('capabilities.loadError', { error: state.error })}</div>;
  if (state.entries === null) return <p className={message}>{t('mcp.common.loading')}</p>;
  if (state.entries.length === 0) return <p className={message}>{t('capabilities.skills.empty')}</p>;
  if (visible.length === 0) return <p className={message}>{t('capabilities.noMatches')}</p>;
  return (
    <CapabilityList label={t('capabilities.skills.listAria')}>
      {visible.map((entry) => (
        <SkillRow key={entry.name} entry={entry} />
      ))}
    </CapabilityList>
  );
}

function DiscoverSkills({ accountDir }: { readonly accountDir: string }): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-col gap-[8px]">
      <p className="text-[11px] text-mg-sec">{t('capabilities.skills.discoverIntro')}</p>
      <LibrarySection kinds={SKILL_LIBRARY_KINDS} accountDir={accountDir} />
    </div>
  );
}

interface ChoiceContext {
  readonly accounts: readonly Account[];
  readonly accountDir: string;
  readonly setAccountDir: (dir: string) => void;
  readonly tab: CapabilityTab;
  readonly filter: SkillFilter;
  readonly setFilter: (filter: SkillFilter) => void;
  readonly sort: SkillSort;
  readonly setSort: (sort: SkillSort) => void;
}

function skillChoices(t: Translate, ctx: ChoiceContext): readonly CapabilityChoice[] {
  const account = accountChoice(t, ctx.accounts, ctx.accountDir, ctx.setAccountDir);
  if (ctx.tab === 'discover') return [account];
  const filter: CapabilityChoice = {
    id: 'filter',
    ariaLabel: t('capabilities.filter.aria'),
    value: ctx.filter,
    options: SKILL_FILTERS.map((id) => ({ id, label: t(FILTER_LABELS[id]) })),
    onChange: (value) => ctx.setFilter(parseSkillFilter(value)),
  };
  const sort: CapabilityChoice = {
    id: 'sort',
    ariaLabel: t('capabilities.sort.aria'),
    value: ctx.sort,
    options: SKILL_SORTS.map((id) => ({ id, label: t(SORT_LABELS[id]) })),
    onChange: (value) => ctx.setSort(parseSkillSort(value)),
  };
  return [account, filter, sort];
}

export function SkillsPage(): React.JSX.Element {
  const t = useT();
  const { accounts, accountDir, setAccountDir } = useClaudeAccountChoice();
  const [tab, setTab] = useState<CapabilityTab>('mine');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SkillFilter>('all');
  const [sort, setSort] = useState<SkillSort>('name');
  const state = useSkillEntries(accountDir);
  const visible = useMemo(
    () => (state.entries === null ? [] : sortSkills(filterSkills(state.entries, query, filter), sort)),
    [state.entries, query, filter, sort],
  );
  if (accountDir === null) return <div className={CAPABILITY_PAGE_CLASS}>{t('capabilities.noClaudeAccounts')}</div>;
  const choices = skillChoices(t, { accounts, accountDir, setAccountDir, tab, filter, setFilter, sort, setSort });
  const add = [{ label: t('capabilities.skills.addFromLibrary'), onSelect: () => setTab('discover') }];
  return (
    <div data-capabilities-page="skills" className={CAPABILITY_PAGE_CLASS}>
      <CapabilityHeader
        tab={tab}
        onTab={setTab}
        query={tab === 'mine' ? query : null}
        onQuery={setQuery}
        placeholder={t('capabilities.skills.searchPlaceholder')}
        choices={choices}
        add={add}
      />
      {tab === 'mine' ? <SkillList state={state} visible={visible} /> : <DiscoverSkills accountDir={accountDir} />}
    </div>
  );
}
