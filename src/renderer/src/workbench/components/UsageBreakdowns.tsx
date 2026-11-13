import { useMemo } from 'react';
import { formatMicroUsd } from '@shared/usage';
import type { DayKey, UsageHistory } from '@shared/usageHistory';
import { useWorkbenchStore } from '../workbenchStore';
import { computeAccountMetrics, type AccountMetrics } from '../accountMetrics';
import { formatTokensShort } from '../contextView';
import type { Account } from '../types';
import { formatResetAbsolute, type UsageSeverity } from '../usageView';
import { TOKEN_PARTS, budgetMeter, projectLabel, rankedRows, windowMeter, type Meter, type RankedRow, type TokenPart, type TokenSplit } from '../usageCharts';
import { Icon } from './Icon';
import { useT } from '../../i18n/uiLanguage';
import { activeFormatLocale } from '../../i18n/format';

// Secciones de «Cuentas y consumo»: cuánto queda (ventanas o presupuesto), qué consume más y en qué se
// van los tokens. Solo pintan: los números salen de usageCharts.ts y accountMetrics.ts.

const money = (microUsd: number): string => formatMicroUsd(microUsd, activeFormatLocale());

const FULL_PCT = 100;
const SEVERITY_COLOR: Readonly<Record<UsageSeverity, string>> = { ok: 'var(--mg-series-1)', warn: 'var(--mg-warn)', critical: 'var(--mg-crit)' };
const PART_COLOR: Readonly<Record<TokenPart, string>> = { input: 'var(--mg-series-1)', output: 'var(--mg-series-2)', cacheRead: 'var(--mg-series-3)', cacheWrite: 'var(--mg-series-4)' };
const PART_LABEL_KEY = {
  input: 'accountsUsage.tokens.input',
  output: 'accountsUsage.tokens.output',
  cacheRead: 'accountsUsage.tokens.cacheRead',
  cacheWrite: 'accountsUsage.tokens.cacheWrite',
} as const;

export function RemainingSection({ accounts, history, period, showName }: { readonly accounts: readonly Account[]; readonly history: UsageHistory; readonly period: readonly DayKey[]; readonly showName: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[12px]">
      {accounts.map((account) => (
        <AccountRemaining key={account.id} account={account} history={history} period={period} showName={showName} />
      ))}
    </div>
  );
}

function AccountRemaining({ account, history, period, showName }: { readonly account: Account; readonly history: UsageHistory; readonly period: readonly DayKey[]; readonly showName: boolean }): React.JSX.Element {
  return (
    <div data-remaining-account={account.id} className="flex flex-col gap-[5px]">
      {showName && <span className="truncate text-[11px] font-semibold text-mg-body">{account.provider} · {account.alias}</span>}
      {account.apiBilled ? <BudgetRow account={account} history={history} period={period} /> : <WindowMeters accountId={account.id} />}
    </div>
  );
}

function WindowMeters({ accountId }: { readonly accountId: string }): React.JSX.Element {
  const t = useT();
  const info = useWorkbenchStore((s) => s.usageByAccount[accountId] ?? null);
  if (info === null) return <p className="text-[10.5px] text-mg-muted">{t('accountsUsage.windowsNoData')}</p>;
  const now = Date.now();
  return (
    <div className="grid grid-cols-2 gap-[14px]">
      <MeterRow data="fiveHour" label={t('accountsUsage.fiveHour')} meter={windowMeter(info.fiveHour)} reset={formatResetAbsolute(info.fiveHour.resetsAt, now, false)} />
      <MeterRow data="sevenDay" label={t('accountsUsage.sevenDay')} meter={windowMeter(info.sevenDay)} reset={formatResetAbsolute(info.sevenDay.resetsAt, now, true)} />
    </div>
  );
}

