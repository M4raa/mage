import { useEffect, useMemo, useState } from 'react';
import { useWorkbenchStore } from '../workbenchStore';
import { useT } from '../../i18n/uiLanguage';
import { displayTitle } from '../conversationTitle';
import type { Translate } from '@shared/i18n/translator';
import { usePaneTabId, usePaneTranscriptStore } from '../paneContext';
import { useStickToBottom } from '../useStickToBottom';
import { activityStepLabel, activityTurns, runningStepId, runsText, type ActivityTurn } from '../chatVisibility';
import { formatElapsed } from '../thinkingStatus';
import { subagentStatusLabel } from '../engineBlocks';
import { Hint } from './TranscriptHint';
import { Icon } from './Icon';
import { ToolBody } from './ToolDetail';
import { SubagentTranscriptView } from './SubagentTranscriptView';
import type { Block } from '../types';
import { conversationIdOfTab } from '../conversationId';

// Panel «Actividad» (P-026 3.4, D21–D24): lo que el agente HACE, paso a paso y por turnos, mientras el
// chat se queda con lo que se dice. Sigue a la pestaña activa, como el resto de paneles globales. Lee
// `blocksByChat` (en vivo, con el texto del pensamiento; las `entries` del disco lo traen vacio).
//
// Lista de filas FIJAS y detalle debajo, como Logs: filas desplegables en una lista ya se solaparon una
// vez. Sin virtualizar. ponytail: DOM plano; react-window si una conversacion pasa de miles de pasos.
type SubagentBlock = Extract<Block, { kind: 'subagent' }>;

const EMPTY: readonly Block[] = [];

// Fondo del paso en marcha: el acento de la cuenta muy diluido (la unica familia cromatica permitida) sobre
// el panel, de modo que sirve igual en tema claro y oscuro.
const LIVE_ROW_BG_PERCENT = 14;
const LIVE_ICON_BOX_PX = 16;

export function ActivityPanel(): React.JSX.Element {
  const t = useT();
  const tabId = usePaneTabId();
  const tab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === tabId));
  const blocks = useWorkbenchStore((s) => s.blocksByChat[tabId] ?? EMPTY);
  const filter = useWorkbenchStore((s) => s.activitySubagentByChat[tabId] ?? null);
  const status = useWorkbenchStore((s) => s.statusByChat[tabId] ?? 'idle');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const turnLive = status === 'streaming' || status === 'needs_permission';
  // #26: una conversación reabierta saca sus pasos de la transcripción: mientras se lee, o si falla, el
  // panel lo dice en vez de «sin actividad».
  const useTranscript = usePaneTranscriptStore();
  const transcriptFinal = useTranscript((s) => s.isFinal);
  const transcriptError = useTranscript((s) => s.errorMessage);
  // Acento de la cuenta de ESTA pestaña, como el chat (BlockChat): el turno activo y su paso en marcha lo llevan.
  const accent = useWorkbenchStore((s) => s.accounts.find((a) => a.id === tab?.accountId)?.accent.base ?? 'var(--color-mg-fill)');

  const subagent = useMemo(() => findSubagent(blocks, filter), [blocks, filter]);
  const turns = useMemo(() => activityTurns(filter === null ? blocks : blocksOfSubagent(blocks, filter)), [blocks, filter]);
  const activeTurn = turns.length > 0 ? turns[turns.length - 1] : undefined;
  const activeRunningId = activeTurn === undefined ? null : runningStepId(activeTurn, turnLive);
  const stepCount = turns.reduce((n, t) => n + t.steps.length, 0);
  const { ref, onScroll } = useStickToBottom([stepCount, turnLive, tabId, filter]);

  // Al cambiar de pestaña o de filtro, la fila de antes ya no esta en la lista.
  useEffect(() => setSelectedId(null), [tabId, filter]);

  if (tab === undefined) return <Hint text={t('chat.activity.noConversation')} />;
  const selected = selectedId === null ? undefined : blocks.find((b) => b.id === selectedId);
  return (
    <div data-panel="activity" className="relative flex h-full min-h-0 flex-col">
      <ActivityHeader tabId={tabId} title={displayTitle(tab.title, t)} subagent={subagent} />
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto py-[4px]">
        {stepCount === 0 && <Hint text={emptyActivityText(t, { turnLive, resumed: tab.resumeSessionId !== undefined, transcriptFinal, transcriptError })} />}
        {turns.map((turn) => (
          <TurnSection
            key={turn.turnIndex}
            turn={turn}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
            live={turnLive && turn === activeTurn}
            runningId={turn === activeTurn ? activeRunningId : null}
            accent={accent}
          />
        ))}
      </div>
      {selected !== undefined && <StepDetail block={selected} onClose={() => setSelectedId(null)} />}
      {subagent !== null && <SubagentOverlay tabId={tabId} subagent={subagent} />}
    </div>
  );
}

