import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AskQuestion } from '@shared/askUserQuestion';
import { Icon } from './Icon';
import { headPermission, useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { DISCLOSURE_VARIANTS } from '../motionPresets';
import type { Block } from '../types';
import {
  canAdvance,
  initialFlow,
  isLast,
  keyToAction,
  next,
  prev,
  setOther,
  skip,
  toAnswers,
  toggle,
  type FlowKeyAction,
  type QuestionFlowState,
} from '../questionFlow';

// Pregunta del agente ANCLADA encima del input (P-026 3.3, captura retoques-alpha-5): en el hilo se iba
// con el scroll en cuanto el agente seguia trabajando. Mientras esta pendiente no se pinta nada en el
// chat (D16); el input sigue siendo independiente y su Enter no contesta esto (D15).
//
// Sigue siendo un `can_use_tool` que se contesta UNA vez: `✕` es el «no contestar» (deny) de siempre.
type QuestionBlock = Extract<Block, { kind: 'question' }>;

const DENY_MESSAGE = 'El usuario no contestó la pregunta.';

export function QuestionDock(): React.JSX.Element {
  const tabId = usePaneTabId();
  const block = useWorkbenchStore((s) => pendingQuestionBlock(headPermission(s, tabId)?.requestId, s.blocksByChat[tabId]));
  return (
    <AnimatePresence initial={false}>
      {block !== null && <QuestionDockBody key={block.requestId} block={block} tabId={tabId} />}
    </AnimatePresence>
  );
}

function pendingQuestionBlock(requestId: string | undefined, blocks: readonly Block[] | undefined): QuestionBlock | null {
  if (requestId === undefined || blocks === undefined) return null;
  const found = blocks.find((b): b is QuestionBlock => b.kind === 'question' && b.requestId === requestId && b.state === 'pending');
  return found ?? null;
}

function QuestionDockBody({ block, tabId }: { readonly block: QuestionBlock; readonly tabId: string }): React.JSX.Element {
  const answerQuestion = useWorkbenchStore((s) => s.answerQuestion);
  const answerPermissionFor = useWorkbenchStore((s) => s.answerPermissionFor);
  const [state, setState] = useState<QuestionFlowState>(() => initialFlow(block.questions));
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const question = block.questions[state.step] ?? block.questions[0];

  // Toma el foco al aparecer SOLO con el input vacio: si el usuario estaba escribiendo, no se le roba.
  useEffect(() => {
    const draft = useWorkbenchStore.getState().draftByChat[tabId]?.text ?? '';
    if (draft.trim().length === 0) ref.current?.focus();
  }, [tabId]);

  if (question === undefined) return <></>;

  const submit = (): void => {
    try {
      answerQuestion(block.requestId, toAnswers(state, block.questions));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  // Omitir la ULTIMA contesta en el acto: no queda nada mas que recorrer.
  const submitAfterSkip = (): void => {
    const skipped = skip(state);
    setState(skipped);
    try {
      answerQuestion(block.requestId, toAnswers(skipped, block.questions));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  const run = (action: FlowKeyAction): void => {
    setError(null);
    if (action.type === 'close') answerPermissionFor(tabId, { behavior: 'deny', message: DENY_MESSAGE }, block.requestId);
    else if (action.type === 'submit') submit();
    else setState((current) => applyAction(current, action, question));
  };

  return (
    <motion.div variants={DISCLOSURE_VARIANTS} initial="initial" animate="animate" exit="exit" className="overflow-hidden px-[22px] pt-[8px]">
      <div
        ref={ref}
        tabIndex={-1}
        role="group"
        aria-label={`Pregunta del agente: ${question.question}`}
        data-question-dock="true"
        data-question-step={state.step}
        onKeyDown={(e) => {
          if (e.target instanceof HTMLInputElement) return; // el texto de «Otra cosa» es del input
          const action = keyToAction(e.key, state, question);
          if (action === null) return;
          // `Esc` es el `session.interrupt` global y `1/2/3` los atajos de permiso: el dock se los queda.
          e.preventDefault();
          e.stopPropagation();
          run(action);
        }}
        className="flex flex-col rounded-[11px] border border-mg-border-emph bg-mg-panel outline-none focus-visible:border-mg-focus"
      >
        <DockHeader question={question} step={state.step} total={block.questions.length} onPrev={() => run({ type: 'prev' })} onNext={() => run({ type: 'next' })} onClose={() => run({ type: 'close' })} />
        <DockOptions question={question} state={state} onToggle={(label) => run({ type: 'toggle', label })} />
        <DockFooter
          other={state.other[state.step] ?? ''}
          last={isLast(state)}
          canAdvance={canAdvance(state)}
          onOther={(value) => setState((current) => setOther(current, value))}
          onSkip={() => (isLast(state) ? submitAfterSkip() : setState(skip))}
          onAdvance={() => run(isLast(state) ? { type: 'submit' } : { type: 'next' })}
        />
        {error !== null && (
          <div role="alert" className="px-[12px] pb-[8px] text-[10.5px] text-mg-danger">
            {error}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function applyAction(state: QuestionFlowState, action: FlowKeyAction, question: AskQuestion): QuestionFlowState {
  switch (action.type) {
    case 'toggle':
      return toggle(state, question, action.label);
    case 'cursor':
      return { ...state, cursor: action.index };
    case 'prev':
      return prev(state);
    case 'next':
      return next(state);
    default:
      return state;
  }
}

function DockHeader({
  question,
  step,
  total,
  onPrev,
  onNext,
  onClose,
}: {
  readonly question: AskQuestion;
  readonly step: number;
  readonly total: number;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-[10px] border-b border-mg-border-subtle p-[10px_12px]">
      <div className="min-w-0 flex-1 text-[12px] font-semibold leading-[1.45] text-mg-text">{question.question}</div>
      {total > 1 && (
        <div className="flex flex-none items-center gap-[4px] text-[10.5px] text-mg-muted">
          <button onClick={onPrev} aria-label="Pregunta anterior" className="px-[3px] hover:text-mg-body">‹</button>
          <span data-question-counter="true" aria-live="polite" className="tabular-nums">
            {step + 1} de {total}
          </span>
          <button onClick={onNext} aria-label="Pregunta siguiente" className="px-[3px] hover:text-mg-body">›</button>
        </div>
      )}
      <button onClick={onClose} aria-label="No contestar" data-tip="No contestar" className="flex-none text-mg-muted hover:text-mg-body">
        <Icon name="close" size={12} label="No contestar" />
      </button>
    </div>
  );
}

function DockOptions({
  question,
  state,
  onToggle,
}: {
  readonly question: AskQuestion;
  readonly state: QuestionFlowState;
  readonly onToggle: (label: string) => void;
}): React.JSX.Element {
  const chosen = state.chosen[state.step] ?? [];
  return (
    <div role={question.multiSelect ? 'group' : 'radiogroup'} aria-label={question.header} className="flex flex-col p-[6px_8px]">
      {question.options.map((option, index) => {
        const selected = chosen.includes(option.label);
        const highlighted = index === state.cursor;
        return (
          <button
            key={option.label}
            role={question.multiSelect ? 'checkbox' : 'radio'}
            aria-checked={selected}
            onClick={() => onToggle(option.label)}
            className={`flex items-start gap-[9px] rounded-[8px] border p-[6px_8px] text-left transition-colors duration-150 ${
              selected ? 'border-mg-focus bg-mg-sel' : highlighted ? 'border-mg-border-emph' : 'border-transparent hover:bg-mg-hover'
            }`}
          >
            <span className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] bg-mg-block font-mono text-[10px] text-mg-sec">
              {index + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-[1px]">
              <span className="text-[11.5px] text-mg-text">{option.label}</span>
              {option.description.length > 0 && <span className="text-[10.5px] leading-[1.45] text-mg-muted">{option.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DockFooter({
  other,
  last,
  canAdvance: ready,
  onOther,
  onSkip,
  onAdvance,
}: {
  readonly other: string;
  readonly last: boolean;
  readonly canAdvance: boolean;
  readonly onOther: (value: string) => void;
  readonly onSkip: () => void;
  readonly onAdvance: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-[8px] border-t border-mg-border-subtle p-[7px_12px]">
      <Icon name="pencil" size={12} />
      <input
        value={other}
        onChange={(e) => onOther(e.target.value)}
        aria-label="Otra cosa"
        placeholder="Otra cosa"
        className="min-w-0 flex-1 bg-transparent text-[11.5px] text-mg-text outline-none placeholder:text-mg-muted"
      />
      <button onClick={onSkip} className="rounded-[7px] border border-mg-border-ctrl px-[10px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover">
        Omitir
      </button>
      <button
        onClick={onAdvance}
        disabled={!ready}
        className="rounded-[7px] bg-mg-primary px-[11px] py-[4px] text-[11px] font-semibold text-mg-primary-ink disabled:opacity-40"
      >
        {last ? 'Responder' : 'Siguiente'}
      </button>
    </div>
  );
}
