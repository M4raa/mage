import { useEffect, useMemo, useState } from 'react';
import { MageMark } from '../workbench/components/MageMark';
import { Icon } from '../workbench/components/Icon';
import type {
  WidgetAlert,
  WidgetChoice,
  WidgetPrefs,
  WidgetRequestView,
  WidgetSessionStatus,
  WidgetSessionView,
  WidgetSnapshot,
  WidgetUsageWindow,
} from '@shared/widget';
import type { MessageKey } from '@shared/i18n/messageKeys.generated';
import { severityForPct, type UsageSeverity } from '../workbench/usageView';
import { useT } from '../i18n/uiLanguage';
import { applyCustomThemeTokens, applyResolvedTheme, clearCustomThemeTokens } from '../workbench/theme';
import { buildRows, summarize, type WidgetRow, type WidgetSummary } from './widgetModel';
import { useWidgetPrefs } from './useWidgetPrefs';
import { useWidgetActions, type WidgetActions } from './useWidgetActions';

// Color y etiqueta corta de cada estado de sesión (paleta monocroma del proyecto + acentos de alerta).
const STATUS_COLOR: Record<WidgetSessionStatus, string> = {
  attention: 'var(--mg-warn)',
  error: 'var(--mg-crit)',
  working: 'var(--color-mg-activity)',
  read_only: 'var(--color-mg-muted)',
  finished: 'var(--color-mg-activity)',
  idle: 'var(--color-mg-idle)',
};
const STATUS_LABEL = {
  attention: 'app.widget.statusAttention',
  error: 'app.widget.statusError',
  working: 'app.widget.statusStreaming',
  read_only: 'app.widget.statusReadOnly',
  finished: 'app.widget.statusFinished',
  idle: 'app.widget.statusIdle',
} as const satisfies Record<WidgetSessionStatus, MessageKey>;

// Color de relleno de la barra de uso segun severidad (medidor de salud: claro=ok, ambar=aviso, rojo=critico).
const SEVERITY_COLOR: Record<UsageSeverity, string> = {
  ok: 'var(--color-mg-activity)',
  warn: 'var(--mg-warn)',
  critical: 'var(--mg-crit)',
};

// Region arrastrable (frameless): la cabecera mueve la ventana; los controles se marcan no-drag.
const DRAG: React.CSSProperties = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const NO_DRAG: React.CSSProperties = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

const ACTION_BUTTON =
  'rounded-[5px] bg-mg-block px-[7px] py-[3px] text-[10px] text-mg-body hover:bg-mg-hover disabled:opacity-50';