// Lo que dice Actividad sin pasos que enseñar (#26): nunca «sin actividad» mientras carga o tras un error.
function emptyActivityText(
  t: Translate,
  state: {
  readonly turnLive: boolean;
  readonly resumed: boolean;
  readonly transcriptFinal: boolean;
  readonly transcriptError: string | null;
  },
): string {
  if (state.turnLive) return t('chat.activity.waitingFirstStep');
  if (state.resumed && state.transcriptError !== null) return t('chat.activity.loadError', { error: state.transcriptError });
  if (state.resumed && !state.transcriptFinal) return t('chat.activity.loading');
  return t('chat.activity.empty');
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
  const t = useT();
  const openActivity = useWorkbenchStore((s) => s.openActivity);
  return (
    <div className="flex shrink-0 items-center gap-[6px] border-b border-mg-border-subtle px-[10px] py-[6px] text-[10.5px]">
      <span className="truncate text-mg-sec" data-activity-title>{title}</span>
      {subagent !== null && (
        <button
          onClick={() => openActivity(tabId, null)}
          data-activity-filter
          data-tip={t('chat.activity.showAllSteps')}
          className="ml-auto flex shrink-0 items-center gap-[4px] rounded-[4px] bg-mg-sel px-[5px] py-[1px] text-[9.5px] text-mg-sel-ink hover:bg-mg-hover"
        >
          <Icon name="toolAgent" size={12} /> {subagent.agentType ?? t('chat.activity.subagentFallback')} <Icon name="close" size={10} />
        </button>
      )}
    </div>
  );
}

function TurnSection({
  turn,
  selectedId,
  onSelect,
  live,
  runningId,
  accent,
}: {
  readonly turn: ActivityTurn;
  readonly selectedId: string | null;
  readonly onSelect: (id: string) => void;
  // Es el turno que el agente esta ejecutando ahora; `runningId` el paso en marcha dentro de el.
  readonly live: boolean;
  readonly runningId: string | null;
  readonly accent: string;
}): React.JSX.Element {
  const t = useT();
  const n = turn.steps.length;
  return (
    <div>
      <div
        className={`sticky top-0 z-10 truncate bg-mg-panel px-[10px] py-[3px] text-[9.5px] font-semibold uppercase tracking-[0.04em] ${live ? '' : 'text-mg-ter'}`}
        style={live ? { color: accent } : undefined}
        data-activity-turn
        data-activity-live={live ? 'true' : undefined}
      >
        {t('chat.activity.turnHeader', { turn: turn.turnIndex, count: n })}
        {turn.userPreview.length > 0 && <span className="ml-[6px] font-normal normal-case tracking-normal text-mg-muted">{turn.userPreview}</span>}
      </div>
      {turn.steps.map((step) => (
        <StepRow key={step.id} block={step} selected={step.id === selectedId} onSelect={onSelect} running={step.id === runningId} accent={accent} />
      ))}
    </div>
  );
}

