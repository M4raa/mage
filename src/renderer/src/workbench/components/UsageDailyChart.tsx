import { useMemo, useState } from 'react';
import { formatMicroUsd } from '@shared/usage';
import type { AccountUsageHistory, DailyDetail, DayKey } from '@shared/usageHistory';
import { formatTokensShort } from '../contextView';
import {
  OTHER_SERIES,
  accountPoints,
  barHeightPx,
  dayLabel,
  modelPoints,
  niceCeil,
  stackDaily,
  type ChartMeasure,
  type SeriesBy,
  type SeriesDay,
  type StackedDaily,
} from '../usageCharts';
import { useT } from '../../i18n/uiLanguage';
import { activeFormatLocale } from '../../i18n/format';

// ¿Cómo voy? (DEVOLUCION-095): consumo por día del periodo en columnas apiladas por modelo o por cuenta, en coste o en
// tokens. Una sola escala; leyenda con el total de cada serie; tooltip por día; la tabla es la alternativa accesible.

const CHART_PX = 140;
const SERIES_COLORS = ['var(--mg-series-1)', 'var(--mg-series-2)', 'var(--mg-series-3)'] as const;
const OTHER_COLOR = 'var(--mg-series-other)';
const DIMMED_OPACITY = 0.45;

type ChartViewProps = { readonly chart: StackedDaily; readonly label: (id: string) => string; readonly format: (value: number) => string };

function colorOf(id: string, index: number): string {
  return id === OTHER_SERIES ? OTHER_COLOR : (SERIES_COLORS[index] ?? OTHER_COLOR);
}

function formatMeasure(measure: ChartMeasure, value: number): string {
  return measure === 'cost' ? formatMicroUsd(value, activeFormatLocale()) : formatTokensShort(value);
}

