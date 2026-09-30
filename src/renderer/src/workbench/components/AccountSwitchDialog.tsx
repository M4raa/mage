import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import type { AccountSwitchPrompt } from '../types';

// «¿Migrar la conversacion?» al pulsar otra cuenta con una conversacion PARADA abierta (P-026 2.7, D5).
// Sin «recordar mi eleccion» (D6): se pregunta cada vez. `Esc` cancela: ni se cambia de cuenta.
export function AccountSwitchDialog(): React.JSX.Element {
  const prompt = useWorkbenchStore((s) => s.accountSwitchPrompt);
  return <AnimatePresence>{prompt !== null && <AccountSwitchBody key="account-switch" prompt={prompt} />}</AnimatePresence>;
}

function AccountSwitchBody({ prompt }: { readonly prompt: AccountSwitchPrompt }): React.JSX.Element {
  const close = useWorkbenchStore((s) => s.closeAccountSwitchPrompt);
  const setActiveAccount = useWorkbenchStore((s) => s.setActiveAccount);
  const continueInAccount = useWorkbenchStore((s) => s.continueInAccount);
  const createConversation = useWorkbenchStore((s) => s.createConversation);
  const dest = useWorkbenchStore((s) => s.accounts.find((a) => a.id === prompt.destAccountId));
  const title = useWorkbenchStore((s) => s.tabs.find((t) => t.id === prompt.tabId)?.title ?? 'esta conversación');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogA11y({ onClose: close });
  const alias = dest?.alias ?? prompt.destAccountId;

  // Antes era «Solo cambiar de cuenta», pero desde que la cuenta activa sigue a la pestaña enfocada
  // (P-028, 26) ese cambio se deshacia al siguiente clic. Lo coherente es un chat nuevo en la destino.
  const newChatInDest = (): void => {
    close();
    setActiveAccount(prompt.destAccountId);
    void createConversation('shared');
  };
  const migrate = (): void => {
    setBusy(true);
    setError(null);
    continueInAccount(prompt.tabId, prompt.destAccountId)
      .then(close)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return (
    <motion.div
      variants={MODAL_SCRIM_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim"
      onClick={close}
    >
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-switch-title"
        data-account-switch-dialog="true"
        onClick={(e) => e.stopPropagation()}
        className="flex w-[420px] flex-col gap-[12px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="account-switch-title" className="text-[13px] font-bold text-mg-text">
          Cambiar a {alias}
        </div>
        <p className="leading-[1.5] text-mg-body2">
          «{title}» es de otra cuenta. ¿Te la llevas a <strong>{alias}</strong> para seguirla allí, o solo cambias de cuenta y
          la dejas donde está?
        </p>
        {/* P-028, 27: migrar no es lo mismo segun donde viva la conversacion. */}
        <p className="text-[11px] leading-[1.5] text-mg-muted">
          Compartida: se reanuda con {alias}. Privada: se mueve a {alias}.
        </p>
        {error !== null && (
          <div role="alert" className="text-[11px] text-mg-danger">
            No se pudo migrar: {error}
          </div>
        )}
        <div className="mt-[2px] flex justify-end gap-[8px]">
          <button
            onClick={newChatInDest}
            disabled={busy}
            className="rounded-[7px] border border-mg-border-emph px-[12px] py-[6px] text-mg-body2 hover:bg-mg-hover disabled:opacity-50"
          >
            Abrir un chat nuevo en {alias}
          </button>
          <button
            onClick={migrate}
            disabled={busy}
            className="rounded-[7px] bg-mg-primary px-[12px] py-[6px] font-semibold text-mg-primary-ink disabled:opacity-50"
          >
            {busy ? 'Migrando…' : `Migrar la conversación a ${alias}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
