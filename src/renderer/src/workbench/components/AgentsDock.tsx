import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { DISCLOSURE_VARIANTS } from '../motionPresets';
import { agentsDockRows, agentsDockSummaryText, summarizeAgentsDock, type AgentDockRow, type AgentRunState } from '../agentsDock';
import { formatElapsed } from '../thinkingStatus';
import type { Block } from '../types';
import { Icon } from './Icon';

// Subagentes ANCLADOS encima del input (P-026 3.4, paso C, D21), con el estilo del dock de preguntas, que
// va encima si hay una pendiente. P-028 38: UNA linea «N en ejecución · M terminados» que se despliega
// en una fila por subagente (clic → Actividad filtrada a el) y «Ver más» → panel de agentes. Se recoge
// cuando acaba el turno y no queda ninguno en marcha.
const EMPTY: readonly Block[] = [];
const NO_DISMISSED: readonly string[] = [];
const TICK_MS = 1000;

export const AGENT_STATE_DOT: Readonly<Record<AgentRunState, string>> = {
  running: 'bg-mg-activity mg-pulse',
  done: 'bg-mg-diff-add',
  error: 'bg-mg-danger',
  stopped: 'bg-mg-muted',
};

export function AgentsDock(): React.JSX.Element {
  const tabId = usePaneTabId();
  const blocks = useWorkbenchStore((s) => s.blocksByChat[tabId] ?? EMPTY);
  const status = useWorkbenchStore((s) => s.statusByChat[tabId] ?? 'idle');
  const dismissed = useWorkbenchStore((s) => s.dismissedSubagentsByChat[tabId] ?? NO_DISMISSED);
  const rows = useMemo(() => agentsDockRows(blocks, new Set(dismissed)), [blocks, dismissed]);
  // Con la pestaña `idle` sigue a la vista mientras quede alguno en marcha (segundo plano, P-028 37a).
  const busy = status === 'streaming' || status === 'needs_permission';
  const visible = rows.length > 0 && (busy || rows.some((r) => r.state === 'running'));
  return <AnimatePresence initial={false}>{visible && <AgentsDockBody key="agents" tabId={tabId} rows={rows} />}</AnimatePresence>;
}

function AgentsDockBody({ tabId, rows }: { readonly tabId: string; readonly rows: readonly AgentDockRow[] }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const dismissSubagents = useWorkbenchStore((s) => s.dismissSubagents);
  const elapsedOf = useAgentElapsed(rows);
  const summary = summarizeAgentsDock(rows);
  const finishedIds = rows.filter((row) => row.state !== 'running').map((row) => row.toolUseId);
  return (
    <motion.div variants={DISCLOSURE_VARIANTS} initial="initial" animate="animate" exit="exit" className="overflow-hidden px-[22px] pt-[8px]">
      <div data-agents-dock="true" className="overflow-hidden rounded-[10px] border border-mg-border bg-mg-panel">
        <div className="flex h-[26px] items-center gap-[4px] pr-[6px] text-[11px]">
          <button
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            data-agents-dock-summary="true"
            className="flex h-full min-w-0 flex-1 items-center gap-[8px] pl-[10px] text-left text-mg-body2 hover:text-mg-text"
          >
            <Icon name="chevron" size={10} className={`flex-none transition-transform ${expanded ? 'rotate-90' : ''}`} />
            <span aria-hidden="true" className={`h-[7px] w-[7px] flex-none rounded-full ${AGENT_STATE_DOT[summary.running > 0 ? 'running' : 'done']}`} />
            <span className="truncate font-semibold">{agentsDockSummaryText(summary)}</span>
          </button>
          {finishedIds.length > 0 && (
            <DockAction onClick={() => dismissSubagents(tabId, finishedIds)} attr="data-agents-dock-clear" tip="Quitar del dock los que ya pararon">
              Quitar terminados
            </DockAction>
          )}
          <DockAction onClick={revealAgentsPanel} attr="data-agents-dock-more" tip="Ver todos en el panel de agentes">
            Ver más
          </DockAction>
        </div>
        {expanded && rows.map((row) => <AgentDockRowView key={row.toolUseId} tabId={tabId} row={row} elapsedMs={elapsedOf(row)} />)}
      </div>
    </motion.div>
  );
}

function DockAction({ onClick, attr, tip, children }: { readonly onClick: () => void; readonly attr: string; readonly tip: string; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <button onClick={onClick} {...{ [attr]: 'true' }} data-tip={tip} className="flex-none rounded-[4px] px-[6px] py-[1px] text-[10.5px] text-mg-sec hover:bg-mg-hover hover:text-mg-body">
      {children}
    </button>
  );
}

