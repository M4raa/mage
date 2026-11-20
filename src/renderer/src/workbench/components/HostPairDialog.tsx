import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { HostClientKind, HostPairRequestView } from '@shared/hostClients';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { useT } from '../../i18n/uiLanguage';
import { DialogButton } from './CloseMageDialog';

// «¿Autorizas a … a controlar Mage?»: un cliente del host local (la terminal) pide emparejarse. Main decide y guarda;
// aquí solo se pregunta. `Esc` o clic fuera = Rechazar, que además lleva el foco inicial (un Enter distraído no
// concede nada). Con varias peticiones, se contestan de una en una.
export const HOST_CLIENT_KIND_KEY = {
  terminal: 'dialogs.hostPair.kind.terminal',
  mcp: 'dialogs.hostPair.kind.mcp',
  widget: 'dialogs.hostPair.kind.widget',
} as const satisfies Readonly<Record<HostClientKind, string>>;

export function HostPairDialog(): React.JSX.Element {
  const pending = useHostPairRequests();
  const current = pending[0];
  return <AnimatePresence>{current !== undefined && <HostPairBody key={current.requestId} request={current} />}</AnimatePresence>;
}

// Lo pendiente al montar (la ventana pudo crearse para preguntar) y cada cambio que publica main.
function useHostPairRequests(): readonly HostPairRequestView[] {
  const [pending, setPending] = useState<readonly HostPairRequestView[]>([]);
  useEffect(() => {
    let live = true;
    const unsubscribe = window.mage.onHostPairRequests((next) => setPending(next));
    void window.mage.getHostPairRequests()
      .then((initial) => { if (live) setPending(initial); })
      .catch((err: unknown) => console.warn('No se pudieron leer los emparejamientos pendientes:', err));
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);
  return pending;
}

function HostPairBody({ request }: { readonly request: HostPairRequestView }): React.JSX.Element {
  const t = useT();
  const answer = (approve: boolean): void => {
    void window.mage.answerHostPair({ requestId: request.requestId, approve })
      .catch((err: unknown) => console.warn('No se pudo contestar el emparejamiento:', err));
  };
  const reject = (): void => answer(false);
  const dialogRef = useDialogA11y({ onClose: reject });
  const rejectRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => rejectRef.current?.focus(), []);

  return (
    <motion.div variants={MODAL_SCRIM_VARIANTS} initial="initial" animate="animate" exit="exit" className="fixed inset-0 z-[70] flex items-center justify-center bg-mg-scrim" onClick={reject}>
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="host-pair-title"
        aria-describedby="host-pair-body"
        data-host-pair-dialog={request.requestId}
        onClick={(e) => e.stopPropagation()}
        className="flex w-[440px] flex-col gap-[12px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="host-pair-title" className="text-[13px] font-bold text-mg-text [overflow-wrap:anywhere]">
          {t('dialogs.hostPair.title', { name: request.clientName, kind: t(HOST_CLIENT_KIND_KEY[request.clientKind]) })}
        </div>
        <p id="host-pair-body" className="leading-[1.55] text-mg-body2">{t('dialogs.hostPair.body')}</p>
        <div className="mt-[2px] flex justify-end gap-[8px]">
          <DialogButton primary buttonRef={rejectRef} dialogAction="host-pair-reject" onClick={reject}>{t('dialogs.hostPair.reject')}</DialogButton>
          <DialogButton dialogAction="host-pair-approve" onClick={() => answer(true)}>{t('dialogs.hostPair.approve')}</DialogButton>
        </div>
      </motion.div>
    </motion.div>
  );
}
