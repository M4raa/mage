import { useState } from 'react';
import { formatMicroUsd } from '@shared/usage';
import type { DailyWindows, DayKey } from '@shared/usageHistory';
import type { AccountMetrics } from '../accountMetrics';
import { formatTokensShort } from '../contextView';
import { useT } from '../../i18n/uiLanguage';
import { activeFormatLocale, formatInteger } from '../../i18n/format';

// Secciones del detalle de «Cuentas y consumo» (P-039 F6): cifras, gráfico por día, tabla por modelo y, en modo admin,
// actividad, proyectos y herramientas y picos de ventana. Solo pintan: las cuentas salen de `accountMetrics`.

const money = (microUsd: number): string => formatMicroUsd(microUsd, activeFormatLocale());

export function Kpi({ label, value, hint, tip, data }: { readonly label: string; readonly value: string; readonly hint?: string; readonly tip?: string; readonly data?: string }): React.JSX.Element {
  return (
    <div data-kpi={data} data-tip={tip} className={`flex min-w-0 flex-col gap-[2px] rounded-[9px] border border-mg-border-subtle p-[9px_12px] ${tip === undefined ? '' : 'cursor-help'}`}>
      <span className="truncate text-[10.5px] text-mg-sec">{label}</span>
      <span className="truncate text-[17px] font-semibold tabular-nums text-mg-text">{value}</span>
      {hint !== undefined && <span className="truncate text-[10px] text-mg-muted">{hint}</span>}
    </div>
  );
}

const CHART_HEIGHT = 120;

// Coste equivalente por día (o tokens, en los días sin precio): barras apoyadas en la base, detalle en el tooltip.
export function DailyChart({ metrics, period }: { readonly metrics: AccountMetrics; readonly period: readonly DayKey[] }): React.JSX.Element {
  const t = useT();
  const byDay = new Map(metrics.dailyCost.map((day) => [day.day, day]));
  const series = period.map((day) => byDay.get(day) ?? { day, costMicroUsd: 0, tokens: 0 });
  const max = Math.max(1, ...series.map((day) => day.tokens));
  const [hover, setHover] = useState<number | null>(null);
  const hovered = hover === null ? undefined : series[hover];
  return (
    <figure className="flex flex-col gap-[6px]" data-accounts-usage-chart="true">
      <div className="relative flex items-end gap-[2px]" style={{ height: CHART_HEIGHT }} onMouseLeave={() => setHover(null)} role="img" aria-label={t('accountsUsage.chartAria')}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 border-b border-mg-border-subtle" />
        {series.map((day, index) => {
          const height = day.tokens === 0 ? 0 : Math.max(2, Math.round((day.tokens / max) * CHART_HEIGHT));
          return (
            <div key={day.day} className="flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(index)} data-day={day.day} data-tokens={day.tokens}>
              <div className="w-full rounded-t-[4px]" style={{ height, background: 'var(--mg-chart-1)', opacity: hover === null || hover === index ? 1 : 0.45 }} />
            </div>
          );
        })}
        {hovered !== undefined && (
          <div role="tooltip" className="pointer-events-none absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-[7px] border border-mg-border-pop bg-mg-popover p-[6px_9px] text-[10.5px] text-mg-body mg-shadow-pop">
            {t('accountsUsage.chartTip', { day: hovered.day, tokens: formatTokensShort(hovered.tokens), cost: money(hovered.costMicroUsd) })}
          </div>
        )}
      </div>
      <figcaption className="flex justify-between text-[10px] text-mg-muted">
        <span>{series[0]?.day}</span>
        <span>{t('accountsUsage.chartMax', { tokens: formatTokensShort(max) })}</span>
        <span>{series.at(-1)?.day}</span>
      </figcaption>
    </figure>
  );
}

