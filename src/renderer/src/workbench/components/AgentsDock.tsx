import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { DISCLOSURE_VARIANTS } from '../motionPresets';
import { agentsDockRows, type AgentDockRow, type AgentRunState } from '../agentsDock';
import { formatElapsed } from '../thinkingStatus';
import type { Block } from '../types';

// Subagentes del turno ANCLADOS encima del input (P-026 3.4, paso C, D21), con el estilo del dock de
// preguntas, que va encima si hay una pendiente. Una fila por subagente; clic → panel de Actividad
// filtrado a el. Se recoge solo cuando acaba el turno del orquestador.
const EMPTY: readonly Block[] = [];
const TICK_MS = 1000;

const STATE_DOT: Readonly<Record<AgentRunState, string>> = {
  running: 'bg-mg-activity mg-pulse',
  done: 'bg-mg-diff-add',
  error: 'bg-mg-danger',
};

export function AgentsDock(): React.JSX.Element {
  const tabId = usePaneTabId();
  const blocks = useWorkbenchStore((s) => s.blocksByChat[tabId] ?? EMPTY);
  const status = useWorkbenchStore((s) => s.statusByChat[tabId] ?? 'idle');
  const rows = useMemo(() => agentsDockRows(blocks), [blocks]);
  const visible = (status === 'streaming' || status === 'needs_permission') && rows.length > 0;
  return <AnimatePresence initial={false}>{visible && <AgentsDockBody key="agents" tabId={tabId} rows={rows} />}</AnimatePresence>;
}

function AgentsDockBody({ tabId, rows }: { readonly tabId: string; readonly rows: readonly AgentDockRow[] }): React.JSX.Element {
  const openActivity = useWorkbenchStore((s) => s.openActivity);
  const now = useNow(rows.some((r) => r.state === 'running'));
  // Cuando se vio cada subagente por primera vez: el bloque no trae hora de inicio (solo la duracion al
  // acabar), y para el tiempo de uno en marcha basta con esta aproximacion de UI.
  const firstSeen = useRef(new Map<string, number>());
  for (const row of rows) if (!firstSeen.current.has(row.toolUseId)) firstSeen.current.set(row.toolUseId, Date.now());
  return (
    <motion.div variants={DISCLOSURE_VARIANTS} initial="initial" animate="animate" exit="exit" className="overflow-hidden px-[22px] pt-[8px]">
      <div data-agents-dock="true" className="overflow-hidden rounded-[10px] border border-mg-border bg-mg-panel">
        {rows.map((row) => (
          <button
            key={row.toolUseId}
            onClick={() => openActivity(tabId, row.toolUseId)}
            data-agents-dock-row={row.state}
            className="flex h-[26px] w-full items-center gap-[8px] px-[10px] text-left text-[11px] hover:bg-mg-hover"
          >
            <span aria-hidden="true" className={`h-[7px] w-[7px] flex-none rounded-full ${STATE_DOT[row.state]}`} />
            <span className="flex-none font-semibold text-mg-body2">{row.name}</span>
            <span className="min-w-0 flex-1 truncate text-mg-sec" title={row.description ?? undefined}>{row.currentStep}</span>
            <span className="flex-none font-mono text-[10px] text-mg-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatElapsed(row.elapsedMs ?? now - (firstSeen.current.get(row.toolUseId) ?? now))}
            </span>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

// Reloj de un segundo solo mientras algun subagente sigue en marcha.
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [ticking]);
  return now;
}
