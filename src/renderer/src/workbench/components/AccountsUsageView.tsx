import { useEffect, useMemo, useState } from 'react';
import { totalTokens, type DailyTokens, type UsageHistory } from '@shared/usageHistory';
import { formatMicroUsd, type UsageInfo } from '@shared/usage';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { formatTokensShort } from '../contextView';
import { formatResetAbsolute } from '../usageView';
import { dailySeries, daysOf, lastDays, localDay, periodTotals, PERIODS, seriesMax, type PeriodDays } from '../accountsUsageView';
import { describeError } from '../describeError';
import { reportActionError } from '../notificationStore';
import { ACCOUNT_ALIAS_MAX } from '@shared/settings';
import type { Account } from '../types';
import { Icon } from './Icon';
import { ColorSwatches } from './TabContextMenu';
import { DeleteAccountDialog } from './AccountMenu';
import { CliLoginPanel, useCliLogin } from './CliLoginPanel';
import { loginLabel } from './accountBadge';
import { apiBilledLabel } from '../accountView';
import { useT } from '../../i18n/uiLanguage';
import { activeFormatLocale, formatInteger } from '../../i18n/format';

// «Cuentas y consumo» (P-038 V11): de un vistazo, el estado y el consumo de TODAS las cuentas (el popover de la barra se
// quedaba corto con muchas) y su gestión. Se abre al pulsar el resumen de uso de la barra de estado.

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

function AccountsUsageDialog(): React.JSX.Element {
  const t = useT();
  const close = useWorkbenchStore((s) => s.closeAccountsUsage);
  const accounts = useWorkbenchStore((s) => s.accounts);
  const refreshUsage = useWorkbenchStore((s) => s.refreshUsage);
  const dialogRef = useDialogA11y({ onClose: close });
  const { load, reload } = useUsageHistory();
  const [period, setPeriod] = useState<PeriodDays>(30);
  const [accountId, setAccountId] = useState<string | null>(null);
  const today = localDay(new Date());

  // Ventanas frescas de cada cuenta al abrir (main cachea; las de API no consultan nada).
  useEffect(() => {
    // `refreshUsage` guarda su propio error por cuenta (usageErrorByAccount): no rechaza.
    for (const account of accounts) void refreshUsage(account.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim" onClick={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="accounts-usage-title"
        data-accounts-usage="true"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(88vh,880px)] w-[min(94vw,1180px)] flex-col overflow-hidden rounded-[11px] border border-mg-border-pop bg-mg-panel text-[12px] mg-shadow-modal"
      >
        <header className="flex items-center gap-[10px] border-b border-mg-border-subtle p-[14px_18px]">
          <h2 id="accounts-usage-title" className="flex-1 text-[14px] font-semibold text-mg-text">{t('accountsUsage.title')}</h2>
          <button onClick={reload} className="flex items-center gap-[5px] rounded-[6px] border border-mg-border-emph px-[9px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover">
            <Icon name="refresh" size={12} />
            {t('accountsUsage.refresh')}
          </button>
          <button onClick={close} aria-label={t('accountsUsage.close')} className="grid h-[24px] w-[24px] place-items-center rounded-[6px] text-mg-muted hover:bg-mg-hover hover:text-mg-body">
            <Icon name="close" size={13} />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto p-[16px_18px]">
          <Filters period={period} onPeriod={setPeriod} accountId={accountId} onAccount={setAccountId} accounts={accounts} />
          {load.kind === 'loading' && <p className="text-[11px] text-mg-muted">{t('accountsUsage.loading')}</p>}
          {load.kind === 'error' && <p role="alert" className="text-[11px] text-mg-danger">{t('accountsUsage.loadError', { error: load.message })}</p>}
          {load.kind === 'ready' && <Overview history={load.history} accountId={accountId} period={period} today={today} />}
          <section className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-[12px]" aria-label={t('accountsUsage.accountsAria')}>
            {accounts.map((account) => (
              <AccountCard key={account.id} account={account} days={load.kind === 'ready' ? daysOf(load.history, account.id) : null} today={today} />
            ))}
          </section>
        </div>
      </div>
    </div>
  );
}

function Filters(props: {
  readonly period: PeriodDays;
  readonly onPeriod: (period: PeriodDays) => void;
  readonly accountId: string | null;
  readonly onAccount: (accountId: string | null) => void;
  readonly accounts: readonly Account[];
}): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-[10px]">
      <div role="radiogroup" aria-label={t('accountsUsage.periodAria')} className="flex overflow-hidden rounded-[7px] border border-mg-border-ctrl">
        {PERIODS.map((days) => (
          <button
            key={days}
            role="radio"
            aria-checked={props.period === days}
            onClick={() => props.onPeriod(days)}
            className={`px-[10px] py-[3px] text-[11px] ${props.period === days ? 'bg-mg-sel text-mg-sel-ink' : 'text-mg-sec hover:bg-mg-hover'}`}
          >
            {t('accountsUsage.period', { days })}
          </button>
        ))}
      </div>
      <select
        aria-label={t('accountsUsage.accountFilterAria')}
        value={props.accountId ?? ''}
        onChange={(e) => props.onAccount(e.target.value.length === 0 ? null : e.target.value)}
        className="rounded-[7px] border border-mg-border-ctrl bg-mg-panel px-[8px] py-[3px] text-[11px] text-mg-body"
      >
        <option value="">{t('accountsUsage.allAccounts')}</option>
        {props.accounts.map((account) => (
          <option key={account.id} value={account.id}>{account.alias}</option>
        ))}
      </select>
    </div>
  );
}