function StepRow({
  block,
  selected,
  onSelect,
  running,
  accent,
}: {
  readonly block: Block;
  readonly selected: boolean;
  readonly onSelect: (id: string) => void;
  readonly running: boolean;
  readonly accent: string;
}): React.JSX.Element {
  const label = activityStepLabel(block);
  return (
    <button
      onClick={() => onSelect(block.id)}
      data-activity-row={block.kind}
      data-activity-error={label.isError ? 'true' : undefined}
      data-activity-live={running ? 'true' : undefined}
      aria-pressed={selected}
      style={running ? { borderLeft: `2px solid ${accent}`, backgroundColor: `color-mix(in srgb, ${accent} ${LIVE_ROW_BG_PERCENT}%, transparent)` } : undefined}
      className={`flex h-[24px] w-full items-center gap-[7px] px-[10px] text-left font-mono text-[10.5px] ${running || selected ? (selected ? 'bg-mg-sel text-mg-sel-ink relative before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-[2px] before:bg-mg-sel-mark' : '') : 'hover:bg-mg-hover'} ${label.nested ? 'pl-[24px]' : ''}`}
    >
      <span
        data-tool-glyph
        className={`inline-flex flex-none items-center justify-center text-mg-ter ${running ? 'mg-pulse' : ''}`}
        style={{ width: LIVE_ICON_BOX_PX, height: LIVE_ICON_BOX_PX }}
      >
        <Icon name={label.icon} />
      </span>
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
  const t = useT();
  const label = activityStepLabel(block);
  return (
    <div className="flex min-h-0 shrink-0 basis-1/2 flex-col border-t border-mg-border bg-mg-code" data-activity-detail>
      <div className="flex shrink-0 items-center justify-between gap-[8px] border-b border-mg-border-subtle px-[10px] py-[5px] text-[10px] text-mg-ter">
        <span className="truncate font-mono">
          {label.name} · {label.detail}
        </span>
        <button
          onClick={onClose}
          aria-label={t('chat.activity.closeStepDetail')}
          data-tip={t('chat.activity.closeDetail')}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-mg-muted hover:text-mg-body"
        >
          <Icon name="close" size={10} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-[8px] text-[11px] text-mg-sec">
        <StepDetailBody block={block} />
      </div>
    </div>
  );
}

function StepDetailBody({ block }: { readonly block: Block }): React.JSX.Element {
  const t = useT();
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
      return <div className="whitespace-pre-wrap leading-[1.55]">{text.length > 0 ? text : t('chat.activity.thoughtNotSaved')}</div>;
    }
    case 'permission':
      return <PlainFacts facts={[
            [t('chat.activity.factAsked'), `${block.prompt} ${block.target}`],
            [t('chat.activity.factSummary'), block.summary],
            [t('chat.activity.factAnswer'), activityStepLabel(block).meta],
          ]} />;
    case 'question':
      return <PlainFacts facts={block.questions.map((q) => [q.question, block.answers?.[q.question] ?? t('chat.activity.noAnswer')] as const)} />;
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
  const t = useT();
  const tabId = usePaneTabId();
  const openActivity = useWorkbenchStore((s) => s.openActivity);
  return (
    <div className="flex flex-col gap-[8px]">
      <PlainFacts
        facts={[
          [t('chat.activity.factType'), block.agentType ?? t('chat.activity.subagentFallback')],
          [t('chat.activity.factTask'), block.description ?? ''],
          [t('chat.activity.factStatus'), block.status === null ? t('chat.activity.statusRunning') : subagentStatusLabel(block.status, t)],
          [t('chat.activity.factDuration'), block.elapsedMs === null ? '' : formatElapsed(block.elapsedMs)],
        ]}
      />
      <button
        onClick={() => openActivity(tabId, block.toolUseId)}
        className="w-fit rounded-[6px] border border-mg-border-ctrl px-[9px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
      >
        {t('chat.activity.showOnlyItsSteps')}
      </button>
    </div>
  );
}

// Filtrado a un subagente con su transcripcion ya localizable (`agentId`): un boton monta el overlay de
// siempre. El overlay es `absolute inset-0`, por eso el panel es `relative`.
function SubagentOverlay({ tabId, subagent }: { readonly tabId: string; readonly subagent: SubagentBlock }): React.JSX.Element | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  const tab = useWorkbenchStore((s) => s.tabs.find((tb) => tb.id === tabId));
  const sessionId = useWorkbenchStore((s) => (tab === undefined ? undefined : conversationIdOfTab(tab, s.sessionIdByChat[tabId])));
  useEffect(() => setOpen(false), [subagent.toolUseId]);
  if (subagent.agentId === null || tab === undefined || sessionId === undefined) return null;
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="shrink-0 border-t border-mg-border-subtle px-[10px] py-[5px] text-left text-[10.5px] text-mg-body2 hover:bg-mg-hover"
      >
        {t('chat.activity.fullSubagentTranscript')}
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
