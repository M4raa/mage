import type { DailyWindows, DayKey } from '@shared/usageHistory';
import type { AccountMetrics } from '../accountMetrics';
import { peakSlot } from '../usageCharts';
import { useT } from '../../i18n/uiLanguage';
import { activeFormatLocale } from '../../i18n/format';

// Secciones del detalle de «Cuentas y consumo» (P-039 F6): cifras, mapa de horas y, en modo admin, herramientas y picos
// de ventana. Solo pintan: las cuentas salen de `accountMetrics`. El gráfico por día y las barras viven en
// UsageDailyChart.tsx y UsageBreakdowns.tsx (DEVOLUCION-095).

export function Kpi({ label, value, hint, tip, data }: { readonly label: string; readonly value: string; readonly hint?: string; readonly tip?: string; readonly data?: string }): React.JSX.Element {
  return (
    <div data-kpi={data} data-tip={tip} className={`flex min-w-0 flex-col gap-[2px] rounded-[9px] border border-mg-border-subtle p-[9px_12px] ${tip === undefined ? '' : 'cursor-help'}`}>
      <span className="truncate text-[10.5px] text-mg-sec">{label}</span>
      <span className="truncate text-[17px] font-semibold tabular-nums text-mg-text">{value}</span>
      {hint !== undefined && <span className="truncate text-[10px] text-mg-muted">{hint}</span>}
    </div>
  );
}

const HOUR_TICKS: ReadonlySet<number> = new Set([0, 6, 12, 18]);
const HEAT_MIN_OPACITY = 0.25;
const HEAT_LEGEND_STEPS = [0.25, 0.5, 0.75, 1] as const;
const HOURS = 24;
// Lunes primero: el mapa de `accountMetrics` va de domingo (0) a sábado (6).
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function weekdayName(weekday: number): string {
  // 2026-11-01 fue domingo: + weekday días.
  return new Intl.DateTimeFormat(activeFormatLocale(), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + weekday)));
}

export function ActivitySection({ metrics }: { readonly metrics: AccountMetrics }): React.JSX.Element {
  const t = useT();
  const peak = peakSlot(metrics.heatmap);
  return (
    <section data-accounts-usage-activity="true" className="flex flex-col gap-[6px]">
      <p data-heat-peak={peak === null ? '' : peak.hour} className="text-[11.5px] text-mg-body">
        {peak === null ? t('accountsUsage.when.empty') : t('accountsUsage.when.peak', { day: weekdayName(peak.weekday), hour: peak.hour, turns: peak.turns })}
      </p>
      <p className="text-[10.5px] text-mg-muted">{t('accountsUsage.admin.activityStats', { active: metrics.activeDays, days: metrics.days, current: metrics.streak.current, longest: metrics.streak.longest })}</p>
      <HeatGrid heatmap={metrics.heatmap} />
      <HeatLegend />
    </section>
  );
}

function HeatGrid({ heatmap }: { readonly heatmap: readonly (readonly number[])[] }): React.JSX.Element {
  const t = useT();
  const max = Math.max(1, ...heatmap.flat());
  return (
    <div role="img" aria-label={t('accountsUsage.admin.heatmapAria')} className="grid gap-[2px] text-[9px] text-mg-muted" style={{ gridTemplateColumns: `28px repeat(${HOURS}, minmax(0, 1fr))` }}>
      {WEEK_ORDER.map((weekday) => [
        <span key={`l${weekday}`} className="truncate">{weekdayName(weekday)}</span>,
        ...Array.from({ length: HOURS }, (_, hour) => <HeatCell key={`${weekday}-${hour}`} weekday={weekday} hour={hour} turns={heatmap[weekday]?.[hour] ?? 0} max={max} />),
      ])}
      <span />
      {Array.from({ length: HOURS }, (_, hour) => <span key={`h${hour}`} className="text-center tabular-nums">{HOUR_TICKS.has(hour) ? hour : ''}</span>)}
    </div>
  );
}

function HeatCell({ weekday, hour, turns, max }: { readonly weekday: number; readonly hour: number; readonly turns: number; readonly max: number }): React.JSX.Element {
  const t = useT();
  return (
    <span
      data-heat-cell="true"
      data-turns={turns}
      data-tip={t('accountsUsage.admin.heatmapCell', { day: weekdayName(weekday), hour, turns })}
      className="h-[12px] rounded-[2px]"
      style={{ background: turns === 0 ? 'var(--color-mg-track)' : 'var(--mg-series-1)', opacity: turns === 0 ? 1 : HEAT_MIN_OPACITY + (1 - HEAT_MIN_OPACITY) * (turns / max) }}
    />
  );
}

function HeatLegend(): React.JSX.Element {
  const t = useT();
  return (
    <div aria-hidden="true" className="flex items-center justify-end gap-[4px] text-[9.5px] text-mg-muted">
      <span>{t('accountsUsage.when.less')}</span>
      {HEAT_LEGEND_STEPS.map((opacity) => <span key={opacity} className="h-[10px] w-[10px] rounded-[2px]" style={{ background: 'var(--mg-series-1)', opacity }} />)}
      <span>{t('accountsUsage.when.more')}</span>
    </div>
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
