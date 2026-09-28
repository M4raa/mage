import { useEffect, useMemo, useState } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { useStickToBottom } from '../useStickToBottom';
import { activityStepLabel, activityTurns, runsText, type ActivityTurn } from '../chatVisibility';
import { formatElapsed } from '../thinkingStatus';
import { Hint } from './TranscriptHint';
import { Icon } from './Icon';
import { ToolBody } from './ToolDetail';
import { SubagentTranscriptView } from './SubagentTranscriptView';
import type { Block } from '../types';

// Panel «Actividad» (P-026 3.4, D21–D24): lo que el agente HACE, paso a paso y por turnos, mientras el
// chat se queda con lo que se dice. Sigue a la pestaña activa, como el resto de paneles globales. Lee
// `blocksByChat` (en vivo, con el texto del pensamiento; las `entries` del disco lo traen vacio).
//
// Lista de filas FIJAS y detalle debajo, como Logs: filas desplegables en una lista ya se solaparon una
// vez. Sin virtualizar. ponytail: DOM plano; react-window si una conversacion pasa de miles de pasos.
type SubagentBlock = Extract<Block, { kind: 'subagent' }>;

const EMPTY: readonly Block[] = [];

export function ActivityPanel(): React.JSX.Element {
  const tabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const blocks = useWorkbenchStore((s) => s.blocksByChat[tabId] ?? EMPTY);
  const filter = useWorkbenchStore((s) => s.activitySubagentByChat[tabId] ?? null);
  const status = useWorkbenchStore((s) => s.statusByChat[tabId] ?? 'idle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const turnLive = status === 'streaming' || status === 'needs_permission';

  const subagent = useMemo(() => findSubagent(blocks, filter), [blocks, filter]);
  const turns = useMemo(() => activityTurns(filter === null ? blocks : blocksOfSubagent(blocks, filter)), [blocks, filter]);
  const stepCount = turns.reduce((n, t) => n + t.steps.length, 0);
  const { ref, onScroll } = useStickToBottom([stepCount, turnLive, tabId, filter]);

  // Al cambiar de pestaña o de filtro, la fila de antes ya no esta en la lista.
  useEffect(() => setSelectedId(null), [tabId, filter]);

  if (tab === undefined) return <Hint text="Abre una conversación para ver su actividad." />;
  const selected = selectedId === null ? undefined : blocks.find((b) => b.id === selectedId);
  return (
    <div data-panel="activity" className="relative flex h-full min-h-0 flex-col">
      <ActivityHeader tabId={tabId} title={tab.title} subagent={subagent} />
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto py-[4px]">
        {stepCount === 0 && <Hint text={turnLive ? 'Esperando el primer paso…' : 'Sin actividad todavía.'} />}
        {turns.map((turn) => (
          <TurnSection key={turn.turnIndex} turn={turn} selectedId={selectedId} onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))} />
        ))}
      </div>
      {selected !== undefined && <StepDetail block={selected} onClose={() => setSelectedId(null)} />}
      {subagent !== null && <SubagentOverlay tabId={tabId} subagent={subagent} />}
    </div>
  );
}

function findSubagent(blocks: readonly Block[], toolUseId: string | null): SubagentBlock | null {
  if (toolUseId === null) return null;
  return blocks.find((b): b is SubagentBlock => b.kind === 'subagent' && b.toolUseId === toolUseId) ?? null;
}

// Los pasos de UN subagente: su bloque y las herramientas que lanzo. Los `user` se conservan para cortar
// por turnos igual que la vista completa.
function blocksOfSubagent(blocks: readonly Block[], toolUseId: string): readonly Block[] {
  return blocks.filter(
    (b) => b.kind === 'user' || (b.kind === 'subagent' && b.toolUseId === toolUseId) || (b.kind === 'tool' && b.parentToolUseId === toolUseId),
  );
}

