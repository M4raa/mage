import { useMemo, useRef, useState } from 'react';
import type { Translate } from '@shared/i18n/translator';
import { useT } from '../../../i18n/uiLanguage';
import type { Account } from '../../types';
import { useWorkbenchStore } from '../../workbenchStore';
import { Icon, type IconName } from '../Icon';
import { pickClaudeAccount } from './capabilitiesModel';
import { MetaChip, RowMenu, type RowMenuItem } from './McpRow';

// Piezas comunes de las páginas de Capacidades (DEVOLUCION-093), con la estructura de los ajustes de Claude Desktop:
// cabecera con «Tuyos»/«Descubrir», buscador, cuenta, filtro, orden y «Añadir ▾», y debajo una lista densa. El título ya
// lo pinta la barra del diálogo (SettingsView), así que aquí no se repite.

export const CAPABILITY_PAGE_CLASS = 'flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto p-[14px_16px]';
export const NOOP = (): void => undefined;

export type CapabilityTab = 'mine' | 'discover';
export interface CapabilityChoice {
  readonly id: string;
  readonly ariaLabel: string;
  readonly value: string;
  readonly options: readonly { readonly id: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
}
export interface CapabilityHeaderProps {
  readonly tab: CapabilityTab | null;
  readonly onTab: (tab: CapabilityTab) => void;
  readonly query: string | null;
  readonly onQuery: (value: string) => void;
  readonly placeholder: string;
  readonly choices: readonly CapabilityChoice[];
  readonly add: readonly RowMenuItem[];
  readonly actions?: React.ReactNode;
}

const TAB_ORDER = ['mine', 'discover'] as const satisfies readonly CapabilityTab[];
const TAB_LABELS = { mine: 'capabilities.tabs.mine', discover: 'capabilities.tabs.discover' } as const;
const TAB_BASE = 'rounded-[7px] px-[10px] py-[4px] text-[11.5px]';
const TAB_ACTIVE = `${TAB_BASE} bg-mg-sel font-semibold text-mg-sel-ink`;
const TAB_IDLE = `${TAB_BASE} text-mg-sec hover:bg-mg-hover`;

function CapabilityTabs({ tab, onTab }: { readonly tab: CapabilityTab; readonly onTab: (tab: CapabilityTab) => void }): React.JSX.Element {
  const t = useT();
  const refs = useRef<Record<CapabilityTab, HTMLButtonElement | null>>({ mine: null, discover: null });
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const other = tab === 'mine' ? 'discover' : 'mine';
    onTab(other);
    refs.current[other]?.focus();
  };
  return (
    <div role="tablist" aria-label={t('capabilities.tabs.aria')} onKeyDown={onKeyDown} className="flex items-center gap-[4px]">
      {TAB_ORDER.map((id) => (
        <button
          key={id}
          ref={(node) => void (refs.current[id] = node)}
          role="tab"
          aria-selected={tab === id}
          tabIndex={tab === id ? 0 : -1}
          data-capability-tab={id}
          onClick={() => onTab(id)}
          className={tab === id ? TAB_ACTIVE : TAB_IDLE}
        >
          {t(TAB_LABELS[id])}
        </button>
      ))}
    </div>
  );
}

function SearchBox({ query, onQuery, placeholder }: { readonly query: string; readonly onQuery: (value: string) => void; readonly placeholder: string }): React.JSX.Element {
  const t = useT();
  return (
    <label className="flex min-w-[180px] flex-1 items-center gap-[6px] rounded-[6px] border border-mg-border-subtle bg-mg-panel px-[8px] py-[3px]">
      <Icon name="search" className="text-mg-muted" />
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder={placeholder}
        aria-label={t('capabilities.search.aria')}
        data-capability-search="true"
        className="min-w-0 flex-1 bg-transparent text-[11px] text-mg-body outline-none"
      />
    </label>
  );
}

