import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { countWorkingConversations } from '../backgroundWork';
import { DialogButton } from './CloseMageDialog';
import { Markdown } from './Markdown';

// «Mage X está lista para instalarse» (grupo B). Lo pide main a la ventana enfocada cuando la descarga
// termina, una vez por version; despues queda el indicador de la barra de estado, que lo reabre. Al
// reves que el de cierre, las dos respuestas son inocuas: `Esc` o clic fuera = «Más tarde», y la
// actualizacion se instala igual al cerrar Mage.
export function UpdateReadyDialog(): React.JSX.Element {
  const state = useWorkbenchStore((s) => s.updateState);
  const promptVersion = useWorkbenchStore((s) => s.updatePromptVersion);
  const open = state.kind === 'ready' && state.version === promptVersion;
  return (
    <AnimatePresence>
      {open && <UpdateReadyBody key={state.version} version={state.version} releaseNotes={state.releaseNotes} />}
    </AnimatePresence>
  );
}

function UpdateReadyBody({ version, releaseNotes }: { readonly version: string; readonly releaseNotes: string | null }): React.JSX.Element {
  const dismiss = useWorkbenchStore((s) => s.dismissUpdatePrompt);
  const install = useWorkbenchStore((s) => s.installUpdate);
  const working = useWorkbenchStore((s) =>
    countWorkingConversations(
      s.tabs.map((tab) => s.statusByChat[tab.id]),
      Object.values(s.backgroundSessions),
    ),
  );
  const dialogRef = useDialogA11y({ onClose: dismiss });
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => primaryRef.current?.focus(), []);

  return (
    <motion.div
      variants={MODAL_SCRIM_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-mg-scrim"
      onClick={dismiss}
    >
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-ready-title"
        data-update-ready-dialog="true"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[520px] flex-col gap-[12px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div>
          <div id="update-ready-title" className="text-[13px] font-bold text-mg-text">
            Mage {version} está lista para instalarse
          </div>
          <p className="mt-[4px] leading-[1.55] text-mg-body2">
            Se instala al reiniciar. Si prefieres seguir trabajando, se instalará sola la próxima vez que cierres Mage.
          </p>
        </div>
        <ReleaseNotesPreview releaseNotes={releaseNotes} />
        {working > 0 && (
          <p data-update-working={working} className="text-[11px] text-mg-muted">
            {working === 1 ? 'Hay 1 conversación trabajando: reiniciar la para.' : `Hay ${working} conversaciones trabajando: reiniciar las para.`}
          </p>
        )}
        <div className="mt-[2px] flex justify-end gap-[8px]">
          <DialogButton onClick={dismiss}>Más tarde</DialogButton>
          <DialogButton primary buttonRef={primaryRef} onClick={install}>
            Reiniciar ahora
          </DialogButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Las notas de la version que LLEGA vienen con la actualizacion (el changelog incrustado en esta build
// no las tiene todavia). Sin ellas, se dice donde se van a ver.
function ReleaseNotesPreview({ releaseNotes }: { readonly releaseNotes: string | null }): React.JSX.Element {
  if (releaseNotes === null) {
    return <p className="text-mg-muted">Verás sus novedades en cuanto Mage se abra actualizado.</p>;
  }
  return (
    <div
      data-update-notes="true"
      className="min-h-0 overflow-y-auto rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[10px_14px] text-[12px] leading-[1.6] text-mg-body"
    >
      <Markdown text={releaseNotes} />
    </div>
  );
}