// Ventana del WIDGET ACOMPAÑANTE (F9): píldora plegada o lista expandida de sesiones. Recibe el snapshot del
// renderer principal y las sesiones vivas de main; contesta permisos y preguntas sencillas y lleva a la conversación.
export function WidgetApp(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<WidgetSnapshot | null>(null);
  const [sessions, setSessions] = useState<readonly WidgetSessionView[]>([]);
  const { prefs, update } = useWidgetPrefs(window.mage);
  const actions = useWidgetActions(window.mage);
  const { forgetResolved } = actions;

  useEffect(() => {
    const unsubscribe = window.mage.onWidgetSnapshot((next) => {
      // Conmuta el tema al instante: base (data-theme) + overrides de un tema importado si vienen.
      applyResolvedTheme(next.theme);
      if (next.tokenOverrides !== undefined) applyCustomThemeTokens(next.tokenOverrides);
      else clearCustomThemeTokens();
      setSnapshot(next);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    return window.mage.onWidgetSessions((payload) => {
      setSessions(payload.sessions);
      forgetResolved(new Set(payload.sessions.flatMap((s) => s.requests.map((r) => r.requestId))));
    });
  }, [forgetResolved]);

  const rows = useMemo(() => buildRows(snapshot?.agents ?? [], sessions), [snapshot, sessions]);
  const summary = summarize(rows);

  return (
    <div className="flex h-full flex-col bg-mg-window text-mg-body">
      {prefs !== null && prefs.expanded ? (
        <WidgetExpanded rows={rows} snapshot={snapshot} prefs={prefs} update={update} actions={actions} />
      ) : (
        <WidgetPill summary={summary} prefs={prefs} update={update} />
      )}
    </div>
  );
}

function pillText(summary: WidgetSummary, t: ReturnType<typeof useT>): string {
  if (summary.attentionCount > 0) return t('app.widget.pillAttention', { count: summary.attentionCount });
  if (summary.top === null) return t('app.widget.pillCalm');
  return t(STATUS_LABEL[summary.top]);
}

function WidgetPill({ summary, prefs, update }: {
  readonly summary: WidgetSummary;
  readonly prefs: WidgetPrefs | null;
  readonly update: (patch: Partial<WidgetPrefs>) => void;
}): React.JSX.Element {
  const t = useT();
  const color = STATUS_COLOR[summary.top ?? 'idle'];
  return (
    <div data-widget-pill style={DRAG} className="flex h-full items-center gap-[7px] px-[10px]">
      <MageMark size={12} />
      <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate text-[11px] text-mg-text">{pillText(summary, t)}</span>
      {prefs?.doNotDisturb === true && (
        <span data-widget-dnd-indicator title={t('app.widget.dndOn')} className="h-[5px] w-[5px] shrink-0 rounded-full bg-mg-muted" />
      )}
      <button
        style={NO_DRAG}
        data-widget-toggle-view
        title={t('app.widget.expand')}
        onClick={() => update({ expanded: true })}
        className="text-mg-muted hover:text-mg-body"
      >
        <Icon name="chevron" size={12} />
      </button>
    </div>
  );
}

function WidgetExpanded({ rows, snapshot, prefs, update, actions }: {
  readonly rows: readonly WidgetRow[];
  readonly snapshot: WidgetSnapshot | null;
  readonly prefs: WidgetPrefs;
  readonly update: (patch: Partial<WidgetPrefs>) => void;
  readonly actions: WidgetActions;
}): React.JSX.Element {
  const usageAlerts = (snapshot?.alerts ?? []).filter((a) => a.kind === 'usage');
  return (
    <>
      <WidgetHeader prefs={prefs} update={update} />
      <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto p-[10px]">
        <AlertList alerts={usageAlerts} />
        <RowList rows={rows} actions={actions} />
        <UsageBlock usage={snapshot?.usage ?? null} />
      </div>
    </>
  );
}

function WidgetHeader({ prefs, update }: {
  readonly prefs: WidgetPrefs;
  readonly update: (patch: Partial<WidgetPrefs>) => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div
      style={DRAG}
      className="flex shrink-0 items-center justify-between border-b border-mg-border bg-mg-rail px-[10px] py-[7px]"
    >
      <span className="flex items-center gap-[5px] text-[11px] font-bold tracking-[.06em] text-mg-text"><MageMark size={12} /> MAGE</span>
      <span style={NO_DRAG} className="flex items-center gap-[8px]">
        <button
          data-widget-dnd
          aria-pressed={prefs.doNotDisturb}
          title={t(prefs.doNotDisturb ? 'app.widget.dndOn' : 'app.widget.dndOff')}
          onClick={() => update({ doNotDisturb: !prefs.doNotDisturb })}
          className={prefs.doNotDisturb ? 'text-mg-text' : 'text-mg-muted hover:text-mg-body'}
        >
          <Icon name="bell" size={12} />
        </button>
        <button
          data-widget-toggle-view
          title={t('app.widget.collapse')}
          onClick={() => update({ expanded: false })}
          className="rotate-90 text-mg-muted hover:text-mg-body"
        >
          <Icon name="chevron" size={12} />
        </button>
        <button
          onClick={() => void window.mage.setWidgetEnabled(false)}
          title={t('app.widget.hide')}
          className="text-[13px] leading-none text-mg-muted hover:text-mg-body"
        >
          ✕
        </button>
      </span>
    </div>
  );
}

function AlertList({ alerts }: { readonly alerts: readonly WidgetAlert[] }): React.JSX.Element | null {
  if (alerts.length === 0) return null;
  return (
    <div className="flex flex-col gap-[5px]">
      {alerts.map((alert, i) => (
        <div
          key={i}
          className="flex items-center gap-[6px] rounded-[6px] px-[8px] py-[5px] text-[10.5px]"
          style={{ background: 'var(--color-mg-code)', color: SEVERITY_COLOR[alert.severity] }}
        >
          <Icon name={alert.severity === 'critical' ? 'error' : 'warning'} size={12} />
          <span className="min-w-0 truncate">{alert.text}</span>
        </div>
      ))}
    </div>
  );
}

function RowList({ rows, actions }: { readonly rows: readonly WidgetRow[]; readonly actions: WidgetActions }): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-col gap-[4px]">
      <SectionTitle>{t('app.widget.agentsTitle')}</SectionTitle>
      {rows.length === 0 ? (
        <div className="px-[2px] py-[4px] text-[10.5px] text-mg-muted">{t('app.widget.noConversations')}</div>
      ) : (
        rows.map((row) => <WidgetRowView key={row.key} row={row} actions={actions} />)
      )}
    </div>
  );
}

