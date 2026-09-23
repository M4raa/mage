import { useState } from 'react';
import { Icon } from './Icon';
import { buildAnswers, type AskQuestion } from '@shared/askUserQuestion';
import type { Block } from '../types';

// Tarjeta de pregunta del agente EN EL CHAT (2.3, AskUserQuestion). La decision del usuario fue esta y
// no un panel lateral: la pregunta es parte de la conversacion, no un permiso que autorizar.
//
// Invariante que NO se puede romper: la peticion sigue siendo un `can_use_tool` y se contesta
// EXACTAMENTE UNA VEZ. Por eso, mientras esta tarjeta esta `pending`, el panel de permiso no ofrece
// Permitir/Denegar para su requestId (ver PermissionPanel): contestar dos veces hace que
// `AgentSession.answerPermission` lance y la pestaña se vaya a error.
//
// Solo se pintan campos VALIDADOS (`question`, `header`, `label`, `description`), nunca el `input`
// crudo del control_request: puede traer cualquier cosa.
export function QuestionCard({
  block,
  onAnswer,
  onDeny,
}: {
  readonly block: Extract<Block, { kind: 'question' }>;
  readonly onAnswer: (answers: Readonly<Record<string, string>>) => void;
  readonly onDeny: () => void;
}): React.JSX.Element {
  // Una lista de etiquetas elegidas POR PREGUNTA (con multiSelect puede haber varias) + el texto libre
  // de "Otro", que se trata como una etiqueta mas al construir la respuesta.
  const [chosen, setChosen] = useState<readonly (readonly string[])[]>(() => block.questions.map(() => []));
  const [other, setOther] = useState<readonly string[]>(() => block.questions.map(() => ''));
  const [error, setError] = useState<string | null>(null);
  // UNA pregunta a la vez (buzon del usuario): el CLI manda el stack ENTERO en una sola llamada a
  // AskUserQuestion, y pintarlo entero era un muro de opciones. El protocolo obliga a responder todas
  // juntas —la respuesta viaja como `updatedInput = {...input, answers}`—, asi que las respuestas se
  // van acumulando y el envio sigue siendo uno solo al terminar la ultima.
  const [step, setStep] = useState(0);

  const answered = block.state === 'answered';
  const cancelled = block.state === 'cancelled';

  const toggle = (index: number, label: string, multiSelect: boolean): void => {
    setError(null);
    setChosen((current) =>
      current.map((labels, i) => {
        if (i !== index) return labels;
        if (!multiSelect) return labels.includes(label) ? [] : [label];
        return labels.includes(label) ? labels.filter((l) => l !== label) : [...labels, label];
      }),
    );
  };

  const total = block.questions.length;
  const current = Math.min(step, total - 1);
  const visible = block.questions[current] === undefined ? [] : [[block.questions[current], current] as const];
  const esUltima = current >= total - 1;

  // Para avanzar hay que haber elegido algo en la pregunta actual (o escrito en "Otro"). Se valida
  // aqui y no solo al final: llegar a la ultima y que te mande de vuelta a la primera es peor.
  const respondida = (index: number): boolean =>
    (chosen[index] ?? []).length > 0 || (other[index] ?? '').trim().length > 0;

  const siguiente = (): void => {
    if (!respondida(current)) {
      setError(`Elige una opción en «${block.questions[current]?.header ?? ''}» para continuar`);
      return;
    }
    setError(null);
    setStep(current + 1);
  };

  const submit = (): void => {
    // El texto libre entra como una etiqueta mas: para la tool, "Otro" no es un caso especial.
    const withOther = chosen.map((labels, i) => {
      const free = (other[i] ?? '').trim();
      return free.length === 0 ? labels : [...labels, free];
    });
    try {
      onAnswer(buildAnswers(block.questions, withOther));
    } catch (err) {
      // Contrato de error explicito: se enseña el motivo (una pregunta sin responder), no se traga.
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="flex justify-start">
      <div
        className={`flex min-w-0 max-w-[92%] flex-col gap-[12px] rounded-[12px] border p-[12px_14px] ${
          cancelled ? 'border-mg-border bg-mg-block opacity-60' : 'border-mg-focus bg-mg-block'
        }`}
      >
        <div className="flex items-center gap-[8px] text-[9.5px] font-bold uppercase tracking-[.07em] text-mg-ter">
          <Icon name="question" />
          <span>{answered ? 'Pregunta respondida' : cancelled ? 'Pregunta cancelada' : 'El agente pregunta'}</span>
        </div>

        {/* Respondida o cancelada se enseñan TODAS: ahi ya no se navega, es el registro de lo que se
            contesto y partirlo en pasos obligaria a pasear por el historial para leerlo. */}
        {(answered || cancelled ? block.questions.map((q, i) => [q, i] as const) : visible).map(([question, index]) => (
          <QuestionGroup
            key={question.question}
            question={question}
            chosen={chosen[index] ?? []}
            other={other[index] ?? ''}
            disabled={answered || cancelled}
            answer={answered ? (block.answers?.[question.question] ?? null) : null}
            onToggle={(label) => toggle(index, label, question.multiSelect)}
            onOther={(value) => setOther((current) => current.map((v, i) => (i === index ? value : v)))}
          />
        ))}

        {error !== null && (
          <div role="alert" className="text-[10.5px] text-mg-danger">
            {error}
          </div>
        )}

        {!answered && !cancelled && (
          <div className="flex items-center gap-[8px]">
            {total > 1 && (
              <span className="font-mono text-[10px] tabular-nums text-mg-muted" aria-live="polite">
                {current + 1}/{total}
              </span>
            )}
            {current > 0 && (
              <button
                onClick={() => {
                  setError(null);
                  setStep(current - 1);
                }}
                className="rounded-[7px] border border-mg-border-ctrl px-[10px] py-[5px] text-[11px] text-mg-body2 hover:bg-mg-hover"
              >
                Atrás
              </button>
            )}
            <button
              onClick={esUltima ? submit : siguiente}
              className="rounded-[7px] border border-mg-border-emph bg-mg-sel px-[12px] py-[5px] text-[11.5px] text-mg-text hover:bg-mg-hover"
            >
              {esUltima ? 'Responder' : 'Siguiente'}
            </button>
            {/* Denegar equivale a "no contesto": el CLI lo tolera y el turno sigue. */}
            <button
              onClick={onDeny}
              className="rounded-[7px] border border-mg-border-ctrl px-[10px] py-[5px] text-[11px] text-mg-body2 hover:bg-mg-hover"
            >
              No contestar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Una pregunta con sus opciones. `radiogroup` cuando es de una sola respuesta y grupo de casillas
// cuando es multiSelect: son dos comportamientos distintos y el lector de pantalla tiene que decirlo.
function QuestionGroup({
  question,
  chosen,
  other,
  disabled,
  answer,
  onToggle,
  onOther,
}: {
  readonly question: AskQuestion;
  readonly chosen: readonly string[];
  readonly other: string;
  readonly disabled: boolean;
  readonly answer: string | null;
  readonly onToggle: (label: string) => void;
  readonly onOther: (value: string) => void;
}): React.JSX.Element {
  const role = question.multiSelect ? 'group' : 'radiogroup';
  return (
    <div className="flex flex-col gap-[7px]">
      <div className="text-[9.5px] font-bold uppercase tracking-[.06em] text-mg-ter">{question.header}</div>
      <div className="text-[12px] leading-[1.5] text-mg-text">{question.question}</div>
      {answer !== null ? (
        <div className="text-[11.5px] text-mg-body2">↳ {answer}</div>
      ) : (
        <>
          <div role={role} aria-label={question.header} className="flex flex-col gap-[5px]">
            {question.options.map((option) => {
              const selected = chosen.includes(option.label);
              return (
                <button
                  key={option.label}
                  role={question.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => onToggle(option.label)}
                  className={`flex flex-col items-start gap-[2px] rounded-[8px] border p-[7px_10px] text-left transition-colors duration-150 disabled:opacity-50 ${
                    selected ? 'border-mg-focus bg-mg-sel' : 'border-mg-border-ctrl hover:bg-mg-hover'
                  }`}
                >
                  <span className="text-[11.5px] text-mg-text">{option.label}</span>
                  {option.description.length > 0 && (
                    <span className="text-[10.5px] leading-[1.45] text-mg-muted">{option.description}</span>
                  )}
                </button>
              );
            })}
          </div>
          {/* Opcion libre: el usuario pidio poder contestar algo que no esta en la lista. */}
          <input
            value={other}
            disabled={disabled}
            onChange={(e) => onOther(e.target.value)}
            aria-label={`Otra respuesta para: ${question.header}`}
            placeholder="Otro…"
            className="rounded-[7px] border border-mg-border-ctrl bg-mg-code p-[5px_9px] text-[11px] text-mg-text placeholder:text-mg-muted disabled:opacity-50"
          />
        </>
      )}
    </div>
  );
}