function MeterRow({ data, label, meter, reset }: { readonly data: string; readonly label: string; readonly meter: Meter; readonly reset: string }): React.JSX.Element {
  const t = useT();
  return (
    <div data-meter={data} data-remaining={meter.remainingPct} data-severity={meter.severity} className="flex min-w-0 flex-col gap-[3px] text-[10.5px]">
      <div className="flex items-baseline justify-between gap-[8px]">
        <span className="text-mg-sec">{label}</span>
        <span className="text-[15px] font-semibold tabular-nums text-mg-text">{t('accountsUsage.remaining.left', { pct: meter.remainingPct })}</span>
      </div>
      <MeterBar label={label} usedPct={meter.usedPct} severity={meter.severity} />
      <div className="flex justify-between text-mg-muted">
        <SeverityNote severity={meter.severity} />
        <span>{t('accountsUsage.resets', { when: reset })}</span>
      </div>
    </div>
  );
}

function MeterBar({ label, usedPct, severity }: { readonly label: string; readonly usedPct: number; readonly severity: UsageSeverity }): React.JSX.Element {
  const t = useT();
  const shown = Math.min(FULL_PCT, usedPct);
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={FULL_PCT} aria-valuenow={shown} aria-valuetext={t('accountsUsage.remaining.used', { pct: usedPct })} className="h-[8px] overflow-hidden rounded-full bg-mg-track">
      <div className="h-full rounded-full" style={{ width: `${shown}%`, background: SEVERITY_COLOR[severity] }} />
    </div>
  );
}

// El color de estado nunca va solo: lleva icono y texto.
function SeverityNote({ severity }: { readonly severity: UsageSeverity }): React.JSX.Element {
  const t = useT();
  if (severity === 'ok') return <span />;
  const critical = severity === 'critical';
  return (
    <span className={`flex items-center gap-[4px] ${critical ? 'text-mg-danger' : 'text-mg-warn-text'}`}>
      <Icon name={critical ? 'error' : 'warning'} size={11} />
      {critical ? t('accountsUsage.remaining.critical') : t('accountsUsage.remaining.warn')}
    </span>
  );
}

function BudgetRow({ account, history, period }: { readonly account: Account; readonly history: UsageHistory; readonly period: readonly DayKey[] }): React.JSX.Element {
  const t = useT();
  const monthly = useWorkbenchStore((s) => s.settings.planPriceMicroUsdByAccount[account.id] ?? null);
  const spent = useMemo(
    () => computeAccountMetrics({ detail: history.accounts.find((entry) => entry.accountId === account.id)?.detail ?? [], windows: [], period, planPriceMicroUsd: null }).costMicroUsd,
    [history, account.id, period],
  );
  const meter = budgetMeter(spent, monthly, period.length);
  if (meter === null) return <p data-meter="budget" className="text-[10.5px] text-mg-muted">{t('accountsUsage.budget.none', { spent: money(spent) })}</p>;
  const label = t('accountsUsage.budget.label', { days: period.length });
  return (
    <div data-meter="budget" data-used={meter.usedPct} data-severity={meter.severity} className="flex flex-col gap-[3px] text-[10.5px]">
      <div className="flex items-baseline justify-between gap-[8px]">
        <span className="text-mg-sec">{label}</span>
        <span className="text-[15px] font-semibold tabular-nums text-mg-text">{t('accountsUsage.budget.value', { spent: money(meter.spentMicroUsd), budget: money(meter.budgetMicroUsd) })}</span>
      </div>
      <MeterBar label={label} usedPct={meter.usedPct} severity={meter.severity} />
      <SeverityNote severity={meter.severity} />
    </div>
  );
}

export function TopSection({ metrics }: { readonly metrics: AccountMetrics }): React.JSX.Element {
  const t = useT();
  const cost = new Map(metrics.models.map((row) => [row.model, row.costMicroUsd]));
  const costText = (id: string): string => {
    const value = cost.get(id);
    return value === null || value === undefined ? t('accountsUsage.models.noPrice') : money(value);
  };
  return (
    <div className="grid grid-cols-2 gap-[18px]">
      <RankedBars title={t('accountsUsage.models.title')} data="models" rows={rankedRows(metrics.models.map((row) => [row.model, row.tokens]), metrics.tokens)} labelOf={(id) => id} extraOf={costText} />
      <RankedBars title={t('accountsUsage.admin.projects')} data="projects" rows={rankedRows(metrics.projects, metrics.tokens)} labelOf={projectLabel} />
    </div>
  );
}

