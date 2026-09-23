import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';

// Modal de PROMPT HANDOFF (M2.3): al abrirse genera —reanudando la sesion de la pestana activa— un
// prompt autocontenido para arrancar un chat nuevo que continue el trabajo. Muestra la preview
// EDITABLE con dos acciones: "Copiar" (portapapeles) y "Empezar nuevo chat con este prompt".
export function HandoffModal(): React.JSX.Element {
  const open = useWorkbenchStore((s) => s.handoffOpen);
  const closeHandoff = useWorkbenchStore((s) => s.closeHandoff);
  const activeTab = useWorkbenchStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const sessionId = useWorkbenchStore((s) => s.sessionIdByChat[s.activeTabId]);
  const startChatWithPrompt = useWorkbenchStore((s) => s.startChatWithPrompt);

  // Sesion a reanudar: la viva de la pestana o, si es una restaurada aun no usada, su resumeSessionId.
  const resumableId = sessionId ?? activeTab?.resumeSessionId ?? null;
  return (
    <AnimatePresence>
      {open && activeTab !== undefined && (
        <HandoffBody
          key="handoff"
          // Config dir EFECTIVO (perfil privado si la conversacion es privada) y cwd de la conversacion:
          // ambos son necesarios para que `claude --resume` encuentre la sesion (F3).
          accountDir={activeTab.resolvedConfigDir ?? activeTab.accountId}
          cwd={activeTab.cwd}
          model={activeTab.model}
          sessionId={resumableId}
          onClose={closeHandoff}
          onStartChat={async (prompt) => {
            closeHandoff();
            await startChatWithPrompt(prompt);
          }}
        />
      )}
    </AnimatePresence>
  );
}

// Cuerpo con estado propio: se monta solo cuando el modal esta abierto (genera al montar).
function HandoffBody({
  accountDir,
  cwd,
  model,
  sessionId,
  onClose,
  onStartChat,
}: {
  readonly accountDir: string;
  readonly cwd: string;
  readonly model: string;
  readonly sessionId: string | null;
  readonly onClose: () => void;
  readonly onStartChat: (prompt: string) => Promise<void>;
}): React.JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(true); // genera al montar
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useDialogA11y({ onClose });

  // Genera el handoff al montar (o al reintentar). Si no hay sesion reanudable, error explicito.
  useEffect(() => {
    let cancelled = false;
    if (sessionId === null) {
      setBusy(false);
      setError('Esta conversación aún no tiene una sesión que reanudar (envía al menos un mensaje).');
      return;
    }
    setBusy(true);
    setError(null);
    window.mage
      .generateHandoff({ sessionId, accountDir, model, cwd })
      .then((result) => {
        if (!cancelled) setPrompt(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, accountDir, model, cwd]);

  const copy = (): void => {
    void navigator.clipboard.writeText(prompt).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const canAct = !busy && error === null && prompt.trim().length > 0;

  return (
    <motion.div
      variants={MODAL_SCRIM_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim"
      onClick={onClose}
    >
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[560px] flex-col gap-[12px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div className="flex items-center gap-[8px]">
          <span id="handoff-title" className="text-[13px] font-bold text-mg-text">Prompt de handoff</span>
          {busy && <Spinner />}
          <span className="text-[10.5px] text-mg-muted">— revísalo y edítalo antes de usarlo</span>
          <button onClick={onClose} className="ml-auto text-mg-muted hover:text-mg-body" data-tip="Cerrar">
            ✕
          </button>
        </div>

        {error !== null ? (
          <div role="alert" className="rounded-[7px] border border-mg-border-emph bg-mg-code p-[10px] text-[11px] text-mg-danger">{error}</div>
        ) : (
          <textarea
            value={prompt}
            disabled={busy}
            onChange={(e) => setPrompt(e.target.value)}
            aria-label="Prompt de handoff (editable)"
            placeholder={busy ? 'Generando el prompt de handoff…' : ''}
            className="h-[320px] w-full resize-none overflow-y-auto rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[10px] text-[12px] leading-[1.55] text-mg-body outline-none disabled:opacity-60"
          />
        )}

        <div className="flex items-center gap-[8px]">
          <button
            onClick={copy}
            disabled={!canAct}
            className="rounded-[7px] border border-mg-border-emph px-[12px] py-[6px] text-[11.5px] text-mg-body2 transition-colors duration-150 ease-out hover:bg-mg-hover disabled:opacity-50"
          >
            {copied ? '✓ Copiado' : 'Copiar'}
          </button>
          <button
            onClick={() => void onStartChat(prompt)}
            disabled={!canAct}
            className="rounded-[7px] bg-mg-primary px-[12px] py-[6px] text-[11.5px] font-semibold text-mg-primary-ink transition-opacity duration-150 ease-out disabled:opacity-50"
          >
            Empezar nuevo chat con este prompt
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Spinner(): React.JSX.Element {
  return <span className="inline-block h-[11px] w-[11px] animate-spin rounded-full border border-mg-border-emph border-t-mg-body" />;
}