function AgentDockRowView({ tabId, row, elapsedMs }: { readonly tabId: string; readonly row: AgentDockRow; readonly elapsedMs: number }): React.JSX.Element {
  const openActivity = useWorkbenchStore((s) => s.openActivity);
  const dismissSubagents = useWorkbenchStore((s) => s.dismissSubagents);
  return (
    <div data-agents-dock-row={row.state} className="flex h-[26px] items-center border-t border-mg-border-subtle hover:bg-mg-hover">
      <button onClick={() => openActivity(tabId, row.toolUseId)} className="flex h-full min-w-0 flex-1 items-center gap-[8px] pl-[28px] pr-[4px] text-left text-[11px]">
        <span aria-hidden="true" className={`h-[7px] w-[7px] flex-none rounded-full ${AGENT_STATE_DOT[row.state]}`} />
        {/* 37b: la TAREA en primer plano (nueve «general-purpose» iguales no dicen nada); el tipo, chip. */}
        <span className="min-w-0 truncate font-semibold text-mg-body2" title={row.description ?? undefined}>{row.description ?? row.name}</span>
        <span className="flex-none rounded-[4px] bg-mg-sel px-[5px] py-[1px] text-[9px] text-mg-body">{row.name}</span>
        <span className="min-w-0 flex-1 truncate text-mg-sec">{row.currentStep}</span>
        <span className="flex-none font-mono text-[10px] text-mg-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatElapsed(elapsedMs)}
        </span>
      </button>
      {/* 37c: quitar del dock (solo de aqui) uno que ya paro; uno en marcha no se quita, se PARA (R2 29). */}
      {row.state === 'running' ? (
        <StopSubagentButton tabId={tabId} row={row} className="mr-[6px]" />
      ) : (
        <button
          onClick={() => dismissSubagents(tabId, [row.toolUseId])}
          data-agents-dock-dismiss="true"
          aria-label={`Quitar ${row.description ?? row.name} del dock`}
          data-tip="Quitar del dock (sigue en el panel de agentes)"
          className="mr-[6px] flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[4px] text-mg-muted hover:bg-mg-sel hover:text-mg-body"
        >
          <Icon name="close" size={10} />
        </button>
      )}
    </div>
  );
}

// «Parar» de UN subagente en marcha (0.1.1 R2, punto 29): `stop_task` con su `agentId`, que es el
// `task_id` del CLI (medido en 2.1.285). Sin `agentId` (aun no ha llegado el lanzamiento) no hay a quien
// parar y se deja el hueco, para que la fila no baile.
export function StopSubagentButton({ tabId, row, className }: { readonly tabId: string; readonly row: AgentDockRow; readonly className: string }): React.JSX.Element {
  const stopSubagent = useWorkbenchStore((s) => s.stopSubagent);
  const agentId = row.agentId;
  if (agentId === null) return <span aria-hidden="true" className={`${className} w-[18px] flex-none`} />;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        stopSubagent(tabId, agentId);
      }}
      data-agents-stop="true"
      aria-label={`Parar ${row.description ?? row.name}`}
      data-tip="Parar este subagente (los demás siguen)"
      className={`${className} flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[4px] text-mg-muted hover:bg-mg-danger-bg hover:text-mg-danger`}
    >
      <Icon name="stop" size={10} />
    </button>
  );
}

function revealAgentsPanel(): void {
  // Import dinamico: `panelLayoutStore` importa el store (mismo motivo que `openActivity`).
  void import('../panelLayoutStore').then((m) => m.usePanelLayoutStore.getState().revealPanelById('agents'));
}

// Cuando se vio cada subagente por primera vez: el bloque no trae hora de inicio (solo la duracion al
// acabar), y para el tiempo de uno en marcha basta con esta aproximacion de UI (decision b de 37a). Es
// de MODULO para que el dock y el panel de agentes cuenten lo mismo.
// ponytail: no se vacia nunca; un numero por subagente visto en la sesion de Mage.
const FIRST_SEEN_MS = new Map<string, number>();

// Tiempo de cada fila: el del CLI si ya paro; si no, desde que Mage lo vio. Tic de un segundo solo
// mientras quede alguno en marcha.
export function useAgentElapsed(rows: readonly AgentDockRow[]): (row: AgentDockRow) => number {
  const now = useNow(rows.some((r) => r.state === 'running'));
  for (const row of rows) if (!FIRST_SEEN_MS.has(row.toolUseId)) FIRST_SEEN_MS.set(row.toolUseId, now);
  return (row) => row.elapsedMs ?? Math.max(0, now - (FIRST_SEEN_MS.get(row.toolUseId) ?? now));
}

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [ticking]);
  return now;
}