function RankedBars({ title, data, rows, labelOf, extraOf }: { readonly title: string; readonly data: string; readonly rows: readonly RankedRow[]; readonly labelOf: (id: string) => string; readonly extraOf?: (id: string) => string }): React.JSX.Element {
  const t = useT();
  return (
    <section data-usage-ranked={data} className="flex min-w-0 flex-col gap-[6px]">
      <h4 className="text-[11px] font-semibold text-mg-sec">{title}</h4>
      {rows.length === 0 && <p className="text-[10.5px] text-mg-muted">{t('accountsUsage.admin.none')}</p>}
      {rows.map((row) => (
        <div key={row.id} data-ranked-row={row.id} data-value={row.value} title={row.id} className="flex flex-col gap-[2px] text-[10.5px]">
          <div className="flex items-baseline gap-[6px]">
            <span className="min-w-0 flex-1 truncate text-mg-body2">{labelOf(row.id)}</span>
            <span className="tabular-nums text-mg-body">{formatTokensShort(row.value)}</span>
            <span className="w-[36px] text-right tabular-nums text-mg-muted">{row.sharePct} %</span>
            {extraOf !== undefined && <span className="w-[64px] text-right tabular-nums text-mg-sec">{extraOf(row.id)}</span>}
          </div>
          <div className="h-[6px] overflow-hidden rounded-full bg-mg-track">
            <div className="h-full rounded-full" style={{ width: `${row.widthPct}%`, background: 'var(--mg-series-1)' }} />
          </div>
        </div>
      ))}
    </section>
  );
}

export function TokenSplitSection({ split }: { readonly split: TokenSplit }): React.JSX.Element {
  const t = useT();
  return (
    <div data-token-split="true" className="flex flex-col gap-[8px]">
      <p data-cache-hit={split.cacheHitPct ?? ''} data-tip={t('accountsUsage.tokens.cacheHitTip')} className="cursor-help text-[12px] text-mg-body">
        {split.cacheHitPct === null ? t('accountsUsage.tokens.noInput') : t('accountsUsage.tokens.cacheHit', { pct: split.cacheHitPct })}
      </p>
      <div role="img" aria-label={t('accountsUsage.tokens.aria')} className="flex h-[12px] gap-[2px] overflow-hidden rounded-[4px]">
        {TOKEN_PARTS.filter((part) => split.tokens[part] > 0).map((part) => (
          <div key={part} style={{ flexGrow: split.tokens[part], background: PART_COLOR[part] }} />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-[18px] gap-y-[4px] text-[10.5px]">
        {TOKEN_PARTS.map((part) => <TokenPartRow key={part} part={part} split={split} />)}
      </ul>
    </div>
  );
}

function TokenPartRow({ part, split }: { readonly part: TokenPart; readonly split: TokenSplit }): React.JSX.Element {
  const t = useT();
  const share = split.total === 0 ? 0 : Math.round((split.tokens[part] * FULL_PCT) / split.total);
  return (
    <li data-token-part={part} data-tokens={split.tokens[part]} className="flex items-center gap-[6px]">
      <span aria-hidden="true" className="h-[8px] w-[8px] flex-none rounded-[2px]" style={{ background: PART_COLOR[part] }} />
      <span className="min-w-0 flex-1 truncate text-mg-body2">{t(PART_LABEL_KEY[part])}</span>
      <span className="tabular-nums text-mg-body">{formatTokensShort(split.tokens[part])}</span>
      <span className="w-[36px] text-right tabular-nums text-mg-muted">{share} %</span>
      <span className="w-[64px] text-right tabular-nums text-mg-sec">{money(split.costMicroUsd[part])}</span>
    </li>
  );
}
