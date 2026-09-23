import type {
  WidgetAgent,
  WidgetAgentStatus,
  WidgetAlert,
  WidgetSnapshot,
  WidgetUsage,
} from '@shared/widget';
import type { Account, ChatStatus, Tab } from './types';
import { severityForPct, type UsageSeverity } from './usageView';

// Mapeo PURO del estado del workbench al snapshot compacto del WIDGET FLOTANTE (M3). Sin efectos ni
// dependencia del reloj (los labels de uso ya vienen formateados en account.usage). Se testea aparte.

// Entrada minima que necesita el snapshot (subconjunto de WorkbenchState): asi la funcion es pura y
// testable sin construir el store entero ni sus acciones.
export interface WidgetViewInput {
  readonly tabs: readonly Tab[];
  readonly accounts: readonly Account[];
  readonly activeAccountId: string;
  readonly statusByChat: Readonly<Record<string, ChatStatus>>;
}

// Rango de urgencia de cada estado: ordena los agentes (mas urgente primero) y decide "activo".
const STATUS_RANK: Record<WidgetAgentStatus, number> = {
  error: 3,
  needs_permission: 2,
  streaming: 1,
  idle: 0,
};

// Construye el snapshot completo. `resolvedTheme` viaja en el snapshot para que el widget conmute de
// tema al instante (lo resuelve el caller). `tokenOverrides` (opcional) son los colores de un tema
// importado activo (Open VSX) que el widget inyecta sobre el tema base.
export function toWidgetSnapshot(
  input: WidgetViewInput,
  resolvedTheme: 'light' | 'dark',
  tokenOverrides?: Readonly<Record<string, string>>,
): WidgetSnapshot {
  const activeAccount = input.accounts.find((a) => a.id === input.activeAccountId);
  return {
    theme: resolvedTheme,
    agents: buildAgents(input),
    usage: activeAccount === undefined ? null : toWidgetUsage(activeAccount),
    alerts: buildAlerts(input, activeAccount),
    ...(tokenOverrides === undefined ? {} : { tokenOverrides }),
  };
}

// Mapea cada pestana a un agente y las ordena por urgencia (activas primero), preservando el orden
// original entre iguales (sort estable via indice).
function buildAgents(input: WidgetViewInput): readonly WidgetAgent[] {
  const accentById = new Map(input.accounts.map((a) => [a.id, a.accent.base]));
  return input.tabs
    .map((tab, index) => ({ agent: toAgent(tab, input.statusByChat[tab.id] ?? 'idle', accentById), index }))
    .sort((a, b) => STATUS_RANK[b.agent.status] - STATUS_RANK[a.agent.status] || a.index - b.index)
    .map((entry) => entry.agent);
}

function toAgent(tab: Tab, status: ChatStatus, accentById: ReadonlyMap<string, string>): WidgetAgent {
  return {
    tabId: tab.id,
    title: tab.title,
    accountAlias: tab.accountAlias,
    accentBase: accentById.get(tab.accountId) ?? '',
    status,
  };
}

function toWidgetUsage(account: Account): WidgetUsage {
  return {
    fiveHour: { pct: account.usage.fiveHour.pct, label: account.usage.fiveHour.label },
    weekly: { pct: account.usage.weekly.pct, label: account.usage.weekly.label },
  };
}

// Alertas ordenadas por urgencia: errores (critical), uso sobre umbral, permisos pendientes (warn).
function buildAlerts(input: WidgetViewInput, activeAccount: Account | undefined): readonly WidgetAlert[] {
  const errors = tabsWithStatus(input, 'error').map(
    (tab): WidgetAlert => ({ kind: 'error', severity: 'critical', text: `${tab.title}: error` }),
  );
  const usage = activeAccount === undefined ? [] : usageAlerts(activeAccount);
  const permissions = tabsWithStatus(input, 'needs_permission').map(
    (tab): WidgetAlert => ({ kind: 'permission', severity: 'warn', text: `${tab.title}: permiso pendiente` }),
  );
  return [...errors, ...usage, ...permissions];
}

// Una alerta por cada ventana de uso (5h/semanal) que cruza umbral. Reutiliza severityForPct.
function usageAlerts(account: Account): readonly WidgetAlert[] {
  const windows: readonly { readonly label: string; readonly pct: number }[] = [
    { label: '5h', pct: account.usage.fiveHour.pct },
    { label: 'semanal', pct: account.usage.weekly.pct },
  ];
  const alerts: WidgetAlert[] = [];
  for (const window of windows) {
    const severity = severityForPct(window.pct);
    if (severity !== 'ok') {
      alerts.push({ kind: 'usage', severity: mapSeverity(severity), text: `Uso ${window.label} ${window.pct}%` });
    }
  }
  return alerts;
}

function tabsWithStatus(input: WidgetViewInput, status: ChatStatus): readonly Tab[] {
  return input.tabs.filter((tab) => (input.statusByChat[tab.id] ?? 'idle') === status);
}

// severityForPct devuelve 'ok'|'warn'|'critical'; el snapshot solo distingue warn/critical (el ok no
// genera alerta). Se mapea explicitamente (nunca llega 'ok' aqui: el caller lo filtra antes).
function mapSeverity(severity: UsageSeverity): 'warn' | 'critical' {
  return severity === 'critical' ? 'critical' : 'warn';
}
