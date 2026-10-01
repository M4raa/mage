import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { POPOVER_VARIANTS } from '../motionPresets';
import {
  STEP_SLIDER_POPOVER,
  stepFraction,
  stepIndexOf,
  stepSliderPlacement,
  stepValueAt,
  type SliderStep,
  type StepSliderPlacement,
} from '../stepSliderModel';

// Selector de pasos (P-028 32/33): un chip con la etiqueta actual que abre un popover con un deslizador
// de pasos —titulo, extremos y un punto por paso—. UN componente para modo de permiso y esfuerzo (en el
// chat y en Ajustes). Misma estructura de popover que `Dropdown`: portal a body, Escape/clic fuera.

export interface StepSliderProps {
  readonly steps: readonly SliderStep[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  // Nombre accesible del chip disparador.
  readonly ariaLabel: string;
  // Texto del chip (la etiqueta del paso actual, o el nombre crudo si el valor no esta en los pasos).
  readonly chipLabel: string;
  // Todas las etiquetas que puede llegar a tener el chip: reservan el ancho de la MAS LARGA para que ni el
  // chip ni el popover anclado a el se muevan al cambiar de paso.
  readonly chipSizers?: readonly string[];
  // Titulo del popover: «Esfuerzo Alto», «Modo Manual».
  readonly heading: string;
  // Etiquetas de los dos extremos de la escala.
  readonly endLabels: readonly [string, string];
  readonly tip?: string;
  // Una linea corta fija bajo el deslizador (p. ej. «se aplica al reabrir»).
  readonly note?: string;
  readonly triggerClassName?: string;
  readonly leading?: React.ReactNode;
}

export function StepSlider({
  steps,
  value,
  onChange,
  ariaLabel,
  chipLabel,
  chipSizers = [],
  heading,
  endLabels,
  tip,
  note,
  triggerClassName = '',
  leading,
}: StepSliderProps): React.JSX.Element {
  // Posicion del popover, fijada al abrir (null = cerrado): ver `stepSliderPlacement`.
  const [placement, setPlacement] = useState<StepSliderPlacement | null>(null);
  const open = placement !== null;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const index = stepIndexOf(steps, value);
  const known = index >= 0;

  const close = (): void => {
    setPlacement(null);
    triggerRef.current?.focus();
  };

  const toggle = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (open || rect === undefined) {
      setPlacement(null);
      return;
    }
    setPlacement(stepSliderPlacement(rect, { width: window.innerWidth, height: window.innerHeight }));
  };

  useEffect(() => {
    if (!open) return;
    rangeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Enter') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const current = steps[index];
  // Celda unica de `inline-grid`: las etiquetas invisibles fijan el ancho, la actual es la unica visible.
  const label = (
    <span className="inline-grid justify-items-center">
      {chipSizers.map((sizer) => (
        <span key={sizer} aria-hidden="true" className="invisible col-start-1 row-start-1">
          {sizer}
        </span>
      ))}
      <span className="col-start-1 row-start-1">{chipLabel}</span>
    </span>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-tip={tip}
        className={`shrink-0 cursor-pointer self-center rounded-full border border-mg-border-ctrl bg-transparent px-[8px] py-[2px] text-[10.5px] text-mg-sec outline-none transition-colors duration-150 ease-out hover:text-mg-body ${triggerClassName}`}
      >
        {leading === undefined ? (
          label
        ) : (
          // `flex` y no `inline-flex`: en la linea del boton se alineaba por la base del icono (su borde
          // inferior) y el chip media 24,1 px frente a 21,8 de los demas, descuadrando la fila del prompt.
          <span className="flex items-center gap-[5px]">
            {leading}
            <span className="truncate">{label}</span>
          </span>
        )}
      </button>
      {createPortal(
        // AnimatePresence DENTRO del portal (mismo motivo que en `Dropdown`).
        <AnimatePresence>
          {placement !== null && (
            <>
              <div className="fixed inset-0 z-[9998]" onClick={close} />
              <motion.div
                variants={POPOVER_VARIANTS}
                initial="initial"
                animate="animate"
                exit="exit"
                role="dialog"
                aria-label={heading}
                data-step-slider-popover="true"
                style={{ position: 'fixed', left: placement.left, ...placement.anchor, zIndex: 9999, width: STEP_SLIDER_POPOVER.widthPx }}
                className="rounded-[8px] border border-mg-border-pop bg-mg-popover p-[12px_14px] text-[11.5px] text-mg-body mg-shadow-pop"
              >
                <div className="mb-[10px] text-[12px] font-semibold">{heading}</div>
                <div className="relative">
                  <input
                    ref={rangeRef}
                    type="range"
                    min={0}
                    max={steps.length - 1}
                    step={1}
                    value={known ? index : 0}
                    data-unset={known ? undefined : 'true'}
                    aria-label={ariaLabel}
                    aria-valuetext={current?.label ?? chipLabel}
                    onChange={(e) => onChange(stepValueAt(steps, Number(e.target.value)))}
                    className="mg-step-slider"
                  />
                  {/* El pulgar que se VE (el nativo es transparente y solo recoge el arrastre): el nativo salta
                      de paso a paso, este se desliza. Su caja mide el RECORRIDO (ancho menos un pulgar), asi que
                      `translateX(fraccion * 100%)` lo lleva exactamente donde esta el nativo. */}
                  <div aria-hidden="true" data-unset={known ? undefined : 'true'} className="mg-step-thumb-track">
                    <div className="mg-step-thumb" style={{ transform: `translateX(${stepFraction(index, steps.length) * 100}%)` }}>
                      <span className="mg-step-thumb-dot" />
                    </div>
                  </div>
                  {/* Un punto por paso, alineado con el recorrido del pulgar (su mitad de ancho de margen). */}
                  <div aria-hidden="true" className="pointer-events-none flex justify-between px-[7px] pt-[2px]">
                    {steps.map((step, i) => (
                      <span key={step.value} className={`h-[4px] w-[4px] rounded-full ${i === index ? 'bg-mg-focus' : 'bg-mg-border-emph'}`} />
                    ))}
                  </div>
                </div>
                <div className="mt-[6px] flex justify-between text-[10.5px] text-mg-muted">
                  <span>{endLabels[0]}</span>
                  <span>{endLabels[1]}</span>
                </div>
                {note !== undefined && <div className="mt-[8px] text-[10.5px] leading-[1.4] text-mg-ter">{note}</div>}
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
