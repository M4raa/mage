import type { CoordinatedState } from '@shared/coordination';
import {
  WIDGET_SESSION_STATUSES,
  type WidgetAgent,
  type WidgetRequestView,
  type WidgetSessionStatus,
  type WidgetSessionView,
} from '@shared/widget';

// Modelo PURO del widget acompañante (F9): une las pestañas del renderer con las sesiones vivas de
// main, las ordena por urgencia y resume el estado de la píldora. Sin React ni `window`.

// Una fila de la lista: una pestaña, o una sesión sin pestaña (segundo plano o creada desde la terminal).
export interface WidgetRow {
  readonly key: string; // sessionId, o `tab:<tabId>` si la pestaña no tiene sesión viva
  readonly sessionId: string | null;
  readonly tabId: string | null;
  readonly title: string; // '' = sin título (se pinta con tabs.untitled)
  readonly accountAlias: string; // '' si la sesión no tiene pestaña
  readonly accentBase: string; // '' si la sesión no tiene pestaña
  readonly status: WidgetSessionStatus;
  readonly requests: readonly WidgetRequestView[];
  readonly canStop: boolean; // trabajando, con sesión viva
}

export interface WidgetSummary {
  readonly top: WidgetSessionStatus | null; // estado de la primera fila; null sin filas
  readonly attentionCount: number;
  readonly total: number;
}

export type WidgetRowTarget =
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'tab'; readonly tabId: string };

// Estados del coordinador que cuentan como «trabajando».
const WORKING_STATES: ReadonlySet<CoordinatedState> = new Set(['starting', 'running', 'requires_action', 'restarting']);

// Posición de cada estado en la prioridad (índice menor = más urgente).
const STATUS_PRIORITY: ReadonlyMap<WidgetSessionStatus, number> = new Map(
  WIDGET_SESSION_STATUSES.map((status, index) => [status, index]),
);

// Estado de una fila; gana la PRIMERA condición que se cumple.
export function sessionStatus(session: WidgetSessionView | undefined, agent: WidgetAgent | undefined): WidgetSessionStatus {
  if (session !== undefined && session.requests.length > 0) return 'attention';
  if (session?.outcome === 'error' || session?.state === 'error' || (session === undefined && agent?.status === 'error')) {
    return 'error';
  }
  if (session !== undefined && WORKING_STATES.has(session.state)) return 'working';
  if (agent?.readOnly === true) return 'read_only';
  if (session?.outcome === 'finished') return 'finished';
  return 'idle';
}

function toRow(agent: WidgetAgent | undefined, session: WidgetSessionView | undefined, tabKey: string): WidgetRow {
  const status = sessionStatus(session, agent);
  const sessionId = session?.sessionId ?? null;
  return {
    key: sessionId ?? `tab:${tabKey}`,
    sessionId,
    tabId: agent?.tabId ?? null,
    title: agent?.title ?? '',
    accountAlias: agent?.accountAlias ?? '',
    accentBase: agent?.accentBase ?? '',
    status,
    requests: session?.requests ?? [],
    canStop: status === 'working' && sessionId !== null,
  };
}

// Una fila por pestaña (con su sesión si la tiene) y una por cada sesión sin pestaña; ordenadas de forma estable.
export function buildRows(agents: readonly WidgetAgent[], sessions: readonly WidgetSessionView[]): readonly WidgetRow[] {
  const byId = new Map(sessions.map((s) => [s.sessionId, s]));
  const used = new Set<string>();
  const rows: WidgetRow[] = agents.map((agent) => {
    const session = agent.sessionId === undefined ? undefined : byId.get(agent.sessionId);
    if (session !== undefined) used.add(session.sessionId);
    return toRow(agent, session, agent.tabId);
  });
  for (const session of sessions) {
    if (!used.has(session.sessionId)) rows.push(toRow(undefined, session, session.sessionId));
  }
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => priorityOf(a.row) - priorityOf(b.row) || a.index - b.index)
    .map((entry) => entry.row);
}

function priorityOf(row: WidgetRow): number {
  return STATUS_PRIORITY.get(row.status) ?? WIDGET_SESSION_STATUSES.length;
}

export function summarize(rows: readonly WidgetRow[]): WidgetSummary {
  return {
    top: rows[0]?.status ?? null,
    attentionCount: rows.filter((row) => row.status === 'attention').length,
    total: rows.length,
  };
}

// Adónde lleva el clic en una fila: la sesión viva, o la pestaña si aún no la tiene.
export function rowTarget(row: WidgetRow): WidgetRowTarget | null {
  if (row.sessionId !== null) return { kind: 'session', sessionId: row.sessionId };
  if (row.tabId !== null) return { kind: 'tab', tabId: row.tabId };
  return null;
}
