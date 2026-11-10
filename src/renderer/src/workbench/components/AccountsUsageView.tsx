import { useEffect, useMemo, useState } from 'react';
import type { UsageHistory } from '@shared/usageHistory';
import { formatMicroUsd } from '@shared/usage';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { lastDays, localDay, PERIODS, type PeriodDays } from '../accountsUsageView';
import { combineDetail, computeAccountMetrics, type AccountMetrics } from '../accountMetrics';
import { describeError } from '../describeError';
import type { Account } from '../types';
import { Icon } from './Icon';
import { AccountDetailHeader } from './AccountUsageActions';
import { ActivitySection, DailyChart, Kpi, ModelsTable, TopList, WindowPeaksSection } from './AccountUsageSections';
import { formatTokensShort } from '../contextView';
import { apiBilledLabel } from '../accountView';
import { useT } from '../../i18n/uiLanguage';
import { activeFormatLocale, formatInteger } from '../../i18n/format';

// «Cuentas y consumo» (P-038 V11; rediseño P-039 F6): a la izquierda las cuentas con sus cifras y «Añadir cuenta»; a la
// derecha el detalle de la elegida (o de todas). Se abre al pulsar el resumen de uso de la barra de estado.

export function AccountsUsageView(): React.JSX.Element | null {
  const open = useWorkbenchStore((s) => s.accountsUsageOpen);
  return open ? <AccountsUsageDialog /> : null;
}

type Load = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly history: UsageHistory } | { readonly kind: 'error'; readonly message: string };

function useUsageHistory(): { readonly load: Load; readonly reload: () => void } {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoad((current) => (current.kind === 'ready' ? current : { kind: 'loading' }));
    window.mage
      .getUsageHistory()
      .then((history) => alive && setLoad({ kind: 'ready', history }))
      .catch((err: unknown) => alive && setLoad({ kind: 'error', message: describeError(err) }));
    return () => {
      alive = false;
    };
  }, [round]);
  return { load, reload: () => setRound((r) => r + 1) };
}

const money = (microUsd: number): string => formatMicroUsd(microUsd, activeFormatLocale());

// Métricas de una cuenta (o de todas, con `accountId` null) en el periodo.
function useMetrics(history: UsageHistory | null, accountId: string | null, period: readonly string[]): AccountMetrics | null {
  const plan = useWorkbenchStore((s) => (accountId === null ? undefined : s.settings.planPriceMicroUsdByAccount[accountId]));
  return useMemo(() => {
    if (history === null) return null;
    const account = accountId === null ? undefined : history.accounts.find((entry) => entry.accountId === accountId);
    const detail = accountId === null ? combineDetail(history.accounts) : (account?.detail ?? []);
    return computeAccountMetrics({ detail, windows: account?.windows ?? [], period, planPriceMicroUsd: plan ?? null });
  }, [history, accountId, period, plan]);
}

function AccountsUsageDialog(): React.JSX.Element {
  const t = useT();
  const close = useWorkbenchStore((s) => s.closeAccountsUsage);
  const accounts = useWorkbenchStore((s) => s.accounts);
  const refreshUsage = useWorkbenchStore((s) => s.refreshUsage);
  const dialogRef = useDialogA11y({ onClose: close });
  const { load, reload } = useUsageHistory();
  const [periodDays, setPeriodDays] = useState<PeriodDays>(30);
  const [accountId, setAccountId] = useState<string | null>(null);
  const period = useMemo(() => lastDays(localDay(new Date()), periodDays), [periodDays]);
  const history = load.kind === 'ready' ? load.history : null;

  // Ventanas frescas de cada cuenta al abrir (main cachea; las de API no consultan nada).
  useEffect(() => {
    // `refreshUsage` guarda su propio error por cuenta (usageErrorByAccount): no rechaza.
    for (const account of accounts) void refreshUsage(account.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, []);

  const selected = accounts.find((account) => account.id === accountId) ?? null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim" onClick={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounts-usage-title"
        data-accounts-usage="true"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(90vh,900px)] w-[min(96vw,1240px)] flex-col overflow-hidden rounded-[11px] border border-mg-border-pop bg-mg-panel text-[12px] mg-shadow-modal"
      >
        <header className="flex items-center gap-[10px] border-b border-mg-border-subtle p-[12px_18px]">
          <h2 id="accounts-usage-title" className="flex-1 text-[14px] font-semibold text-mg-text">{t('accountsUsage.title')}</h2>
          <PeriodPicker value={periodDays} onChange={setPeriodDays} />
          <button onClick={reload} className="flex items-center gap-[5px] rounded-[6px] border border-mg-border-emph px-[9px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover">
            <Icon name="refresh" size={12} />
            {t('accountsUsage.refresh')}
          </button>
          <button onClick={close} aria-label={t('accountsUsage.close')} className="grid h-[24px] w-[24px] place-items-center rounded-[6px] text-mg-muted hover:bg-mg-hover hover:text-mg-body">
            <Icon name="close" size={13} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1">
          <AccountList accounts={accounts} history={history} period={period} selectedId={accountId} onSelect={setAccountId} />
          <main className="flex min-w-0 flex-1 flex-col gap-[16px] overflow-y-auto p-[16px_20px]" data-accounts-usage-detail={accountId ?? 'all'}>
            {selected !== null && <AccountDetailHeader account={selected} />}
            {selected === null && <h3 className="text-[13px] font-semibold text-mg-text">{t('accountsUsage.allAccounts')}</h3>}
            {load.kind === 'loading' && <p className="text-[11px] text-mg-muted">{t('accountsUsage.loading')}</p>}
            {load.kind === 'error' && <p role="alert" className="text-[11px] text-mg-danger">{t('accountsUsage.loadError', { error: load.message })}</p>}
            {history !== null && <Detail history={history} accountId={accountId} account={selected} period={period} />}
          </main>
        </div>
      </div>
    </div>
  );
}

