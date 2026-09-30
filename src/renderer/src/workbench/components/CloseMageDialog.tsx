import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { CloseAnswer } from '@shared/ipc';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { countWorkingConversations } from '../backgroundWork';

// «¿Cerrar Mage?» (grupo B). Lo pide main al pulsar la X de la ultima ventana con «Preguntar» en
// Configuración › Almacenamiento; main sigue decidiendo (ocultar, salir, recordar) con lo que se
// conteste aqui. Lo que aporta frente al nativo: la estetica de Mage y decir CUANTAS conversaciones
// trabajan, que solo sabe el renderer. `Esc` o clic fuera = Cancelar (la unica respuesta sin efecto).
export function CloseMageDialog(): React.JSX.Element {
  const open = useWorkbenchStore((s) => s.closePromptOpen);
  return <AnimatePresence>{open && <CloseMageBody key="close-mage" />}</AnimatePresence>;
}

function CloseMageBody(): React.JSX.Element {
  const answerClosePrompt = useWorkbenchStore((s) => s.answerClosePrompt);
  const working = useWorkbenchStore((s) =>
    countWorkingConversations(
      s.tabs.map((tab) => s.statusByChat[tab.id]),
      Object.values(s.backgroundSessions),
    ),
  );
  const [remember, setRemember] = useState(false);
  const answer = (action: CloseAnswer['action']): void => answerClosePrompt({ action, remember });
  const cancel = (): void => answer('cancel');
  const dialogRef = useDialogA11y({ onClose: cancel });
  // La opcion que no corta nada lleva el foco inicial (y el Enter distraido). Va DESPUES del efecto del
  // hook, que ya guardo a quien devolverle el foco al cerrar y enfoco lo primero (la casilla).
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => primaryRef.current?.focus(), []);

  return (
    <motion.div
      variants={MODAL_SCRIM_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      // Por encima de Configuración (z-50) y del asistente de primer arranque (z-[60]): la X se puede
      // pulsar con cualquiera de los dos abierto.
      className="fixed inset-0 z-[70] flex items-center justify-center bg-mg-scrim"
      onClick={cancel}
    >
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-mage-title"
        aria-describedby="close-mage-body"
        data-close-mage-dialog="true"
        onClick={(e) => e.stopPropagation()}
        className="flex w-[440px] flex-col gap-[12px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="close-mage-title" className="text-[13px] font-bold text-mg-text">
          ¿Cerrar Mage?
        </div>
        <div id="close-mage-body" className="flex flex-col gap-[6px] leading-[1.55] text-mg-body2">
          <WorkingNotice working={working} />
          <p>En segundo plano, Mage sigue en la bandeja del sistema y los agentes siguen a lo suyo.</p>
          <p className="text-[11px] text-mg-muted">Puedes cambiarlo después en Configuración › Almacenamiento.</p>
        </div>
        <label className="inline-flex items-center gap-[7px] text-mg-body2">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Recordar mi decisión
        </label>
        <div className="mt-[2px] flex justify-end gap-[8px]">
          <DialogButton onClick={cancel}>Cancelar</DialogButton>
          <DialogButton onClick={() => answer('quit')}>Cerrar Mage</DialogButton>
          <DialogButton primary buttonRef={primaryRef} onClick={() => answer('hide')}>
            Mantener en segundo plano
          </DialogButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Con cero no se advierte de nada: cerrar no corta ningun trabajo.
function WorkingNotice({ working }: { readonly working: number }): React.JSX.Element | null {
  if (working === 0) return null;
  const plural = working !== 1;
  return (
    <p data-close-working={working} className="rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[8px_10px] text-mg-body">
      <strong>
        {working} conversaci{plural ? 'ones siguen' : 'ón sigue'} trabajando.
      </strong>{' '}
      Si cierras Mage, se para{plural ? 'n' : ''}.
    </p>
  );
}

export function DialogButton({
  primary = false,
  buttonRef,
  onClick,
  children,
}: {
  readonly primary?: boolean;
  readonly buttonRef?: React.Ref<HTMLButtonElement>;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const tone = primary ? 'bg-mg-sel font-bold text-mg-text' : 'text-mg-body';
  return (
    <button
      ref={buttonRef}
      onClick={onClick}
      className={`rounded-[7px] border border-mg-border-emph px-[12px] py-[6px] transition-colors duration-150 ease-out hover:bg-mg-hover ${tone}`}
    >
      {children}
    </button>
  );
}
