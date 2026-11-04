import { Icon } from '../Icon';
import { Dropdown, type DropdownOption } from '../Dropdown';
import { isMacPlatform } from '../../keybindings/platform';
import { EMPTY_SIDEBAR_FILTER, type SidebarFilter } from '../../sidebarModel';
import { providerLabel } from '../../accountView';
import type { Account } from '../../types';
import { useT } from '../../../i18n/uiLanguage';

const ALL = '';

export interface SidebarHeaderProps {
  readonly filter: SidebarFilter;
  readonly onFilter: (filter: SidebarFilter) => void;
  readonly onNewConversation: () => void;
  // Clic derecho en «＋»: el diálogo de cuenta, carpeta, proveedor y modelo.
  readonly onNewWithOptions: () => void;
  readonly workingCount: number;
  // Proveedores y cuentas con alguna conversación: lo que se puede elegir en los chips.
  readonly providers: readonly string[];
  readonly accounts: readonly Account[];
  readonly hiddenCount: number;
}

// Cabecera del lateral: buscador (Ctrl/Cmd+K) + «＋», los chips de filtro y, si algo se oculta, el aviso.
export function SidebarHeader(props: SidebarHeaderProps): React.JSX.Element {
  const t = useT();
  const { filter, onFilter, hiddenCount } = props;
  const shortcut = isMacPlatform() ? '⌘K' : 'Ctrl K';
  const setQuery = (query: string): void => onFilter({ ...filter, query });
  return (
    <div className="flex flex-col gap-[8px] border-b border-mg-border-subtle p-[10px_10px_8px]">
      <div className="flex gap-[6px]">
        <div className="flex h-[28px] min-w-0 flex-1 items-center gap-[6px] rounded-[6px] border border-mg-border-ctrl bg-mg-window px-[8px] focus-within:border-mg-border-pop">
          <span aria-hidden="true" className="text-[11px] text-mg-muted">⌕</span>
          <input
            data-sidebar-search="true"
            value={filter.query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('sidebar.search.placeholder')}
            aria-label={t('sidebar.search.label')}
            className="min-w-0 flex-1 bg-transparent text-[11.5px] text-mg-body outline-none placeholder:text-mg-muted"
          />
          {filter.query.length > 0 ? (
            <button onClick={() => setQuery('')} aria-label={t('sidebar.search.clear')} className="flex-none text-[11px] text-mg-muted hover:text-mg-body">✕</button>
          ) : (
            <kbd aria-hidden="true" className="flex-none whitespace-nowrap font-mono text-[10px] text-mg-muted">{shortcut}</kbd>
          )}
        </div>
        <button
          onClick={props.onNewConversation}
          onContextMenu={(e) => {
            e.preventDefault();
            props.onNewWithOptions();
          }}
          aria-label={t('sidebar.newConversation')}
          data-tip={t('sidebar.newConversation')}
          className="grid h-[28px] w-[28px] flex-none place-items-center rounded-[6px] bg-mg-sel text-mg-sel-ink hover:bg-mg-hover"
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <FilterChips {...props} />
      {hiddenCount > 0 && (
        <div data-filter-hidden={hiddenCount} data-volatile-text="true" className="flex items-center gap-[6px] rounded-[6px] border border-dashed border-mg-border-subtle p-[5px_8px] text-[11px] text-mg-sec">
          <span>{t('sidebar.filters.hidden', { count: hiddenCount })}</span>
          <button onClick={() => onFilter(EMPTY_SIDEBAR_FILTER)} className="ml-auto text-mg-body hover:underline">{t('sidebar.filters.clear')}</button>
        </div>
      )}
    </div>
  );
}

function chipClass(on: boolean): string {
  return `flex h-[22px] items-center gap-[4px] rounded-full border px-[8px] text-[11px] transition-colors duration-90 ease-out hover:text-mg-body ${
    on ? 'border-mg-border-ctrl bg-mg-sel text-mg-sel-ink relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark' : 'border-mg-border-subtle text-mg-sec'
  }`;
}

function FilterChips({ filter, onFilter, workingCount, providers, accounts }: SidebarHeaderProps): React.JSX.Element {
  const t = useT();
  const providerOptions: DropdownOption[] = [
    { value: ALL, label: t('sidebar.filters.allProviders') },
    ...providers.map((id) => ({ value: id, label: providerLabel(id) })),
  ];
  const accountOptions: DropdownOption[] = [
    { value: ALL, label: t('sidebar.filters.allAccounts') },
    ...accounts.map((a) => ({ value: a.id, label: a.alias, accent: a.accent.base })),
  ];
  return (
    <div className="flex flex-wrap gap-[4px]">
      <button data-filter-chip="working" aria-pressed={filter.working} onClick={() => onFilter({ ...filter, working: !filter.working })} className={chipClass(filter.working)}>
        {t('sidebar.filters.working')}
        {workingCount > 0 && <span className="text-mg-muted">{workingCount}</span>}
      </button>
      <Dropdown
        value={filter.provider ?? ALL}
        options={providerOptions}
        onChange={(value) => onFilter({ ...filter, provider: value === ALL ? null : value })}
        ariaLabel={t('sidebar.filters.provider')}
        leading={<span className="text-mg-muted">{t('sidebar.filters.provider')}</span>}
        triggerClassName={filter.provider === null ? '' : 'bg-mg-sel !text-mg-sel-ink relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark'}
        triggerData={{ 'data-filter-chip': 'provider' }}
      />
      <Dropdown
        value={filter.accountId ?? ALL}
        options={accountOptions}
        onChange={(value) => onFilter({ ...filter, accountId: value === ALL ? null : value })}
        ariaLabel={t('sidebar.filters.account')}
        leading={<span className="text-mg-muted">{t('sidebar.filters.account')}</span>}
        triggerClassName={filter.accountId === null ? '' : 'bg-mg-sel !text-mg-sel-ink relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark'}
        triggerData={{ 'data-filter-chip': 'account' }}
      />
      <button data-filter-chip="archived" aria-pressed={filter.archived} onClick={() => onFilter({ ...filter, archived: !filter.archived })} className={chipClass(filter.archived)}>
        {t('sidebar.filters.archived')}
      </button>
    </div>
  );
}