export function ModelsTable({ metrics }: { readonly metrics: AccountMetrics }): React.JSX.Element | null {
  const t = useT();
  if (metrics.models.length === 0) return null;
  const top = metrics.models[0]?.tokens ?? 1;
  return (
    <section data-accounts-usage-models="true" className="flex flex-col gap-[6px]">
      <h3 className="text-[11px] font-semibold text-mg-sec">{t('accountsUsage.models.title')}</h3>
      <table className="w-full text-[11px]">
        <thead className="text-left text-[10px] text-mg-muted">
          <tr>
            <th className="font-normal">{t('accountsUsage.models.model')}</th>
            <th className="font-normal">{t('accountsUsage.models.tokens')}</th>
            <th className="text-right font-normal">{t('accountsUsage.models.turns')}</th>
            <th className="text-right font-normal">{t('accountsUsage.models.cost')}</th>
          </tr>
        </thead>
        <tbody>
          {metrics.models.map((row) => (
            <tr key={row.model} data-model-row={row.model} className="border-t border-mg-border-subtle">
              <td className="max-w-[180px] truncate py-[4px] font-mono text-mg-body">{row.model}</td>
              <td className="py-[4px]">
                <div className="flex items-center gap-[6px]">
                  <div className="h-[4px] w-[80px] overflow-hidden rounded-full bg-mg-track"><div className="h-full rounded-full" style={{ width: `${Math.round((row.tokens / top) * 100)}%`, background: 'var(--mg-chart-1)' }} /></div>
                  <span className="tabular-nums text-mg-body2">{formatTokensShort(row.tokens)}</span>
                </div>
              </td>
              <td className="py-[4px] text-right tabular-nums text-mg-body2">{formatInteger(row.turns)}</td>
              <td className="py-[4px] text-right tabular-nums text-mg-body2">{row.costMicroUsd === null ? t('accountsUsage.models.noPrice') : money(row.costMicroUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const WEEKDAYS = 7;
const HOURS = 24;
// Lunes primero: el mapa de `accountMetrics` va de domingo (0) a sábado (6).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function weekdayName(weekday: number): string {
  // 2026-11-01 fue domingo: + weekday días.
  return new Intl.DateTimeFormat(activeFormatLocale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + weekday)));
}

export function ActivitySection({ metrics }: { readonly metrics: AccountMetrics }): React.JSX.Element {
  const t = useT();
  const max = Math.max(1, ...metrics.heatmap.flat());
  return (
    <section data-accounts-usage-activity="true" className="flex flex-col gap-[6px]">
      <h3 className="text-[11px] font-semibold text-mg-sec">{t('accountsUsage.admin.activity')}</h3>
      <p className="text-[10.5px] text-mg-muted">{t('accountsUsage.admin.activityStats', { active: metrics.activeDays, days: metrics.days, current: metrics.streak.current, longest: metrics.streak.longest })}</p>
      <div role="img" aria-label={t('accountsUsage.admin.heatmapAria')} className="grid gap-[2px] text-[9px] text-mg-muted" style={{ gridTemplateColumns: `28px repeat(${HOURS}, minmax(0, 1fr))` }}>
        {WEEK_ORDER.slice(0, WEEKDAYS).map((weekday) => [
          <span key={`l${weekday}`} className="truncate">{weekdayName(weekday)}</span>,
          ...Array.from({ length: HOURS }, (_, hour) => {
            const turns = metrics.heatmap[weekday]?.[hour] ?? 0;
            return <span key={`${weekday}-${hour}`} data-tip={t('accountsUsage.admin.heatmapCell', { day: weekdayName(weekday), hour, turns })} className="h-[12px] rounded-[2px]" style={{ background: turns === 0 ? 'var(--color-mg-track)' : 'var(--mg-chart-1)', opacity: turns === 0 ? 1 : 0.25 + 0.75 * (turns / max) }} />;
          }),
        ])}
      </div>
    </section>
  );
}

export function TopList({ title, rows, format, data }: { readonly title: string; readonly rows: readonly (readonly [string, number])[]; readonly format: (value: number) => string; readonly data: string }): React.JSX.Element {
  const t = useT();
  const top = rows[0]?.[1] ?? 1;
  return (
    <section data-accounts-usage-top={data} className="flex min-w-0 flex-col gap-[5px]">
      <h3 className="text-[11px] font-semibold text-mg-sec">{title}</h3>
      {rows.length === 0 && <p className="text-[10.5px] text-mg-muted">{t('accountsUsage.admin.none')}</p>}
      {rows.map(([name, value]) => (
        <div key={name} className="flex items-center gap-[6px] text-[10.5px]" title={name}>
          <span className="min-w-0 flex-1 truncate font-mono text-mg-body2">{name}</span>
          <div className="h-[4px] w-[60px] overflow-hidden rounded-full bg-mg-track"><div className="h-full rounded-full" style={{ width: `${Math.round((value / top) * 100)}%`, background: 'var(--mg-chart-1)' }} /></div>
          <span className="w-[48px] text-right tabular-nums text-mg-sec">{format(value)}</span>
        </div>
      ))}
    </section>
  );
}

const PEAK_HEIGHT = 70;

// Picos diarios de las ventanas (5 h y semanal) con los topes marcados (▲) en su día.
export function WindowPeaksSection({ windows, limitsByDay, period }: { readonly windows: readonly DailyWindows[]; readonly limitsByDay: ReadonlyMap<DayKey, number>; readonly period: readonly DayKey[] }): React.JSX.Element {
  const t = useT();
  const byDay = new Map(windows.map((window) => [window.day, window]));
  return (
    <section data-accounts-usage-windows="true" className="flex flex-col gap-[6px]">
      <h3 className="text-[11px] font-semibold text-mg-sec">{t('accountsUsage.admin.windows')}</h3>
      {windows.length === 0 && <p className="text-[10.5px] text-mg-muted">{t('accountsUsage.admin.noWindows')}</p>}
      <div className="flex items-end gap-[2px]" style={{ height: PEAK_HEIGHT }} role="img" aria-label={t('accountsUsage.admin.windowsAria')}>
        {period.map((day) => {
          const window = byDay.get(day);
          const hits = limitsByDay.get(day) ?? 0;
          const bar = (pct: number | null | undefined, color: string) => <div className="w-1/2 rounded-t-[2px]" style={{ height: Math.round(((pct ?? 0) / 100) * (PEAK_HEIGHT - 10)), background: color }} />;
          return (
            <div key={day} data-tip={t('accountsUsage.admin.windowsTip', { day, fiveHour: window?.fiveHourMax ?? '—', weekly: window?.sevenDayMax ?? '—', hits })} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              {hits > 0 && <span data-limit-mark="true" className="text-[8px] leading-[10px] text-mg-danger">▲</span>}
              <div className="flex w-full items-end gap-[1px]">{bar(window?.fiveHourMax, 'var(--mg-chart-1)')}{bar(window?.sevenDayMax, 'var(--mg-chart-2)')}</div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-mg-muted">{t('accountsUsage.admin.windowsLegend')}</p>
    </section>
  );
}
