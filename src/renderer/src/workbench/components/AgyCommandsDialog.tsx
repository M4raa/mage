import { useState } from 'react';
import { motion } from 'motion/react';
import { validateAgyCommand, type AgyCommandVerdict } from '@shared/agyRules';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { DialogButton } from './CloseMageDialog';
import { Icon } from './Icon';

// «Comandos de agy» (grupo E, fase 2): los comandos de terminal que agy puede ejecutar, por linea EXACTA.
// Se conceden o revocan al EMPEZAR la conversacion: agy lee sus reglas al arrancar (medido), asi que lo
// que se cambie aqui vale desde el primer mensaje de una conversacion nueva. Sin regex a proposito.
export function AgyCommandsDialog({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const rules = useWorkbenchStore((s) => s.settings.agyCommandRules);
  const setVerdict = useWorkbenchStore((s) => s.setAgyCommandVerdict);
  const dialogRef = useDialogA11y({ onClose });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (verdict: AgyCommandVerdict): void => {
    const checked = validateAgyCommand(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setVerdict(checked.command, verdict);
    setDraft('');
    setError(null);
  };
  const entries = [...rules.allow.map((command) => ({ command, verdict: 'allow' as const })), ...rules.deny.map((command) => ({ command, verdict: 'deny' as const }))];

  return (
    <motion.div variants={MODAL_SCRIM_VARIANTS} initial="initial" animate="animate" exit="exit" className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim" onClick={onClose}>
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="agy-commands-title"
        data-agy-commands-dialog="true"
        onClick={(e) => e.stopPropagation()}
        className="flex w-[480px] max-w-[calc(100vw-32px)] flex-col gap-[12px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="agy-commands-title" className="text-[13px] font-bold text-mg-text">
          Comandos de agy
        </div>
        <p className="leading-[1.55] text-mg-body2">
          agy solo ejecuta los comandos de terminal que permitas aquí, escritos <strong>exactamente</strong> como los
          lanzará: <code>git status</code> no permite <code>git status --short</code>. Denegar gana a permitir. Se
          aplican al empezar la conversación.
        </p>
        <CommandList entries={entries} onVerdict={setVerdict} />
        <div className="flex items-center gap-[6px]">
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add('allow');
            }}
            aria-label="Comando exacto"
            placeholder="p. ej. pnpm test"
            className="min-w-0 flex-1 rounded-[7px] border border-mg-border-ctrl bg-mg-window px-[8px] py-[5px] font-mono text-[11.5px] text-mg-text"
          />
          <DialogButton onClick={() => add('allow')}>Permitir</DialogButton>
          <DialogButton onClick={() => add('deny')}>Denegar</DialogButton>
        </div>
        {error !== null && (
          <div role="alert" className="text-[11px] text-mg-danger">
            {error}
          </div>
        )}
        <div className="flex justify-end">
          <DialogButton primary onClick={onClose}>
            Listo
          </DialogButton>
        </div>
      </motion.div>
    </motion.div>
  );
}

function CommandList({
  entries,
  onVerdict,
}: {
  readonly entries: readonly { readonly command: string; readonly verdict: AgyCommandVerdict }[];
  readonly onVerdict: (command: string, verdict: AgyCommandVerdict | null) => void;
}): React.JSX.Element {
  if (entries.length === 0) return <div className="text-[11px] text-mg-muted">Ningún comando todavía: agy los deniega todos.</div>;
  return (
    <ul className="flex max-h-[220px] flex-col gap-[4px] overflow-y-auto" data-agy-command-list="true">
      {entries.map(({ command, verdict }) => (
        <li key={`${verdict}:${command}`} className="flex items-center gap-[8px] rounded-[7px] border border-mg-border-subtle bg-mg-code px-[8px] py-[4px]">
          <code className="min-w-0 flex-1 truncate text-[11.5px] text-mg-body">{command}</code>
          <button
            onClick={() => onVerdict(command, verdict === 'allow' ? 'deny' : 'allow')}
            data-tip={verdict === 'allow' ? 'Pasar a denegado' : 'Pasar a permitido'}
            className={`shrink-0 rounded-[5px] border px-[6px] py-[1px] text-[10.5px] ${verdict === 'allow' ? 'border-mg-border-emph text-mg-body2' : 'border-mg-danger-border text-mg-danger'}`}
          >
            {verdict === 'allow' ? 'Permitido' : 'Denegado'}
          </button>
          <button onClick={() => onVerdict(command, null)} aria-label={`Quitar ${command}`} className="shrink-0 text-mg-muted hover:text-mg-danger">
            <Icon name="trash" size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}