function PeriodPicker({ value, onChange }: { readonly value: PeriodDays; readonly onChange: (days: PeriodDays) => void }): React.JSX.Element {
  const t = useT();
  return (
    <div role="radiogroup" aria-label={t('accountsUsage.periodAria')} className="flex overflow-hidden rounded-[7px] border border-mg-border-ctrl">
      {PERIODS.map((days) => (
        <button key={days} role="radio" aria-checked={value === days} onClick={() => onChange(days)} className={`px-[10px] py-[3px] text-[11px] ${value === days ? 'bg-mg-sel text-mg-sel-ink' : 'text-mg-sec hover:bg-mg-hover'}`}>
          {t('accountsUsage.period', { days })}
        </button>
      ))}
    </div>
  );
}

function AccountList(props: {
  readonly accounts: readonly Account[];
  readonly history: UsageHistory | null;
  readonly period: readonly string[];
  readonly selectedId: string | null;
  readonly onSelect: (accountId: string | null) => void;
}): React.JSX.Element {
  const t = useT();
  const closeAccountsUsage = useWorkbenchStore((s) => s.closeAccountsUsage);
  const openAddAccount = useWorkbenchStore((s) => s.openAddAccount);
  return (
    <nav aria-label={t('accountsUsage.accountsAria')} className="flex w-[290px] flex-none flex-col border-r border-mg-border-subtle">
      <div className="flex min-h-0 flex-1 flex-col gap-[3px] overflow-y-auto p-[10px]">
        <ListRow selected={props.selectedId === null} onClick={() => props.onSelect(null)} data="all">
          <span className="grid h-[24px] w-[24px] flex-none place-items-center rounded-[6px] border border-mg-border-ctrl text-mg-sec"><Icon name="user" size={13} /></span>
          <span className="min-w-0 flex-1 truncate font-semibold text-mg-text">{t('accountsUsage.allAccounts')}</span>
        </ListRow>
        {props.accounts.map((account) => (
          <AccountListRow key={account.id} account={account} history={props.history} period={props.period} selected={props.selectedId === account.id} onSelect={() => props.onSelect(account.id)} />
        ))}
      </div>
      {/* Este diálogo comparte capa con el de añadir cuenta: se cierra antes para no taparlo. */}
      <button
        data-accounts-usage-add="true"
        onClick={() => {
          closeAccountsUsage();
          openAddAccount();
        }}
        className="m-[10px] flex items-center justify-center gap-[6px] rounded-[7px] border border-dashed border-mg-border-emph py-[6px] text-[11.5px] text-mg-body2 hover:bg-mg-hover"
      >
        <Icon name="plus" size={12} />
        {t('accountsUsage.addAccount')}
      </button>
    </nav>
  );
}

function ListRow({ selected, onClick, data, children }: { readonly selected: boolean; readonly onClick: () => void; readonly data: string; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <button data-account-row={data} aria-current={selected} onClick={onClick} className={`flex w-full items-center gap-[9px] rounded-[8px] p-[7px_9px] text-left text-[11.5px] transition-colors duration-90 ease-out ${selected ? 'bg-mg-sel' : 'hover:bg-mg-hover'}`}>
      {children}
    </button>
  );
}