function ChoiceSelect({ choice }: { readonly choice: CapabilityChoice }): React.JSX.Element {
  return (
    <select
      data-capability-choice={choice.id}
      aria-label={choice.ariaLabel}
      value={choice.value}
      onChange={(e) => choice.onChange(e.target.value)}
      className="min-w-0 rounded-[5px] border border-mg-border-subtle bg-mg-panel px-[7px] py-[3px] text-[11px] text-mg-body"
    >
      {choice.options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function CapabilityHeader(props: CapabilityHeaderProps): React.JSX.Element {
  const t = useT();
  const { tab, onTab, query, onQuery, placeholder, choices, add, actions } = props;
  return (
    <div data-capability-header="true" className="flex flex-col gap-[10px] border-b border-mg-border-subtle pb-[10px]">
      <div className="flex items-center gap-[10px]">
        <div className="flex-1">{tab !== null && <CapabilityTabs tab={tab} onTab={onTab} />}</div>
        {actions}
        {add.length > 0 && <RowMenu label={t('capabilities.add')} buttonLabel={t('capabilities.add')} items={add} />}
      </div>
      {(query !== null || choices.length > 0) && (
        <div className="flex flex-wrap items-center gap-[8px]">
          {query !== null && <SearchBox query={query} onQuery={onQuery} placeholder={placeholder} />}
          {choices.map((choice) => (
            <ChoiceSelect key={choice.id} choice={choice} />
          ))}
        </div>
      )}
    </div>
  );
}

// Selector de cuenta de la cabecera: una opción por cuenta, con su alias.
export function accountChoice(t: Translate, accounts: readonly Account[], accountDir: string, onChange: (dir: string) => void): CapabilityChoice {
  return {
    id: 'account',
    ariaLabel: t('capabilities.account.aria'),
    value: accountDir,
    options: accounts.map((account) => ({ id: account.id, label: account.alias })),
    onChange,
  };
}

// Cuentas de Claude del store y la elegida (la activa si es de Claude, si no la primera).
export function useClaudeAccountChoice(): { readonly accounts: readonly Account[]; readonly accountDir: string | null; readonly setAccountDir: (dir: string) => void } {
  const allAccounts = useWorkbenchStore((s) => s.accounts);
  const activeAccountId = useWorkbenchStore((s) => s.activeAccountId);
  const accounts = useMemo(() => allAccounts.filter((account) => account.providerId === 'claude'), [allAccounts]);
  const [picked, setPicked] = useState<string | null>(null);
  const accountDir = pickClaudeAccount(accounts.map((account) => account.id), picked, activeAccountId);
  return { accounts, accountDir, setAccountDir: setPicked };
}

export interface CapabilityRowProps {
  readonly icon: IconName;
  readonly name: string;
  readonly chips: readonly string[];
  readonly origin: string;
  readonly description: string;
  readonly aside?: React.ReactNode;
  readonly menu: readonly RowMenuItem[];
  readonly dataAttrs: Readonly<Record<string, string>>;
}

export function CapabilityRow({ icon, name, chips, origin, description, aside, menu, dataAttrs }: CapabilityRowProps): React.JSX.Element {
  const t = useT();
  return (
    <div role="listitem" {...dataAttrs} className="grid grid-cols-[20px_minmax(0,1fr)_auto_auto] items-start gap-x-[10px] border-b border-mg-border-subtle py-[8px] text-[11px]">
      <span className="mt-[1px] grid h-[20px] w-[20px] place-items-center rounded-[5px] bg-mg-hover text-mg-sec">
        <Icon name={icon} size={12} />
      </span>
      <div className="flex min-w-0 flex-col gap-[2px]">
        <div className="flex min-w-0 flex-wrap items-center gap-[4px]">
          <span className="truncate text-[11.5px] font-semibold text-mg-body">{name}</span>
          {chips.map((chip) => (
            <MetaChip key={chip}>{chip}</MetaChip>
          ))}
          <span data-capability-origin="true" className="text-[10.5px] text-mg-ter">{origin}</span>
        </div>
        {description !== '' && (
          <span title={description} className="truncate text-[10.5px] text-mg-sec">
            {description}
          </span>
        )}
      </div>
      <div className="text-[10.5px] text-mg-ter">{aside}</div>
      <RowMenu label={t('capabilities.row.menuAria', { name })} items={menu} />
    </div>
  );
}

export function CapabilityList({ label, children }: { readonly label: string; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <div role="list" aria-label={label} className="flex flex-col border-t border-mg-border-subtle">
      {children}
    </div>
  );
}
