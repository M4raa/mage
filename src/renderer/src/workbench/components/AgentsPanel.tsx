import { useMemo, useState } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId, usePaneTranscriptStore } from '../paneContext';
import { buildSubagentList, type SubagentInvocation } from '../subagentView';
import { SubagentTranscriptView } from './SubagentTranscriptView';
import { Hint } from './TranscriptHint';
import type { SubagentInfo } from '@shared/events';

// Panel "Subagentes" (2.9.b), con las dos mitades que el usuario pidio:
//   - ARRIBA: los subagentes que el CLI DECLARA en su `initialize` (los abrio la Fase B; antes se
//     tiraban enteros).
//   - ABAJO: las INVOCACIONES de esta conversacion, con su drill-down a la transcripcion del subagente.
//     Esa lista vivia escondida dentro del panel de Logs: se MUEVE aqui, no se duplica.
const NO_AGENTS: readonly SubagentInfo[] = [];

export function AgentsPanel(): React.JSX.Element {
  const tabId = usePaneTabId();
  const declared = useWorkbenchStore((s) => s.subagentsByChat[tabId] ?? NO_AGENTS);
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const sessionId = useWorkbenchStore((s) => s.sessionIdByChat[tabId] ?? s.tabs.find((t) => t.id === tabId)?.resumeSessionId);
  // 4.1: el store de la pestaña ACTIVA (este panel vive fuera del centro, asi que `usePaneTabId`
  // devuelve la activa). Decision del usuario: los paneles globales siguen a la pestaña activa.
  const useTranscriptStore = usePaneTranscriptStore();
  const entries = useTranscriptStore((s) => s.entries);
  const invocations = useMemo(() => buildSubagentList(entries), [entries]);
  const [drilled, setDrilled] = useState<SubagentInvocation | null>(null);

  if (tab === undefined) return <Hint text="Abre una conversación para ver sus subagentes." />;
  // Config dir EFECTIVO: en una conversacion privada la transcripcion del subagente vive bajo
  // `mage-private`, y con el de la cuenta se buscaria donde no esta.
  const accountDir = tab.resolvedConfigDir ?? tab.accountId;

  return (
    <div className="flex min-h-0 flex-col gap-[10px] overflow-y-auto p-[10px_12px]">
      <section className="flex flex-col gap-[4px]">
        <div className="text-[9.5px] font-bold uppercase tracking-[.07em] text-mg-ter">Declarados ({declared.length})</div>
        {declared.length === 0 ? (
          <div className="text-[11px] text-mg-muted">La sesión aún no ha declarado sus subagentes.</div>
        ) : (
          declared.map((agent) => (
            <div key={agent.name} className="flex flex-col gap-[1px] rounded-[6px] p-[4px_6px] hover:bg-mg-hover">
              <div className="flex items-baseline gap-[7px]">
                <span className="text-[11px] font-bold text-mg-body">{agent.name}</span>
                {agent.model !== null && <span className="font-mono text-[10px] text-mg-muted">{agent.model}</span>}
              </div>
              {agent.description.length > 0 && (
                <span className="text-[10.5px] leading-[1.4] text-mg-sec2">{agent.description}</span>
              )}
            </div>
          ))
        )}
      </section>

      <section className="flex flex-col gap-[4px] border-t border-mg-border-subtle pt-[8px]">
        <div className="text-[9.5px] font-bold uppercase tracking-[.07em] text-mg-ter">
          Lanzados en esta conversación ({invocations.length})
        </div>
        {invocations.length === 0 ? (
          <div className="text-[11px] text-mg-muted">Ninguno todavía.</div>
        ) : (
          <ul className="flex flex-col text-[10.5px]">
            {invocations.map((subagent) => (
              <SubagentRow key={subagent.toolUseId} subagent={subagent} onDrill={setDrilled} />
            ))}
          </ul>
        )}
      </section>

      {drilled !== null && sessionId !== undefined && (
        <SubagentTranscriptView
          accountDir={accountDir}
          cwd={tab.cwd}
          sessionId={sessionId}
          subagent={drilled}
          onClose={() => setDrilled(null)}
        />
      )}
    </div>
  );
}

// Una invocacion. Con `agentId` es clicable (hay fichero que abrir); sin el, se ve pero no se abre: su
// transcripcion puede no existir todavia.
function SubagentRow({
  subagent,
  onDrill,
}: {
  readonly subagent: SubagentInvocation;
  readonly onDrill: (subagent: SubagentInvocation) => void;
}): React.JSX.Element {
  const content = (
    <>
      <span className="shrink-0 rounded-[4px] bg-mg-sel px-[5px] py-[1px] text-[9px] text-mg-body">
        {subagent.agentType ?? 'agente'}
      </span>
      <span className="truncate text-mg-sec">{subagent.description ?? '(sin descripción)'}</span>
      <span className="ml-auto shrink-0 text-mg-muted">{subagent.status ?? 'pendiente'}</span>
    </>
  );
  if (subagent.agentId === null) {
    return <li className="flex items-baseline gap-[6px] py-[2px] opacity-70">{content}</li>;
  }
  return (
    <li className="py-[1px]">
      <button
        onClick={() => onDrill(subagent)}
        data-tip="Ver la transcripción de este subagente"
        className="flex w-full items-baseline gap-[6px] rounded-[4px] py-[1px] text-left hover:bg-mg-hover"
      >
        {content}
      </button>
    </li>
  );
}
