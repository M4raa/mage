import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { AskQuestion } from '@shared/askUserQuestion';
import { Icon } from './Icon';
import { headPermission, isPermissionSending, useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { DISCLOSURE_VARIANTS } from '../motionPresets';
import { t as translate, useT } from '../../i18n/uiLanguage';
import { describeError } from '../describeError';
import type { Block } from '../types';
import {
  goTo,
  initialFlow,
  isAnswered,
  isLast,
  isSkipped,
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
// P-038 V5: pasos clicables arriba, «Otra cosa» como una opción más, círculo/casilla según el tipo y
// «Responder» siempre activo (lo no contestado sale como omitido).
type QuestionBlock = Extract<Block, { kind: 'question' }>;

// Lo recibe el modelo (regla: el idioma de la interfaz no cambia lo que se le envía): no se traduce.
const DENY_MESSAGE = 'El usuario no contestó la pregunta.';

// Fila de opción y de «Otra cosa»: la MISMA caja, para que «Otra cosa» no parezca otro control.
const ROW_CLASS = 'flex w-full items-start gap-[9px] rounded-[8px] border p-[6px_8px] text-left transition-colors duration-90';
const ROW_SELECTED = 'border-mg-focus bg-mg-sel text-mg-sel-ink';
const ROW_HIGHLIGHTED = 'border-mg-border-emph';
const ROW_IDLE = 'border-transparent hover:bg-mg-hover';

// Respuestas a medias por pregunta pendiente (P-038): el dock se desmonta al cambiar de chat y su estado local se
// perdía. Se guarda por `requestId` y se borra al contestar o cerrar.
// ponytail: una pregunta que el CLI retira sin contestarse deja su entrada (unos bytes); si molestara, limpiar en `permission_cancelled`.
const SAVED_FLOWS = new Map<string, QuestionFlowState>();

export function QuestionDock(): React.JSX.Element {
  const tabId = usePaneTabId();
  const block = useWorkbenchStore((s) => pendingQuestionBlock(headPermission(s, tabId)?.requestId, s.blocksByChat[tabId]));
  return (
    <AnimatePresence initial={false}>
      {block !== null && <QuestionDockBody key={block.requestId} block={block} tabId={tabId} />}
    </AnimatePresence>
  );
}

// El panel del split donde esta el usuario: solo ahi puede una pregunta tomar el foco (#58).
function isActivePane(tabId: string): boolean {
  return useWorkbenchStore.getState().activeTabId === tabId;
}

function pendingQuestionBlock(requestId: string | undefined, blocks: readonly Block[] | undefined): QuestionBlock | null {
  if (requestId === undefined || blocks === undefined) return null;
  const found = blocks.find((b): b is QuestionBlock => b.kind === 'question' && b.requestId === requestId && b.state === 'pending');
  return found ?? null;
}

function rowStateClass(selected: boolean, highlighted: boolean): string {
  if (selected) return ROW_SELECTED;
  return highlighted ? ROW_HIGHLIGHTED : ROW_IDLE;
}

function QuestionDockBody({ block, tabId }: { readonly block: QuestionBlock; readonly tabId: string }): React.JSX.Element {
  const answerQuestion = useWorkbenchStore((s) => s.answerQuestion);
  const answerPermissionFor = useWorkbenchStore((s) => s.answerPermissionFor);
  // La respuesta va de camino a main: el dock queda quieto hasta que `permission_resolved` lo cierre.
  const sending = useWorkbenchStore((s) => isPermissionSending(s, tabId, block.requestId));
  const [state, setState] = useState<QuestionFlowState>(() => SAVED_FLOWS.get(block.requestId) ?? initialFlow(block.questions));
  useEffect(() => {
    SAVED_FLOWS.set(block.requestId, state);
  }, [block.requestId, state]);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const question = block.questions[state.step] ?? block.questions[0];

  // Toma el foco al aparecer SOLO con el input vacio y en el panel activo: si el usuario estaba
  // escribiendo, aqui o en el otro lado del split (#58), no se le roba.
  useEffect(() => {
    const draft = useWorkbenchStore.getState().draftByChat[tabId]?.text ?? '';
    if (isActivePane(tabId) && draft.trim().length === 0) ref.current?.focus();
  }, [tabId]);

  // #60: «Otra cosa» es la ultima parada de las flechas; al llegar ahi se escribe en su input.
  const focusOther = (): void => ref.current?.querySelector<HTMLInputElement>(`input[aria-label="${translate('prompt.question.other')}"]`)?.focus();
  useEffect(() => {
    if (question !== undefined && state.cursor === question.options.length && isActivePane(tabId)) focusOther();
  }, [question, state.cursor, tabId]);
  if (question === undefined) return <></>;

  const submitWith = (answered: QuestionFlowState): void => {
    try {
      answerQuestion(block.requestId, toAnswers(answered, block.questions));
      SAVED_FLOWS.delete(block.requestId);
    } catch (err) {
      setError(err instanceof Error ? describeError(err) : String(err));
    }
  };
  // Omitir la ULTIMA contesta en el acto: no queda nada mas que recorrer.
  const onSkip = (): void => {
    const skipped = skip(state);
    setState(skipped);
    if (isLast(state)) submitWith(skipped);
  };
  const run = (action: FlowKeyAction): void => {
    setError(null);
    if (action.type === 'focus-other') focusOther();
    else if (action.type === 'close') {
      SAVED_FLOWS.delete(block.requestId);
      answerPermissionFor(tabId, { behavior: 'deny', message: DENY_MESSAGE }, block.requestId);
    }
    else if (action.type === 'submit') submitWith(state);
    else setState((current) => applyAction(current, action, question));
  };

  return (
    <motion.div variants={DISCLOSURE_VARIANTS} initial="initial" animate="animate" exit="exit" className="overflow-hidden px-[22px] pt-[8px]">
      <div
        ref={ref}
        tabIndex={-1}
        role="group"
        aria-label={translate('prompt.question.ariaLabel', { question: question.question })}
        data-question-dock="true"
        data-question-step={state.step}
        aria-busy={sending}
        data-permission-sending={sending ? 'true' : undefined}
        onKeyDown={(e) => {
          // El texto de «Otra cosa» es del input; solo ↑ al principio vuelve a las opciones (#60).
          if (e.target instanceof HTMLInputElement) {
            if (e.key !== 'ArrowUp' || e.target.selectionStart !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            setState((current) => ({ ...current, cursor: question.options.length - 1 }));
            ref.current?.focus();
            return;
          }
          const action = keyToAction(e.key, state, question);
          if (action === null) return;
          // `Esc` es el `session.interrupt` global y `1/2/3` los atajos de permiso: el dock se los queda.
          e.preventDefault();
          e.stopPropagation();
          run(action);
        }}
        className={`flex flex-col rounded-[11px] border border-mg-border-emph bg-mg-panel outline-none focus-visible:border-mg-focus ${sending ? 'pointer-events-none opacity-60' : ''}`}
      >
        {block.questions.length > 1 && <DockSteps questions={block.questions} state={state} onGo={(step) => setState((current) => goTo(current, step))} />}
        <DockHeader question={question} onClose={() => run({ type: 'close' })} />
        <DockOptions
          question={question}
          state={state}
          onToggle={(label) => run({ type: 'toggle', label })}
          onOther={(value) => setState((current) => setOther(current, question, value))}
        />
        <DockFooter last={isLast(state)} onSkip={onSkip} onNext={() => run({ type: 'next' })} onSubmit={() => run({ type: 'submit' })} />
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

// Pasos de arriba: uno por pregunta, con su `header`; se puede ir a cualquiera. ✓ = contestada, «–» = omitida.
function DockSteps({ questions, state, onGo }: { readonly questions: readonly AskQuestion[]; readonly state: QuestionFlowState; readonly onGo: (step: number) => void }): React.JSX.Element {
  const t = useT();
  return (
    <div role="tablist" aria-label={t('prompt.question.stepsAria')} className="flex items-center gap-[4px] overflow-x-auto border-b border-mg-border-subtle p-[6px_10px]">
      {questions.map((q, index) => {
        const current = index === state.step;
        const skipped = isSkipped(state, index);
        const answered = !skipped && isAnswered(state, index);
        return (
          <button
            key={index}
            role="tab"
            aria-selected={current}
            data-question-step-tab={index}
            data-answered={answered ? 'true' : undefined}
            onClick={() => onGo(index)}
            className={`flex flex-none items-center gap-[5px] rounded-full border px-[9px] py-[2px] text-[10.5px] transition-colors duration-90 ${
              current ? 'border-mg-focus bg-mg-sel text-mg-sel-ink' : 'border-mg-border-subtle text-mg-sec hover:bg-mg-hover'
            }`}
          >
            {answered && <Icon name="check" size={10} />}
            {skipped && <span aria-hidden="true">–</span>}
            <span className="max-w-[140px] truncate">{q.header.length > 0 ? q.header : t('prompt.question.counter', { step: index + 1, total: questions.length })}</span>
          </button>
        );
      })}
      <span data-question-counter="true" aria-live="polite" className="ml-auto flex-none pl-[6px] text-[10.5px] tabular-nums text-mg-muted">
        {t('prompt.question.counter', { step: state.step + 1, total: questions.length })}
      </span>
    </div>
  );
}

function DockHeader({ question, onClose }: { readonly question: AskQuestion; readonly onClose: () => void }): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex items-start gap-[10px] p-[10px_12px_4px]">
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <div className="text-[12px] font-semibold leading-[1.45] text-mg-text">{question.question}</div>
        <div data-question-kind={question.multiSelect ? 'multi' : 'single'} className="text-[10.5px] text-mg-muted">
          {question.multiSelect ? t('prompt.question.pickMany') : t('prompt.question.pickOne')}
        </div>
      </div>
      <button onClick={onClose} aria-label={t('prompt.question.dismiss')} data-tip={t('prompt.question.dismiss')} className="flex-none text-mg-muted hover:text-mg-body">
        <Icon name="close" size={12} label={t('prompt.question.dismiss')} />
      </button>
    </div>
  );
}

// Círculo (respuesta única) o casilla (varias), relleno si está elegido.
function ChoiceMark({ multi, selected }: { readonly multi: boolean; readonly selected: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-choice-mark={multi ? 'checkbox' : 'radio'}
      className={`mt-[2px] flex h-[14px] w-[14px] flex-none items-center justify-center border ${multi ? 'rounded-[4px]' : 'rounded-full'} ${
        selected ? 'border-mg-focus bg-mg-focus text-mg-panel' : 'border-mg-border-ctrl'
      }`}
    >
      {selected && (multi ? <Icon name="check" size={10} /> : <span className="h-[6px] w-[6px] rounded-full bg-mg-panel" />)}
    </span>
  );
}

function DockOptions({
  question,
  state,
  onToggle,
  onOther,
}: {
  readonly question: AskQuestion;
  readonly state: QuestionFlowState;
  readonly onToggle: (label: string) => void;
  readonly onOther: (value: string) => void;
}): React.JSX.Element {
  const chosen = state.chosen[state.step] ?? [];
  return (
    <div role={question.multiSelect ? 'group' : 'radiogroup'} aria-label={question.header} className="flex flex-col gap-[2px] p-[4px_8px_6px]">
      {question.options.map((option, index) => {
        const selected = chosen.includes(option.label);
        return (
          <button
            key={option.label}
            role={question.multiSelect ? 'checkbox' : 'radio'}
            aria-checked={selected}
            onClick={() => onToggle(option.label)}
            className={`${ROW_CLASS} ${rowStateClass(selected, index === state.cursor)}`}
          >
            <ChoiceMark multi={question.multiSelect} selected={selected} />
            <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
              <span className="text-[11.5px] text-mg-text">{option.label}</span>
              {option.description.length > 0 && <span className="text-[10.5px] leading-[1.45] text-mg-muted">{option.description}</span>}
            </span>
            {index < 9 && <span aria-hidden="true" className="flex-none font-mono text-[10px] text-mg-muted">{index + 1}</span>}
          </button>
        );
      })}
      <OtherRow question={question} value={state.other[state.step] ?? ''} highlighted={state.cursor === question.options.length} onChange={onOther} />
    </div>
  );
}

// «Otra cosa»: misma fila que una opción, con el texto dentro. Escribir la elige (y en respuesta única quita
// la opción marcada, `setOther`).
function OtherRow({ question, value, highlighted, onChange }: { readonly question: AskQuestion; readonly value: string; readonly highlighted: boolean; readonly onChange: (value: string) => void }): React.JSX.Element {
  const t = useT();
  const selected = value.trim().length > 0;
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div data-question-other="true" onClick={() => inputRef.current?.focus()} className={`${ROW_CLASS} cursor-text ${rowStateClass(selected, highlighted)}`}>
      <ChoiceMark multi={question.multiSelect} selected={selected} />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t('prompt.question.other')}
        placeholder={t('prompt.question.otherPlaceholder')}
        className="min-w-0 flex-1 bg-transparent text-[11.5px] text-mg-text outline-none placeholder:text-mg-muted"
      />
    </div>
  );
}

function DockFooter({ last, onSkip, onNext, onSubmit }: { readonly last: boolean; readonly onSkip: () => void; readonly onNext: () => void; readonly onSubmit: () => void }): React.JSX.Element {
  const t = useT();
  const secondary = 'rounded-[7px] border border-mg-border-ctrl px-[10px] py-[4px] text-[11px] text-mg-body2 hover:bg-mg-hover';
  return (
    <div className="flex items-center justify-end gap-[8px] border-t border-mg-border-subtle p-[7px_12px]">
      <button onClick={onSkip} className={secondary}>
        {t('prompt.question.skip')}
      </button>
      {!last && (
        <button onClick={onNext} className={secondary}>
          {t('prompt.question.advance')}
        </button>
      )}
      <button onClick={onSubmit} className="rounded-[7px] bg-mg-primary px-[11px] py-[4px] text-[11px] font-semibold text-mg-primary-ink">
        {t('prompt.question.submit')}
      </button>
    </div>
  );
}
