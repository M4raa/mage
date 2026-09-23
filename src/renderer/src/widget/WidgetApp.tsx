import { useEffect, useState } from 'react';
import { MageMark } from '../workbench/components/MageMark';
import { Icon } from '../workbench/components/Icon';
import type { WidgetAgent, WidgetAgentStatus, WidgetAlert, WidgetSnapshot, WidgetUsageWindow } from '@shared/widget';
import { severityForPct, type UsageSeverity } from '../workbench/usageView';
import { applyCustomThemeTokens, applyResolvedTheme, clearCustomThemeTokens } from '../workbench/theme';

// Color y etiqueta corta de cada estado de agente (paleta monocroma del proyecto + acentos de alerta).
const STATUS_COLOR: Record<WidgetAgentStatus, string> = {
  streaming: 'var(--color-mg-activity)',
  needs_permission: 'var(--mg-warn)',
  error: 'var(--mg-crit)',
  idle: 'var(--color-mg-idle)',
};
const STATUS_LABEL: Record<WidgetAgentStatus, string> = {
  streaming: 'trabajando',
  needs_permission: 'permiso',
  error: 'error',
  idle: 'en espera',
};

// Color de relleno de la barra de uso segun severidad (medidor de salud: claro=ok, ambar=aviso, rojo=critico).
const SEVERITY_COLOR: Record<UsageSeverity, string> = {
  ok: 'var(--color-mg-activity)',
  warn: 'var(--mg-warn)',
  critical: 'var(--mg-crit)',
};

// Region arrastrable (frameless): la cabecera mueve la ventana; los controles se marcan no-drag.
const DRAG: React.CSSProperties = { WebkitAppRegion: 'drag' } as React.CSSProperties;
const NO_DRAG: React.CSSProperties = { WebkitAppRegion: 'no-drag' } as React.CSSProperties;

// Ventana del WIDGET FLOTANTE (M3): HUD de solo lectura. Recibe snapshots del renderer principal (via
// main) y los pinta; el unico camino de vuelta es "activar pestana" (clic en un agente).
export function WidgetApp(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<WidgetSnapshot | null>(null);

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

  return (
    <div className="flex h-full flex-col bg-mg-window text-mg-body">
      <WidgetHeader />
      <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto p-[10px]">
        <AlertList alerts={snapshot?.alerts ?? []} />
        <AgentList agents={snapshot?.agents ?? []} />
        <UsageBlock usage={snapshot?.usage ?? null} />
      </div>
    </div>
  );
}

function WidgetHeader(): React.JSX.Element {
  return (
    <div
      style={DRAG}
      className="flex shrink-0 items-center justify-between border-b border-mg-border bg-mg-rail px-[10px] py-[7px]"
    >
      <span className="flex items-center gap-[5px] text-[11px] font-bold tracking-[.06em] text-mg-text"><MageMark size={12} /> MAGE</span>
      <button
        style={NO_DRAG}
        onClick={() => void window.mage.setWidgetEnabled(false)}
        title="Ocultar widget"
        className="text-[13px] leading-none text-mg-muted hover:text-mg-body"
      >
        ✕
      </button>
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

function AgentList({ agents }: { readonly agents: readonly WidgetAgent[] }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-[4px]">
      <SectionTitle>AGENTES</SectionTitle>
      {agents.length === 0 ? (
        <div className="px-[2px] py-[4px] text-[10.5px] text-mg-muted">No hay conversaciones abiertas.</div>
      ) : (
        agents.map((agent) => <AgentRow key={agent.tabId} agent={agent} />)
      )}
    </div>
  );
}

function AgentRow({ agent }: { readonly agent: WidgetAgent }): React.JSX.Element {
  return (
    <button
      onClick={() => window.mage.activateWidgetTab(agent.tabId)}
      title={`Ir a ${agent.title} (${agent.accountAlias})`}
      className="flex items-center gap-[8px] rounded-[7px] bg-mg-block px-[8px] py-[6px] text-left hover:bg-mg-hover"
    >
      <span className="h-[8px] w-[8px] shrink-0 rounded-[2px]" style={{ background: agent.accentBase }} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11px] text-mg-body">{agent.title}</span>
        <span className="truncate text-[9.5px] text-mg-muted">{agent.accountAlias}</span>
      </span>
      <span className="flex shrink-0 items-center gap-[4px] text-[9.5px]" style={{ color: STATUS_COLOR[agent.status] }}>
        <span className="h-[6px] w-[6px] rounded-full" style={{ background: STATUS_COLOR[agent.status] }} />
        {STATUS_LABEL[agent.status]}
      </span>
    </button>
  );
}

function UsageBlock({ usage }: { readonly usage: WidgetSnapshot['usage'] }): React.JSX.Element | null {
  if (usage === null) return null;
  return (
    <div className="flex flex-col gap-[6px]">
      <SectionTitle>USO</SectionTitle>
      <UsageBar label="5 h" usage={usage.fiveHour} />
      <UsageBar label="Semanal" usage={usage.weekly} />
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