function Overview({ history, accountId, period, today }: { readonly history: UsageHistory; readonly accountId: string | null; readonly period: PeriodDays; readonly today: string }): React.JSX.Element {
  const t = useT();
  const days = daysOf(history, accountId);
  const totals = periodTotals(days, today);
  const series = useMemo(() => dailySeries(days, lastDays(today, period)), [days, today, period]);
  const unattributed = history.unattributed.reduce((sum, day) => sum + totalTokens(day), 0);
  return (
    <section className="flex flex-col gap-[12px]" data-accounts-usage-overview="true">
      <div className="grid grid-cols-3 gap-[10px]">
        <Tile label={t('accountsUsage.today')} value={totals.today} />
        <Tile label={t('accountsUsage.week')} value={totals.week} />
        <Tile label={t('accountsUsage.month')} value={totals.month} />
      </div>
      <DailyBars series={series} />
      <p className="text-[10.5px] leading-[1.45] text-mg-muted">
        {t('accountsUsage.sourceNote')}
        {accountId === null && unattributed > 0 && ` ${t('accountsUsage.unattributedNote', { tokens: formatTokensShort(unattributed) })}`}
      </p>
    </section>
  );
}

function Tile({ label, value }: { readonly label: string; readonly value: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[2px] rounded-[9px] border border-mg-border-subtle p-[9px_12px]">
      <span className="text-[10.5px] text-mg-sec">{label}</span>
      <span className="text-[18px] font-semibold tabular-nums text-mg-text" title={formatInteger(value)}>{formatTokensShort(value)}</span>
    </div>
  );
}

const CHART_HEIGHT = 140;
const BAR_GAP = 2;

// Barras por día (una serie: el filtro de arriba dice de quién). Extremo redondeado arriba, apoyadas en la base; el
// detalle de cada día en su tooltip. Escala lineal desde 0.
function DailyBars({ series }: { readonly series: readonly DailyTokens[] }): React.JSX.Element {
  const t = useT();
  const max = seriesMax(series);
  const [hover, setHover] = useState<number | null>(null);
  const hovered = hover === null ? null : series[hover];
  return (
    <figure className="flex flex-col gap-[6px]" data-accounts-usage-chart="true">
      <div className="relative flex items-end" style={{ height: CHART_HEIGHT, gap: BAR_GAP }} onMouseLeave={() => setHover(null)} role="img" aria-label={t('accountsUsage.chartAria')}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 border-b border-mg-border-subtle" />
        {series.map((day, index) => {
          const value = totalTokens(day);
          const height = value === 0 ? 0 : Math.max(2, Math.round((value / max) * CHART_HEIGHT));
          return (
            <div key={day.day} className="flex h-full min-w-0 flex-1 cursor-default items-end" onMouseEnter={() => setHover(index)} data-day={day.day} data-tokens={value}>
              <div className="w-full rounded-t-[4px]" style={{ height, background: 'var(--mg-chart-1)', opacity: hover === null || hover === index ? 1 : 0.45 }} />
            </div>
          );
        })}
        {hovered !== null && hovered !== undefined && <BarTooltip day={hovered} />}
      </div>
      <figcaption className="flex justify-between text-[10px] text-mg-muted">
        <span>{series[0]?.day}</span>
        <span>{t('accountsUsage.chartMax', { tokens: formatTokensShort(max) })}</span>
        <span>{series.at(-1)?.day}</span>
      </figcaption>
    </figure>
  );
}

