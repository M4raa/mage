import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { displayTitle } from '../conversationTitle';
import { useT } from '../../i18n/uiLanguage';
import { DialogButton } from './CloseMageDialog';

type CloseTabAction = 'cancel' | 'background' | 'stop';

// «¿Cerrar una conversación que está trabajando?»: sale al cerrar a mano una pestaña con un turno en marcha
// o un permiso pendiente mientras Configuración › Almacenamiento diga «Preguntar». `Esc` o clic fuera =
// Cancelar (la única respuesta que no guarda nada ni cierra).
export function CloseRunningTabDialog(): React.JSX.Element {
  const tabId = useWorkbenchStore((s) => s.closeTabPrompt?.tabId);
  return <AnimatePresence>{tabId !== undefined && <CloseRunningTabBody key="close-running-tab" tabId={tabId} />}</AnimatePresence>;
}

function CloseRunningTabBody({ tabId }: { readonly tabId: string }): React.JSX.Element {
  const t = useT();
  const answerCloseTabPrompt = useWorkbenchStore((s) => s.answerCloseTabPrompt);
  const title = useWorkbenchStore((s) => s.tabs.find((tab) => tab.id === tabId)?.title ?? '');
  const [remember, setRemember] = useState(false);
  const answer = (action: CloseTabAction): void => answerCloseTabPrompt({ action, remember });
  const cancel = (): void => answer('cancel');
  const dialogRef = useDialogA11y({ onClose: cancel });
  // Como en «¿Cerrar Mage?»: el foco inicial va al primario, DESPUÉS del efecto del hook (que enfoca la casilla).
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => primaryRef.current?.focus(), []);

  return (
    <motion.div
      variants={MODAL_SCRIM_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-mg-scrim"
      onClick={cancel}
    >
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-tab-title"
        aria-describedby="close-tab-body"
        data-close-tab-dialog="true"
        onClick={(e) => e.stopPropagation()}
        className="flex w-[440px] flex-col gap-[12px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="close-tab-title" className="text-[13px] font-bold text-mg-text">
          {t('dialogs.closeTab.title')}
        </div>
        <div id="close-tab-body" className="flex flex-col gap-[6px] leading-[1.55] text-mg-body2">
          <p>{t('dialogs.closeTab.body', { title: displayTitle(title, t) })}</p>
          <p className="text-[11px] text-mg-muted">{t('dialogs.closeTab.changeLater')}</p>
        </div>
        <label className="inline-flex items-center gap-[7px] text-mg-body2">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {t('dialogs.closeTab.remember')}
        </label>
        <div className="mt-[2px] flex justify-end gap-[8px]">
          <DialogButton onClick={cancel}>{t('dialogs.closeTab.cancel')}</DialogButton>
          <DialogButton onClick={() => answer('stop')} closeTabAction="stop">
            {t('dialogs.closeTab.stop')}
          </DialogButton>
          <DialogButton primary buttonRef={primaryRef} onClick={() => answer('background')} closeTabAction="background">
            {t('dialogs.closeTab.background')}
          </DialogButton>
        </div>
      </motion.div>
    </motion.div>
  );
}