function AccountListRow({ account, history, period, selected, onSelect }: { readonly account: Account; readonly history: UsageHistory | null; readonly period: readonly string[]; readonly selected: boolean; readonly onSelect: () => void }): React.JSX.Element {
  const t = useT();
  const hidden = useWorkbenchStore((s) => s.settings.hiddenAccounts.includes(account.id));
  const metrics = useMetrics(history, account.id, period);
  const limits = metrics === null ? 0 : metrics.limits.fiveHour + metrics.limits.weekly + metrics.limits.other;
  return (
    <ListRow selected={selected} onClick={onSelect} data={account.id}>
      <span aria-hidden="true" className="grid h-[24px] w-[24px] flex-none place-items-center rounded-[6px] text-[11px] font-bold text-mg-window" style={{ background: account.accent.base }}>{account.monogram}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`truncate font-semibold ${hidden ? 'text-mg-muted' : 'text-mg-text'}`}>{account.provider} · {account.alias}</span>
        <span className="truncate text-[10px] text-mg-muted">
          {account.apiBilled ? apiBilledLabel() : t('accountsUsage.rowWindows', { fiveHour: account.usage.fiveHour.pct, weekly: account.usage.weekly.pct })}
        </span>
      </span>
      <span className="flex flex-none flex-col items-end text-[10px] tabular-nums">
        <span className="text-mg-body2">{metrics === null ? '…' : money(metrics.costMicroUsd)}</span>
        {limits > 0 && <span className="text-mg-warn-text">{t('accountsUsage.rowLimits', { count: limits })}</span>}
      </span>
    </ListRow>
  );
}

function Detail({ history, accountId, account, period }: { readonly history: UsageHistory; readonly accountId: string | null; readonly account: Account | null; readonly period: readonly string[] }): React.JSX.Element {
  const t = useT();
  const adminMode = useWorkbenchStore((s) => s.settings.adminMode);
  const metrics = useMetrics(history, accountId, period);
  if (metrics === null) return <></>;
  const limitsByDay = new Map(history.accounts.find((entry) => entry.accountId === accountId)?.detail.map((day) => [day.day, day.limits.fiveHour + day.limits.weekly + day.limits.other]) ?? []);
  return (
    <>
      <Kpis metrics={metrics} account={account} />
      {metrics.unpriced && <p className="text-[10.5px] text-mg-warn-text">{t('accountsUsage.unpriced')}</p>}
      <DailyChart metrics={metrics} period={period} />
      <ModelsTable metrics={metrics} />
      {adminMode && (
        <div data-accounts-usage-admin="true" className="flex flex-col gap-[16px] border-t border-mg-border-subtle pt-[14px]">
          <ActivitySection metrics={metrics} />
          <div className="grid grid-cols-2 gap-[18px]">
            <TopList title={t('accountsUsage.admin.projects')} rows={metrics.projects} format={formatTokensShort} data="projects" />
            <TopList title={t('accountsUsage.admin.tools')} rows={metrics.tools} format={formatInteger} data="tools" />
          </div>
          {accountId !== null && <WindowPeaksSection windows={metrics.windows} limitsByDay={limitsByDay} period={period} />}
        </div>
      )}
      <p className="text-[10.5px] leading-[1.45] text-mg-muted">{t('accountsUsage.sourceNote')}</p>
    </>
  );
}

function Kpis({ metrics, account }: { readonly metrics: AccountMetrics; readonly account: Account | null }): React.JSX.Element {
  const t = useT();
  const utilization = metrics.utilization;
  const value = metrics.value;
  const subscription = account !== null && !account.apiBilled;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-[10px]" data-accounts-usage-kpis="true">
      <Kpi data="cost" label={t('accountsUsage.kpi.cost')} value={money(metrics.costMicroUsd)} tip={t('accountsUsage.kpi.costTip')} />
      <Kpi data="tokens" label={t('accountsUsage.kpi.tokens')} value={formatTokensShort(metrics.tokens)} />
      <Kpi data="turns" label={t('accountsUsage.kpi.turns')} value={formatInteger(metrics.turns)} hint={t('accountsUsage.kpi.conversations', { count: metrics.conversations })} />
      <Kpi data="limits" label={t('accountsUsage.kpi.limits')} value={formatInteger(metrics.limits.fiveHour + metrics.limits.weekly + metrics.limits.other)} hint={t('accountsUsage.kpi.limitsHint', { fiveHour: metrics.limits.fiveHour, weekly: metrics.limits.weekly })} />
      {subscription && (
        <Kpi
          data="utilization"
          label={t('accountsUsage.kpi.utilization')}
          value={utilization.avgPct === null ? t('accountsUsage.kpi.noData') : `${utilization.avgPct} %`}
          hint={t('accountsUsage.kpi.utilizationWeeks', { withData: utilization.weeksWithData, weeks: utilization.weeks })}
          tip={t('accountsUsage.kpi.utilizationTip')}
        />
      )}
      {subscription && (
        <Kpi
          data="value"
          label={t('accountsUsage.kpi.value')}
          value={value?.ratio === null || value?.ratio === undefined ? t('accountsUsage.kpi.noData') : t('accountsUsage.kpi.valueRatio', { ratio: value.ratio.toFixed(1) })}
          hint={value === null ? t('accountsUsage.kpi.valueNoPlan') : t('accountsUsage.kpi.valuePaid', { paid: money(value.planCostMicroUsd) })}
          tip={t('accountsUsage.kpi.valueTip')}
        />
      )}
    </div>
  );
}