function WidgetRowView({ row, actions }: { readonly row: WidgetRow; readonly actions: WidgetActions }): React.JSX.Element {
  const t = useT();
  const title = row.title === '' ? t('tabs.untitled') : row.title;
  return (
    <div
      data-widget-row
      data-widget-session-id={row.sessionId ?? ''}
      data-widget-status={row.status}
      className="flex flex-col gap-[5px] rounded-[7px] bg-mg-block px-[8px] py-[6px]"
    >
      <button
        onClick={() => actions.open(row)}
        title={t('app.widget.goToAgent', { title, account: row.accountAlias })}
        className="flex items-center gap-[8px] text-left"
      >
        <span className="h-[8px] w-[8px] shrink-0 rounded-[2px]" style={{ background: row.accentBase }} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[11px] text-mg-body">{title}</span>
          <span className="truncate text-[9.5px] text-mg-muted">{row.accountAlias}</span>
        </span>
        <StatusChip status={row.status} />
      </button>
      {row.requests.map((request) => (
        <RequestView key={request.requestId} row={row} request={request} actions={actions} />
      ))}
      <StopButton row={row} actions={actions} />
    </div>
  );
}

function StatusChip({ status }: { readonly status: WidgetSessionStatus }): React.JSX.Element {
  const t = useT();
  return (
    <span className="flex shrink-0 items-center gap-[4px] text-[9.5px]" style={{ color: STATUS_COLOR[status] }}>
      <span className="h-[6px] w-[6px] rounded-full" style={{ background: STATUS_COLOR[status] }} />
      {t(STATUS_LABEL[status])}
    </span>
  );
}

function StopButton({ row, actions }: { readonly row: WidgetRow; readonly actions: WidgetActions }): React.JSX.Element | null {
  const t = useT();
  if (!row.canStop || row.sessionId === null) return null;
  const sessionId = row.sessionId;
  if (actions.stopFailed.has(sessionId)) return <span className="text-[9.5px] text-mg-muted">{t('app.widget.stopInApp')}</span>;
  return (
    <button
      data-widget-stop
      disabled={actions.busy.has(`stop:${sessionId}`)}
      onClick={() => actions.stop(sessionId)}
      className={`flex items-center gap-[4px] self-start ${ACTION_BUTTON}`}
    >
      <Icon name="stop" size={10} />
      {t('app.widget.stop')}
    </button>
  );
}

