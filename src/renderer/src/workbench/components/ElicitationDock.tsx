import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { ElicitationRequest } from '@shared/elicitation';
import { useWorkbenchStore } from '../workbenchStore';
import { usePaneTabId } from '../paneContext';
import { DISCLOSURE_VARIANTS } from '../motionPresets';
import { formErrors, initialValues, toContent, type FormValues } from '../elicitationForm';

// Formulario de un servidor MCP (elicitation) anclado encima del input, como la pregunta del agente.
// Se genera del esquema acotado de `@shared/elicitation`; los valores solo viajan por IPC a main.

const BUTTON = 'rounded-[7px] border border-mg-border-emph px-[11px] py-[5px] text-[11.5px] text-mg-body2 hover:bg-mg-hover';
const INPUT = 'rounded-[6px] border border-mg-border-emph bg-mg-window px-[8px] py-[4px] text-[12px] text-mg-body outline-none focus-visible:border-mg-focus';

type FormRequest = Extract<ElicitationRequest, { mode: 'form' }>;

export function ElicitationDock(): React.JSX.Element {
  const tabId = usePaneTabId();
  const pending = useWorkbenchStore((s) => s.elicitationsByChat[tabId]?.find((e) => e.state === 'pending')?.request ?? null);
  return (
    <AnimatePresence initial={false}>
      {pending !== null && <ElicitationBody key={pending.requestId} request={pending} tabId={tabId} />}
    </AnimatePresence>
  );
}

function ElicitationBody({ request, tabId }: { readonly request: ElicitationRequest; readonly tabId: string }): React.JSX.Element {
  const answer = useWorkbenchStore((s) => s.answerElicitation);
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<FormValues>(() => (request.mode === 'form' ? initialValues(request.schema) : {}));
  const [error, setError] = useState<string | null>(null);
  const errors = request.mode === 'form' ? formErrors(request.schema, values) : {};
  const blocked = Object.keys(errors).length > 0;

  // Toma el foco al aparecer solo con el input vacío: si el usuario escribía, no se le roba.
  useEffect(() => {
    const draft = useWorkbenchStore.getState().draftByChat[tabId]?.text ?? '';
    if (draft.trim().length === 0) ref.current?.focus();
  }, [tabId]);

  const send = (action: 'accept' | 'decline' | 'cancel'): void => {
    setError(null);
    const content = action === 'accept' && request.mode === 'form' ? toContent(request.schema, values) : undefined;
    answer(tabId, { requestId: request.requestId, action, ...(content === undefined ? {} : { content }) }).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  return (
    <motion.div variants={DISCLOSURE_VARIANTS} initial="initial" animate="animate" exit="exit" className="overflow-hidden px-[22px] pt-[8px]">
      <div
        ref={ref}
        tabIndex={-1}
        role="group"
        aria-label={`Formulario de ${request.server}`}
        data-elicitation-dock="true"
        onKeyDown={(e) => {
          // `Esc` es el `session.interrupt` global: dentro del formulario cancela solo el formulario.
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            send('cancel');
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !blocked) {
            e.preventDefault();
            send('accept');
          }
        }}
        className="flex flex-col gap-[10px] rounded-[11px] border border-mg-border-emph bg-mg-panel p-[12px] outline-none focus-visible:border-mg-focus"
      >
        <div className="text-[11px] text-mg-sec">
          El servidor MCP <strong>{request.server}</strong> pide datos
        </div>
        <div className="text-[12.5px] leading-[1.5] text-mg-body">{request.message}</div>
        {request.mode === 'form' ? (
          <FormFields request={request} values={values} errors={errors} onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))} />
        ) : (
          <div className="break-all font-mono text-[11px] text-mg-sec">{request.url} (sin verificar; se abre en el navegador si aceptas)</div>
        )}
        {error !== null && (
          <div role="alert" className="text-[10.5px] text-mg-danger">
            {error}
          </div>
        )}
        <div className="flex gap-[8px]">
          <button type="button" disabled={blocked} onClick={() => send('accept')} className={`${BUTTON} disabled:opacity-50`}>
            Aceptar
          </button>
          <button type="button" onClick={() => send('decline')} className={BUTTON}>
            Rechazar
          </button>
          <button type="button" onClick={() => send('cancel')} className={BUTTON}>
            Cancelar
          </button>
        </div>
      </div>
    </motion.div>
  );
}

interface FieldsProps {
  readonly request: FormRequest;
  readonly values: FormValues;
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (name: string, value: string) => void;
}

function FormFields({ request, values, errors, onChange }: FieldsProps): React.JSX.Element {
  const prefix = useId();
  const required = new Set(request.schema.required ?? []);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  return (
    <div className="flex flex-col gap-[8px]">
      {Object.entries(request.schema.properties).map(([name, field]) => {
        const id = `${prefix}-${name}`;
        const label = `${field.title ?? name}${required.has(name) ? ' *' : ''}`;
        const shown = touched.has(name) ? errors[name] : undefined;
        const common = {
          id,
          'aria-invalid': shown !== undefined,
          'aria-describedby': shown === undefined ? undefined : `${id}-err`,
          onBlur: () => setTouched((t) => new Set(t).add(name)),
        };
        return (
          <div key={name} className="flex flex-col gap-[3px]">
            {field.type === 'boolean' ? (
              <label className="flex items-center gap-[6px] text-[12px] text-mg-body2">
                <input {...common} type="checkbox" checked={values[name] === 'true'} onChange={(e) => onChange(name, String(e.target.checked))} />
                {label}
              </label>
            ) : (
              <>
                <label htmlFor={id} className="text-[11.5px] text-mg-body2">
                  {label}
                </label>
                {field.type === 'string' && field.enum !== undefined ? (
                  <select {...common} className={INPUT} value={values[name] ?? ''} onChange={(e) => onChange(name, e.target.value)}>
                    {field.enum.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...common}
                    className={INPUT}
                    value={values[name] ?? ''}
                    autoComplete="off"
                    spellCheck={false}
                    type={field.type === 'string' ? (field.format === 'password' ? 'password' : 'text') : 'number'}
                    onChange={(e) => onChange(name, e.target.value)}
                  />
                )}
              </>
            )}
            {field.description !== undefined && <div className="text-[10.5px] text-mg-ter">{field.description}</div>}
            {shown !== undefined && (
              <div id={`${id}-err`} role="alert" className="text-[10.5px] text-mg-danger">
                {shown}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
