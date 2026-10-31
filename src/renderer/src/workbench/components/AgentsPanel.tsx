import { useMemo, useState } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { useT } from '../../i18n/uiLanguage';
import { usePaneTabId } from '../paneContext';
import type { SubagentInvocation } from '../subagentView';
import { conversationAgentRows, type AgentDockRow } from '../agentsDock';
import { formatElapsed } from '../thinkingStatus';
import { SubagentTranscriptView } from './SubagentTranscriptView';
import { AGENT_STATE_DOT, StopSubagentButton, useAgentElapsed } from './AgentsDock';
import { Hint } from './TranscriptHint';
import type { SubagentInfo } from '@shared/events';
import type { Block } from '../types';
import { conversationIdOfTab } from '../conversationId';

// Panel "Subagentes" (2.9.b), con las dos mitades que el usuario pidio:
//   - ARRIBA: los subagentes que el CLI DECLARA en su `initialize` (los abrio la Fase B; antes se
//     tiraban enteros).
//   - ABAJO: las INVOCACIONES de esta conversacion, con su drill-down a la transcripcion del subagente.
//     P-028 38: sale de los bloques EN VIVO (antes, de la transcripcion en disco, que no sabia de
//     segundo plano y pintaba «async_launched»), con estado, tipo, tarea, tiempo, tokens, herramientas
//     y modelo. Al reabrir, la hidratacion da los mismos bloques.
const NO_AGENTS: readonly SubagentInfo[] = [];
const NO_BLOCKS: readonly Block[] = [];
const MISSING = '—';

// Etiqueta de cada estado: guarda la CLAVE y se traduce al pintar la fila.
const STATE_LABEL_KEY = {
  running: 'chat.agents.stateRunning',
  done: 'chat.agents.stateDone',
  error: 'chat.agents.stateError',
  stopped: 'chat.agents.stateStopped',
} as const satisfies Readonly<Record<AgentDockRow['state'], string>>;

export function AgentsPanel(): React.JSX.Element {
  const t = useT();
  const tabId = usePaneTabId();
  const declared = useWorkbenchStore((s) => s.subagentsByChat[tabId] ?? NO_AGENTS);
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const sessionId = useWorkbenchStore((s) => {
    const found = s.tabs.find((t) => t.id === tabId);
    return found === undefined ? undefined : conversationIdOfTab(found, s.sessionIdByChat[tabId]);
  });
  // 4.1: los paneles globales siguen a la pestaña ACTIVA (`usePaneTabId` devuelve la activa fuera del centro).
  const blocks = useWorkbenchStore((s) => s.blocksByChat[tabId] ?? NO_BLOCKS);
  const invocations = useMemo(() => conversationAgentRows(blocks), [blocks]);
  const elapsedOf = useAgentElapsed(invocations);
  const [drilled, setDrilled] = useState<SubagentInvocation | null>(null);

  if (tab === undefined) return <Hint text={t('chat.agents.noConversation')} />;
  // Config dir EFECTIVO: en una conversacion privada la transcripcion del subagente vive bajo
  // `mage-private`, y con el de la cuenta se buscaria donde no esta.
  const accountDir = tab.resolvedConfigDir ?? tab.accountId;

  // Con un subagente abierto se pinta SOLO su transcripcion, en una caja `relative h-full`: la capa es
  // `absolute inset-0` y, dentro del scroller de la lista, se desplazaba con el contenido (punto 39).
  if (drilled !== null && sessionId !== undefined) {
    return (
      <div className="relative h-full min-h-0">
        <SubagentTranscriptView accountDir={accountDir} cwd={tab.cwd} sessionId={sessionId} subagent={drilled} onClose={() => setDrilled(null)} />
      </div>
    );
  }

  return (
    <div data-agents-panel="true" className="flex min-h-0 flex-col gap-[10px] overflow-y-auto p-[10px_12px]">
      <section className="flex flex-col gap-[4px]">
        <div className="text-[9.5px] font-bold uppercase tracking-[.07em] text-mg-ter">{t('chat.agents.declaredTitle', { count: declared.length })}</div>
        {declared.length === 0 ? (
          <div className="text-[11px] text-mg-muted">{t('chat.agents.noneDeclared')}</div>
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
          {t('chat.agents.inConversationTitle', { count: invocations.length })}
        </div>
        {invocations.length === 0 ? (
          <div className="text-[11px] text-mg-muted">{t('chat.agents.noneYet')}</div>
        ) : (
          <ul className="flex flex-col gap-[2px] text-[10.5px]">
            {invocations.map((row) => (
              <SubagentRow key={row.toolUseId} tabId={tabId} row={row} elapsedMs={elapsedOf(row)} onDrill={setDrilled} />
            ))}
          </ul>
        )}
      </section>

    </div>
  );
}

// Una invocacion. Con `agentId` es clicable (hay fichero que abrir); sin el, se ve pero no se abre: su
// transcripcion puede no existir todavia. Tokens «—» hasta que el CLI los cuente (38c).
function SubagentRow({
  tabId,
  row,
  elapsedMs,
  onDrill,
}: {
  readonly tabId: string;
  readonly row: AgentDockRow;
  readonly elapsedMs: number;
  readonly onDrill: (subagent: SubagentInvocation) => void;
}): React.JSX.Element {
  const t = useT();
  const content = (
    <>
      <span className="flex w-full items-baseline gap-[6px]">
        <span aria-hidden="true" className={`h-[7px] w-[7px] flex-none self-center rounded-full ${AGENT_STATE_DOT[row.state]}`} />
        <span className="min-w-0 truncate font-semibold text-mg-body2">{row.description ?? t('chat.agents.noDescription')}</span>
        <span className="shrink-0 rounded-[4px] bg-mg-sel px-[5px] py-[1px] text-[9px] text-mg-body">{row.name}</span>
        <span className="ml-auto shrink-0 text-mg-muted">{t(STATE_LABEL_KEY[row.state])}</span>
      </span>
      <span className="flex w-full gap-[10px] pl-[13px] font-mono text-[10px] text-mg-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <span>{formatElapsed(elapsedMs)}</span>
        <span>{t('chat.agents.tokensCount', { count: row.tokens === null ? MISSING : row.tokens.toLocaleString('es-ES') })}</span>
        <span>{t('chat.agents.toolsCount', { count: row.toolUses === null ? MISSING : String(row.toolUses) })}</span>
        <span className="truncate">{row.model ?? MISSING}</span>
      </span>
    </>
  );
  const agentId = row.agentId;
  if (agentId === null) {
    return <li data-agents-panel-row={row.state} className="flex flex-col gap-[1px] rounded-[4px] p-[3px_4px] opacity-70">{content}</li>;
  }
  const invocation: SubagentInvocation = { toolUseId: row.toolUseId, entryIndex: -1, agentType: row.name, description: row.description, agentId, status: row.state };
  // En marcha, «Parar» a la derecha (0.1.1 R2, punto 29): hermano del boton de la fila, no dentro.
  return (
    <li data-agents-panel-row={row.state} className="flex items-start gap-[2px]">
      <button
        onClick={() => onDrill(invocation)}
        data-tip={t('chat.agents.viewTranscript')}
        className="flex min-w-0 flex-1 flex-col gap-[1px] rounded-[4px] p-[3px_4px] text-left hover:bg-mg-hover"
      >
        {content}
      </button>
      {row.state === 'running' && <StopSubagentButton tabId={tabId} row={row} className="mt-[2px]" />}
    </li>
  );
}