export function TrendSection({ detail, accounts, period, labelOf }: { readonly detail: readonly DailyDetail[]; readonly accounts: readonly AccountUsageHistory[] | null; readonly period: readonly DayKey[]; readonly labelOf: (id: string) => string }): React.JSX.Element {
  const t = useT();
  const [by, setBy] = useState<SeriesBy>('model');
  const [measure, setMeasure] = useState<ChartMeasure>('cost');
  const groupBy = accounts === null ? 'model' : by;
  const chart = useMemo(
    () => stackDaily(groupBy === 'account' && accounts !== null ? accountPoints(accounts, measure) : modelPoints(detail, measure), period),
    [groupBy, accounts, detail, measure, period],
  );
  const label = (id: string): string => (id === OTHER_SERIES ? t('accountsUsage.trend.other') : labelOf(id));
  const format = (value: number): string => formatMeasure(measure, value);
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        {accounts !== null && (
          <Segmented data="by" value={by} onChange={setBy} label={t('accountsUsage.trend.byAria')} options={[['model', t('accountsUsage.trend.byModel')], ['account', t('accountsUsage.trend.byAccount')]]} />
        )}
        <Segmented data="measure" value={measure} onChange={setMeasure} label={t('accountsUsage.trend.measureAria')} options={[['cost', t('accountsUsage.trend.cost')], ['tokens', t('accountsUsage.trend.tokens')]]} />
      </div>
      <Legend chart={chart} label={label} format={format} />
      <StackedColumns chart={chart} label={label} format={format} measure={measure} />
      <DailyTable chart={chart} label={label} format={format} />
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange, label, data }: { readonly value: T; readonly options: readonly (readonly [T, string])[]; readonly onChange: (value: T) => void; readonly label: string; readonly data: string }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label={label} data-usage-toggle={data} className="flex overflow-hidden rounded-[7px] border border-mg-border-ctrl">
      {options.map(([option, text]) => (
        <button key={option} role="radio" aria-checked={value === option} data-option={option} onClick={() => onChange(option)} className={`px-[9px] py-[2px] text-[10.5px] ${value === option ? 'bg-mg-sel text-mg-sel-ink' : 'text-mg-sec hover:bg-mg-hover'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Legend({ chart, label, format }: ChartViewProps): React.JSX.Element | null {
  if (chart.series.length === 0) return null;
  return (
    <ul data-usage-legend="true" className="flex flex-wrap gap-x-[14px] gap-y-[4px] text-[10.5px]">
      {chart.series.map((id, index) => (
        <li key={id} data-series={id} className="flex items-center gap-[6px]">
          <span aria-hidden="true" className="h-[8px] w-[8px] flex-none rounded-[2px]" style={{ background: colorOf(id, index) }} />
          <span className="max-w-[200px] truncate text-mg-body2">{label(id)}</span>
          <span className="tabular-nums text-mg-sec">{format(chart.days.reduce((sum, day) => sum + (day.values[index] ?? 0), 0))}</span>
        </li>
      ))}
    </ul>
  );
}

function StackedColumns({ chart, label, format, measure }: ChartViewProps & { readonly measure: ChartMeasure }): React.JSX.Element {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);
  const axisMax = niceCeil(chart.max);
  const hovered = hover === null ? undefined : chart.days[hover];
  return (
    <figure data-accounts-usage-chart="true" data-measure={measure} className="flex flex-col gap-[4px]">
      <div className="flex gap-[6px]">
        <Axis max={axisMax} format={format} />
        <div className="relative flex flex-1 items-end gap-[2px]" style={{ height: CHART_PX }} onMouseLeave={() => setHover(null)} role="img" aria-label={t('accountsUsage.chartAria')}>
          <Gridlines />
          {chart.days.map((day, index) => (
            <Column key={day.day} day={day} series={chart.series} axisMax={axisMax} dimmed={hover !== null && hover !== index} onHover={() => setHover(index)} />
          ))}
          {hovered !== undefined && <DayTooltip day={hovered} series={chart.series} label={label} format={format} />}
        </div>
      </div>
      <XLabels days={chart.days} />
      {chart.max === 0 && <p className="text-[10.5px] text-mg-muted">{t('accountsUsage.trend.empty')}</p>}
    </figure>
  );
}

function Axis({ max, format }: { readonly max: number; readonly format: (value: number) => string }): React.JSX.Element {
  return (
    <div aria-hidden="true" className="flex w-[52px] flex-none flex-col justify-between text-right text-[9.5px] tabular-nums text-mg-muted" style={{ height: CHART_PX }}>
      <span>{format(max)}</span>
      <span>{format(Math.round(max / 2))}</span>
      <span>{format(0)}</span>
    </div>
  );
}

function Gridlines(): React.JSX.Element {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex flex-col justify-between">
      <div className="border-t border-dashed" style={{ borderColor: 'var(--mg-chart-grid)' }} />
      <div className="border-t border-dashed" style={{ borderColor: 'var(--mg-chart-grid)' }} />
      <div className="border-t" style={{ borderColor: 'var(--mg-chart-baseline)' }} />
    </div>
  );
}

function Column({ day, series, axisMax, dimmed, onHover }: { readonly day: SeriesDay; readonly series: readonly string[]; readonly axisMax: number; readonly dimmed: boolean; readonly onHover: () => void }): React.JSX.Element {
  const segments = series.map((id, index) => ({ id, index, value: day.values[index] ?? 0 })).filter((segment) => segment.value > 0);
  return (
    <div data-day={day.day} data-total={day.total} onMouseEnter={onHover} className="flex h-full min-w-0 flex-1 flex-col-reverse items-center gap-[2px]" style={{ opacity: dimmed ? DIMMED_OPACITY : 1 }}>
      {segments.map((segment, position) => (
        <div
          key={segment.id}
          data-segment={segment.id}
          className={`w-full max-w-[24px] flex-none ${position === segments.length - 1 ? 'rounded-t-[4px]' : ''}`}
          style={{ height: barHeightPx(segment.value, axisMax, CHART_PX), background: colorOf(segment.id, segment.index) }}
        />
      ))}
    </div>
  );
}

function DayTooltip({ day, series, label, format }: { readonly day: SeriesDay; readonly series: readonly string[]; readonly label: (id: string) => string; readonly format: (value: number) => string }): React.JSX.Element {
  return (
    <div role="tooltip" className="pointer-events-none absolute left-1/2 top-0 z-10 flex -translate-x-1/2 flex-col gap-[2px] rounded-[7px] border border-mg-border-pop bg-mg-popover p-[6px_9px] text-[10.5px] text-mg-body mg-shadow-pop">
      <span className="font-semibold">{dayLabel(day.day, activeFormatLocale())} · {format(day.total)}</span>
      {series.map((id, index) => ((day.values[index] ?? 0) > 0 ? (
        <span key={id} className="flex items-center gap-[5px]">
          <span aria-hidden="true" className="h-[7px] w-[7px] flex-none rounded-[2px]" style={{ background: colorOf(id, index) }} />
          {label(id)}: {format(day.values[index] ?? 0)}
        </span>
      ) : null))}
    </div>
  );
}

function XLabels({ days }: { readonly days: readonly SeriesDay[] }): React.JSX.Element {
  const locale = activeFormatLocale();
  const labelAt = (index: number): string => {
    const day = days[index];
    return day === undefined ? '' : dayLabel(day.day, locale);
  };
  return (
    <div aria-hidden="true" className="ml-[58px] flex justify-between text-[9.5px] text-mg-muted">
      <span>{labelAt(0)}</span>
      <span>{labelAt(Math.floor(days.length / 2))}</span>
      <span>{labelAt(days.length - 1)}</span>
    </div>
  );
}

function DailyTable({ chart, label, format }: ChartViewProps): React.JSX.Element {
  const t = useT();
  const locale = activeFormatLocale();
  return (
    <details data-usage-table="true" className="text-[10.5px]">
      <summary className="cursor-pointer text-mg-sec">{t('accountsUsage.trend.table')}</summary>
      <table className="mt-[6px] w-full tabular-nums">
        <thead className="text-mg-muted">
          <tr>
            <th className="text-left font-normal">{t('accountsUsage.trend.day')}</th>
            {chart.series.map((id) => <th key={id} className="text-right font-normal">{label(id)}</th>)}
            <th className="text-right font-normal">{t('accountsUsage.trend.total')}</th>
          </tr>
        </thead>
        <tbody>
          {chart.days.map((day) => (
            <tr key={day.day} data-table-day={day.day} className="border-t border-mg-border-subtle">
              <td className="py-[2px] text-mg-body2">{dayLabel(day.day, locale)}</td>
              {chart.series.map((id, index) => <td key={id} className="text-right text-mg-body2">{format(day.values[index] ?? 0)}</td>)}
              <td className="text-right text-mg-body">{format(day.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