function ActivityHeader({ tabId, title, subagent }: { readonly tabId: string; readonly title: string; readonly subagent: SubagentBlock | null }): React.JSX.Element {
  const openActivity = useWorkbenchStore((s) => s.openActivity);
  return (
    <div className="flex shrink-0 items-center gap-[6px] border-b border-mg-border-subtle px-[10px] py-[6px] text-[10.5px]">
      <span className="truncate text-mg-sec" data-activity-title>{title}</span>
      {subagent !== null && (
        <button
          onClick={() => openActivity(tabId, null)}
          data-activity-filter
          data-tip="Ver todos los pasos"
          className="ml-auto flex shrink-0 items-center gap-[4px] rounded-[4px] bg-mg-sel px-[5px] py-[1px] text-[9.5px] text-mg-body hover:bg-mg-hover"
        >
          ⇲ {subagent.agentType ?? 'Subagente'} <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}

function TurnSection({
  turn,
  selectedId,
  onSelect,
}: {
  readonly turn: ActivityTurn;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
}): React.JSX.Element {
  const n = turn.steps.length;
  return (
    <div>
      <div className="sticky top-0 z-10 truncate bg-mg-panel px-[10px] py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.04em] text-mg-ter" data-activity-turn>
        Turno {turn.turnIndex} · {n} {n === 1 ? 'paso' : 'pasos'}
        {turn.userPreview.length > 0 && <span className="ml-[6px] font-normal normal-case tracking-normal text-mg-muted">{turn.userPreview}</span>}
      </div>
      {turn.steps.map((step) => (
        <StepRow key={step.id} block={step} selected={step.id === selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

function StepRow({ block, selected, onSelect }: { readonly block: Block; readonly selected: boolean; readonly onSelect: (id: string) => void }): React.JSX.Element {
  const label = activityStepLabel(block);
  return (
    <button
      onClick={() => onSelect(block.id)}
      data-activity-row={block.kind}
      data-activity-error={label.isError ? 'true' : undefined}
      aria-pressed={selected}
      className={`flex h-[24px] w-full items-center gap-[7px] px-[10px] text-left font-mono text-[10.5px] ${selected ? 'bg-mg-sel' : 'hover:bg-mg-hover'} ${label.nested ? 'pl-[24px]' : ''}`}
    >
      <span data-tool-glyph className="inline-flex w-[14px] flex-none justify-center text-mg-ter" aria-hidden="true">{label.glyph}</span>
      <span className="flex-none text-mg-body2">{label.name}</span>
      <span className="min-w-0 flex-1 truncate text-mg-sec" title={label.detail}>{label.detail}</span>
      <span className={`flex flex-none items-center gap-[3px] text-[9.5px] ${label.isError ? 'font-semibold text-mg-danger' : 'text-mg-muted'}`}>
        {label.isError && <Icon name="warning" size={10} />}
        {label.meta}
      </span>
    </button>
  );
}

function StepDetail({ block, onClose }: { readonly block: Block; readonly onClose: () => void }): React.JSX.Element {
  const label = activityStepLabel(block);
  return (
    <div className="flex min-h-0 shrink-0 basis-1/2 flex-col border-t border-mg-border bg-mg-code" data-activity-detail>
      <div className="flex shrink-0 items-center justify-between gap-[8px] border-b border-mg-border-subtle px-[10px] py-[5px] text-[10px] text-mg-ter">
        <span className="truncate font-mono">
          {label.name} · {label.detail}
        </span>
        <button
          onClick={onClose}
          aria-label="Cerrar el detalle del paso"
          data-tip="Cerrar el detalle"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-mg-muted hover:text-mg-body"
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-[8px] text-[11px] text-mg-sec">
        <StepDetailBody block={block} />
      </div>
    </div>
  );
}

function StepDetailBody({ block }: { readonly block: Block }): React.JSX.Element {
  switch (block.kind) {
    case 'tool':
      return (
        <div className="flex flex-col gap-[6px]">
          <pre className="whitespace-pre-wrap break-all font-mono text-[10.5px] text-mg-body2">{block.command}</pre>
          <ToolBody block={block} />
        </div>
      );
    case 'thinking': {
      const text = runsText(block.runs);
      // Una conversacion reanudada trae el pensamiento vacio (el CLI lo persiste con texto "").
      return <div className="whitespace-pre-wrap leading-[1.55]">{text.length > 0 ? text : 'Este pensamiento no se guardó: es de antes de que Mage empezara a conservarlos.'}</div>;
    }
    case 'permission':
      return <PlainFacts facts={[['Pidió', `${block.prompt} ${block.target}`], ['Resumen', block.summary], ['Respuesta', activityStepLabel(block).meta]]} />;
    case 'question':
      return <PlainFacts facts={block.questions.map((q) => [q.question, block.answers?.[q.question] ?? 'sin respuesta'] as const)} />;
    case 'subagent':
      return <SubagentFacts block={block} />;
    default:
      return <span />;
  }
}

function PlainFacts({ facts }: { readonly facts: readonly (readonly [string, string])[] }): React.JSX.Element {
  return (
    <dl className="flex flex-col gap-[6px]">
      {facts
        .filter(([, value]) => value.length > 0)
        .map(([key, value]) => (
          <div key={key}>
            <dt className="text-[10px] text-mg-ter">{key}</dt>
            <dd className="whitespace-pre-wrap text-mg-body2">{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function SubagentFacts({ block }: { readonly block: SubagentBlock }): React.JSX.Element {
  const tabId = usePaneTabId();
  const openActivity = useWorkbenchStore((s) => s.openActivity);
  return (
    <div className="flex flex-col gap-[8px]">
      <PlainFacts
        facts={[
          ['Tipo', block.agentType ?? 'Subagente'],
          ['Tarea', block.description ?? ''],
          ['Estado', block.status ?? 'en marcha'],
          ['Duración', block.elapsedMs === null ? '' : formatElapsed(block.elapsedMs)],
        ]}
      />
      <button
        onClick={() => openActivity(tabId, block.toolUseId)}
        className="w-fit rounded-[6px] border border-mg-border-ctrl px-[9px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
      >
        Ver solo sus pasos
      </button>
    </div>
  );
}

// Filtrado a un subagente con su transcripcion ya localizable (`agentId`): un boton monta el overlay de
// siempre. El overlay es `absolute inset-0`, por eso el panel es `relative`.
function SubagentOverlay({ tabId, subagent }: { readonly tabId: string; readonly subagent: SubagentBlock }): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const sessionId = useWorkbenchStore((s) => s.sessionIdByChat[tabId] ?? tab?.resumeSessionId);
  useEffect(() => setOpen(false), [subagent.toolUseId]);
  if (subagent.agentId === null || tab === undefined || sessionId === undefined) return null;
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 border-t border-mg-border-subtle px-[10px] py-[5px] text-left text-[10.5px] text-mg-body2 hover:bg-mg-hover"
      >
        Ver la transcripción completa del subagente ›
      </button>
    );
  }
  return (
    <SubagentTranscriptView
      // Config dir EFECTIVO: en una conversacion privada, su perfil `mage-private` (igual que SubagentBlock).
      accountDir={tab.resolvedConfigDir ?? tab.accountId}
      cwd={tab.cwd}
      sessionId={sessionId}
      subagent={{
        toolUseId: subagent.toolUseId,
        entryIndex: -1,
        agentType: subagent.agentType,
        description: subagent.description,
        agentId: subagent.agentId,
        status: subagent.status,
      }}
      onClose={() => setOpen(false)}
    />
  );
}