function BarTooltip({ day }: { readonly day: DailyTokens }): React.JSX.Element {
  const t = useT();
  return (
    <div role="tooltip" className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-[7px] border border-mg-border-pop bg-mg-popover p-[7px_10px] text-[10.5px] text-mg-body mg-shadow-pop">
      <div className="font-semibold">{day.day} · {formatTokensShort(totalTokens(day))}</div>
      <div className="text-mg-sec">{t('accountsUsage.breakdown', { input: formatTokensShort(day.inputTokens), output: formatTokensShort(day.outputTokens), cacheRead: formatTokensShort(day.cacheReadTokens), cacheWrite: formatTokensShort(day.cacheCreationTokens), turns: day.turns })}</div>
    </div>
  );
}

function AccountCard({ account, days, today }: { readonly account: Account; readonly days: readonly DailyTokens[] | null; readonly today: string }): React.JSX.Element {
  const t = useT();
  const info = useWorkbenchStore((s) => s.usageByAccount[account.id] ?? null);
  const hidden = useWorkbenchStore((s) => s.settings.hiddenAccounts.includes(account.id));
  const totals = days === null ? null : periodTotals(days, today);
  return (
    <article data-account-card={account.id} className={`flex flex-col gap-[9px] rounded-[10px] border border-mg-border-subtle p-[11px_13px] ${hidden ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-[8px]">
        <span aria-hidden="true" className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[6px] text-[11px] font-bold text-mg-window" style={{ background: account.accent.base }}>{account.monogram}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12.5px] font-semibold text-mg-text">{account.alias}</span>
          <span className="truncate text-[10.5px] text-mg-muted">{account.email ?? account.id}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-[4px] text-[10px]">
        <Chip>{account.provider}</Chip>
        <Chip warn={account.apiBilled}>{account.apiBilled ? apiBilledLabel() : t('accountsUsage.subscription')}</Chip>
        {!account.apiBilled && <Chip warn={account.loginStatus !== 'logged_in'}>{loginLabel(account)}</Chip>}
        {hidden && <Chip>{t('accountsUsage.hiddenChip')}</Chip>}
      </div>
      <Windows account={account} info={info} />
      <dl className="grid grid-cols-3 gap-[6px] text-[10.5px]">
        <Stat label={t('accountsUsage.today')} value={totals?.today ?? null} />
        <Stat label={t('accountsUsage.week')} value={totals?.week ?? null} />
        <Stat label={t('accountsUsage.month')} value={totals?.month ?? null} />
      </dl>
      <AccountActions account={account} hidden={hidden} />
    </article>
  );
}

function Chip({ children, warn = false }: { readonly children: React.ReactNode; readonly warn?: boolean }): React.JSX.Element {
  return <span className={`rounded-[4px] border px-[5px] leading-[15px] ${warn ? 'border-mg-warn-border text-mg-warn-text' : 'border-mg-border-subtle text-mg-sec'}`}>{children}</span>;
}

function Stat({ label, value }: { readonly label: string; readonly value: number | null }): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <dt className="text-mg-muted">{label}</dt>
      <dd className="font-semibold tabular-nums text-mg-body">{value === null ? '…' : formatTokensShort(value)}</dd>
    </div>
  );
}

// Ventanas de la suscripción (5 h / 7 d) con su reset, o el coste acumulado si factura la API.
function Windows({ account, info }: { readonly account: Account; readonly info: UsageInfo | null }): React.JSX.Element {
  const t = useT();
  const now = Date.now();
  if (account.apiBilled) {
    const cost = info?.apiUsage?.totals.costMicroUsd;
    return <p className="text-[10.5px] text-mg-sec">{cost === undefined ? t('accountsUsage.apiNoData') : t('accountsUsage.apiCost', { cost: formatMicroUsd(cost, activeFormatLocale()) })}</p>;
  }
  if (info === null) return <p className="text-[10.5px] text-mg-muted">{t('accountsUsage.windowsNoData')}</p>;
  return (
    <div className="flex flex-col gap-[5px]">
      <WindowBar label={t('accountsUsage.fiveHour')} pct={info.fiveHour.utilization} reset={formatResetAbsolute(info.fiveHour.resetsAt, now, false)} />
      <WindowBar label={t('accountsUsage.sevenDay')} pct={info.sevenDay.utilization} reset={formatResetAbsolute(info.sevenDay.resetsAt, now, true)} />
    </div>
  );
}

function WindowBar({ label, pct, reset }: { readonly label: string; readonly pct: number; readonly reset: string }): React.JSX.Element {
  const t = useT();
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div className="flex flex-col gap-[2px] text-[10.5px]">
      <div className="flex justify-between text-mg-sec">
        <span>{label} · <span className="font-semibold tabular-nums text-mg-body">{clamped} %</span></span>
        <span>{t('accountsUsage.resets', { when: reset })}</span>
      </div>
      <div className="h-[4px] overflow-hidden rounded-[2px] bg-mg-hover">
        <div className="h-full rounded-[2px] bg-mg-fill" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

type Editing = 'none' | 'rename' | 'color';

function AccountActions({ account, hidden }: { readonly account: Account; readonly hidden: boolean }): React.JSX.Element {
  const t = useT();
  const renameAccount = useWorkbenchStore((s) => s.renameAccount);
  const setAccountHidden = useWorkbenchStore((s) => s.setAccountHidden);
  const setAccountAccent = useWorkbenchStore((s) => s.setAccountAccent);
  const accent = useWorkbenchStore((s) => s.settings.accentByAccount[account.id]);
  const isActive = useWorkbenchStore((s) => s.activeAccountId === account.id);
  const refreshAccounts = useWorkbenchStore((s) => s.refreshAccounts);
  const login = useCliLogin(() => {
    void refreshAccounts().catch((err: unknown) => reportActionError(t('sidebar.orphan.refreshFailed'), err, 'accounts'));
  });
  const [editing, setEditing] = useState<Editing>('none');
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(account.alias);
  const button = 'rounded-[6px] border border-mg-border-ctrl px-[8px] py-[2px] text-[10.5px] text-mg-body2 hover:bg-mg-hover disabled:opacity-40';
  // «Iniciar sesión» solo sin sesión; con el token caducado basta con que su CLI lo renueve (P-038).
  const canLogin = account.providerId === 'claude' && !account.apiBilled && account.loginStatus === 'logged_out';
  const canRefresh = account.providerId === 'claude' && !account.apiBilled && account.loginStatus === 'expired';
  const refreshLogin = useWorkbenchStore((s) => s.refreshLogin);
  const [refreshing, setRefreshing] = useState(false);
  const runRefresh = (): void => {
    setRefreshing(true);
    refreshLogin(account.id)
      .catch((err: unknown) => reportActionError(t('accountsUsage.refreshLoginFailed'), err, 'accounts'))
      .finally(() => setRefreshing(false));
  };
  return (
    <div className="flex flex-col gap-[6px] border-t border-mg-border-subtle pt-[8px]">
      <div className="flex flex-wrap gap-[6px]">
        {canLogin && <button className={button} onClick={() => login.begin(account.id, account.email)} disabled={login.phase === 'starting' || login.phase === 'submitting'}>{t('accountsUsage.login')}</button>}
        {canRefresh && <button className={button} onClick={runRefresh} disabled={refreshing} data-refresh-login={account.id} data-tip={t('accountsUsage.refreshLoginTip')}>{refreshing ? t('accountsUsage.refreshLoginBusy') : t('accountsUsage.refreshLogin')}</button>}
        <button className={button} onClick={() => setEditing(editing === 'rename' ? 'none' : 'rename')}>{t('accountsUsage.rename')}</button>
        <button className={button} onClick={() => setEditing(editing === 'color' ? 'none' : 'color')}>{t('accountsUsage.color')}</button>
        <button className={button} onClick={() => setAccountHidden(account.id, !hidden)} disabled={!hidden && isActive} data-tip={!hidden && isActive ? t('accountsUsage.hideActiveTip') : undefined}>
          {hidden ? t('accountsUsage.show') : t('accountsUsage.hide')}
        </button>
        {!account.isMain && <button className={`${button} text-mg-danger`} onClick={() => setDeleting(true)}>{t('accountsUsage.delete')}</button>}
      </div>
      {editing === 'rename' && (
        <form
          className="flex gap-[6px]"
          onSubmit={(e) => {
            e.preventDefault();
            renameAccount(account.id, name.trim() === (account.baseAlias ?? '') ? null : name);
            setEditing('none');
          }}
        >
          <input value={name} maxLength={ACCOUNT_ALIAS_MAX} onChange={(e) => setName(e.target.value)} aria-label={t('accountsUsage.renameAria', { alias: account.alias })} className="min-w-0 flex-1 rounded-[6px] border border-mg-border-ctrl bg-transparent px-[7px] py-[2px] text-[11px] text-mg-body" autoFocus />
          <button type="submit" className={button}>{t('accountsUsage.save')}</button>
          <button type="button" className={button} onClick={() => { renameAccount(account.id, null); setEditing('none'); }}>{t('accountsUsage.resetName')}</button>
        </form>
      )}
      {editing === 'color' && <ColorSwatches selected={accent} onPick={(index) => setAccountAccent(account.id, index)} label={t('accounts.menu.colorLabel')} autoTip={t('accounts.menu.colorAuto')} />}
      <CliLoginPanel login={login} />
      {deleting && <DeleteAccountDialog account={account} onClose={() => setDeleting(false)} />}
    </div>
  );
}