function RequestView({ row, request, actions }: {
  readonly row: WidgetRow;
  readonly request: WidgetRequestView;
  readonly actions: WidgetActions;
}): React.JSX.Element {
  const t = useT();
  return (
    <div
      data-widget-request-id={request.requestId}
      data-widget-request-kind={request.kind}
      className="flex flex-col gap-[4px] rounded-[6px] px-[6px] py-[5px] text-[10.5px]"
      style={{ background: 'var(--color-mg-code)' }}
    >
      <RequestBody request={request} />
      {actions.late.has(request.requestId) ? (
        <span data-widget-late className="text-[9.5px] text-mg-muted">{t('app.widget.alreadyAnswered')}</span>
      ) : (
        <RequestActions row={row} request={request} actions={actions} />
      )}
      {actions.failed.has(request.requestId) && <span className="text-[9.5px] text-mg-muted">{t('app.widget.answerFailed')}</span>}
    </div>
  );
}

function RequestBody({ request }: { readonly request: WidgetRequestView }): React.JSX.Element {
  const t = useT();
  if (request.kind === 'question') return <span className="text-mg-body">{request.question}</span>;
  if (request.kind === 'in_app') return <span className="text-mg-body">{t('app.widget.inAppAsks', { tool: request.tool })}</span>;
  return (
    <>
      <span className="text-mg-body">{t('app.widget.permissionAsks', { tool: request.tool })}</span>
      {request.detail !== null && <span className="truncate font-mono text-[9.5px] text-mg-muted">{request.detail}</span>}
    </>
  );
}

function RequestActions({ row, request, actions }: {
  readonly row: WidgetRow;
  readonly request: WidgetRequestView;
  readonly actions: WidgetActions;
}): React.JSX.Element {
  const t = useT();
  const disabled = actions.busy.has(request.requestId);
  const reply = (choice: WidgetChoice): void => {
    if (row.sessionId !== null) actions.answer(row.sessionId, request.requestId, choice);
  };
  if (request.kind === 'in_app') {
    return (
      <button data-widget-in-app onClick={() => actions.open(row)} className={`self-start ${ACTION_BUTTON}`}>
        {t('app.widget.openInMage')}
      </button>
    );
  }
  if (request.kind === 'question') {
    return (
      <div className="flex flex-wrap gap-[4px]">
        {request.options.map((label) => (
          <button key={label} data-widget-option={label} disabled={disabled} onClick={() => reply({ kind: 'option', label })} className={ACTION_BUTTON}>
            {label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="flex gap-[4px]">
      <button data-widget-allow disabled={disabled} onClick={() => reply({ kind: 'allow' })} className={ACTION_BUTTON}>
        {t('app.widget.allow')}
      </button>
      <button data-widget-deny disabled={disabled} onClick={() => reply({ kind: 'deny' })} className={ACTION_BUTTON}>
        {t('app.widget.deny')}
      </button>
    </div>
  );
}

function UsageBlock({ usage }: { readonly usage: WidgetSnapshot['usage'] }): React.JSX.Element | null {
  const t = useT();
  if (usage === null) return null;
  return (
    <div className="flex flex-col gap-[6px]">
      <SectionTitle>{t('app.widget.usageTitle')}</SectionTitle>
      <UsageBar label="5 h" usage={usage.fiveHour} />
      <UsageBar label={t('app.widget.weeklyBar')} usage={usage.weekly} />
    </div>
  );
}

function UsageBar({ label, usage }: { readonly label: string; readonly usage: WidgetUsageWindow }): React.JSX.Element {
  const color = SEVERITY_COLOR[severityForPct(usage.pct)];
  return (
    <div className="flex flex-col gap-[3px]">
      <div className="flex items-center justify-between text-[9.5px] text-mg-ter">
        <span>{label}</span>
        <span>
          {usage.pct}% · {usage.label}
        </span>
      </div>
      <div className="h-[5px] overflow-hidden rounded-full" style={{ background: 'var(--color-mg-sel)' }}>
        <div className="h-full rounded-full" style={{ width: `${usage.pct}%`, background: color }} />
      </div>
    </div>
  );
}

function SectionTitle({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <span className="px-[2px] text-[9px] font-bold tracking-[.09em] text-mg-ter">{children}</span>;
}
