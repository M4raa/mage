import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import type { RewindAction, RewindPlan } from '@shared/ipc';
import type { Translate } from '@shared/i18n/translator';
import { CLAUDE_PROVIDER_ID, CODEX_PROVIDER_ID } from '@shared/providers';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { describeError } from '../describeError';
import { providerLabel } from '../accountView';
import { conversationIdOfTab } from '../conversationId';
import { notify } from '../notificationStore';
import { unavailableText } from '../rewindActions';
import { useT } from '../../i18n/uiLanguage';
import { DialogButton } from './CloseMageDialog';

// Diálogo de Rebobinar, Reintentar y Divergir (K07). Pide el plan a main por el store (`getRewindPlan`, nunca a
// `mage` directamente: verify:gui lo sustituye por uno sintético) y pinta solo lo que ese plan dice que se
// puede hacer. Se monta con un portal desde la burbuja: no toca ni `App` ni `ChatPane`.

const TITLE_KEY = { rewind: 'chat.rewind.title', retry: 'chat.retry.title', diverge: 'chat.diverge.title' } as const;

function confirmLabel(t: Translate, action: RewindAction): string {
  if (action === 'retry') return t('chat.retry.confirm');
  return action === 'diverge' ? t('chat.diverge.confirm') : t('chat.rewind.confirm');
}

interface PlanState {
  readonly plan: RewindPlan | null;
  readonly loadError: string | null;
}

// Pide el plan al montar. El efecto se cancela al desmontar para no pintar un plan que ya nadie espera.
function useRewindPlan(tabId: string, blockId: string, action: RewindAction): PlanState {
  const getRewindPlan = useWorkbenchStore((s) => s.getRewindPlan);
  const [state, setState] = useState<PlanState>({ plan: null, loadError: null });
  useEffect(() => {
    let cancelled = false;
    getRewindPlan(tabId, blockId, action).then(
      (plan) => { if (!cancelled) setState({ plan, loadError: null }); },
      (err: unknown) => { if (!cancelled) setState({ plan: null, loadError: describeError(err) }); },
    );
    return () => { cancelled = true; };
  }, [getRewindPlan, tabId, blockId, action]);
  return state;
}

export function RewindDialog({ tabId, blockId, action, onClose }: {
  readonly tabId: string;
  readonly blockId: string;
  readonly action: RewindAction;
  readonly onClose: () => void;
}): React.JSX.Element {
  const t = useT();
  const { plan, loadError } = useRewindPlan(tabId, blockId, action);
  const rewindTo = useWorkbenchStore((s) => s.rewindTo);
  const divergeFrom = useWorkbenchStore((s) => s.divergeFrom);
  const [restoreFiles, setRestoreFiles] = useState(false); // apagada por defecto (K-U2 y U4)
  const [saveCopy, setSaveCopy] = useState(false); // apagada por defecto (U3)
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogA11y({ onClose });
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  // Va DESPUÉS del efecto del hook, que enfoca lo primero que encuentra: el foco inicial es «Cancelar».
  useEffect(() => cancelRef.current?.focus(), []);

  const unavailable = plan !== null && plan.unavailable !== null;
  const canApply = plan !== null && !unavailable && !applying;
  const confirm = async (): Promise<void> => {
    if (plan === null) return;
    setApplying(true);
    setError(null);
    try {
      if (action === 'diverge') await divergeFrom(tabId, blockId);
      else await rewindTo(tabId, blockId, { action, restoreFiles: restoreFiles && plan.files?.available === true, saveCopy: saveCopy && plan.canSaveCopy });
      onClose();
    } catch (err) {
      // `rewindTo` ya avisó con un toast; aquí se queda dentro del diálogo, que no se cierra.
      setError(describeError(err));
      setApplying(false);
    }
  };

  return createPortal(
    <motion.div variants={MODAL_SCRIM_VARIANTS} initial="initial" animate="animate" exit="exit" className="fixed inset-0 z-[70] flex items-center justify-center bg-mg-scrim" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rewind-dialog-title"
        data-rewind-dialog={action}
        onClick={(e) => e.stopPropagation()}
        // Escape cierra el diálogo y NO llega al atajo global, que interrumpiría el turno en marcha (mismo
        // arreglo que el menú «A la cola»).
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.stopPropagation();
          onClose();
        }}
        className="flex w-[460px] max-w-[92vw] flex-col gap-[12px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="rewind-dialog-title" className="text-[13px] font-bold text-mg-text">{t(TITLE_KEY[action])}</div>
        <div className="flex flex-col gap-[8px] leading-[1.55] text-mg-body2">
          <PlanBody
            plan={plan} loadError={loadError} action={action}
            options={{ restoreFiles, saveCopy, setRestoreFiles, setSaveCopy }}
            legacy={{ tabId, onDone: onClose }}
          />
          {error !== null && <p role="alert" data-rewind-error="true" className="rounded-[7px] border border-mg-danger-border bg-mg-danger-bg p-[7px_10px] text-mg-danger">{error}</p>}
        </div>
        <div className="mt-[2px] flex justify-end gap-[8px]">
          <DialogButton buttonRef={cancelRef} onClick={onClose}>{unavailable ? t('chat.rewind.close') : t('chat.rewind.cancel')}</DialogButton>
          {plan !== null && !unavailable && (
            <button
              type="button"
              data-rewind-confirm="true"
              disabled={!canApply}
              onClick={() => void confirm()}
              className="rounded-[7px] border border-mg-border-emph bg-mg-sel px-[12px] py-[6px] font-bold text-mg-sel-ink transition-colors duration-90 ease-out hover:bg-mg-hover disabled:opacity-50"
            >
              {applying ? t('chat.rewind.applying') : confirmLabel(t, action)}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

interface OptionsProps {
  readonly restoreFiles: boolean;
  readonly saveCopy: boolean;
  readonly setRestoreFiles: (value: boolean) => void;
  readonly setSaveCopy: (value: boolean) => void;
}

function PlanBody({ plan, loadError, action, options, legacy }: {
  readonly plan: RewindPlan | null;
  readonly loadError: string | null;
  readonly action: RewindAction;
  readonly options: OptionsProps;
  readonly legacy: { readonly tabId: string; readonly onDone: () => void };
}): React.JSX.Element {
  const t = useT();
  if (loadError !== null) return <p role="alert" className="text-mg-danger">{loadError}</p>;
  if (plan === null) return <p data-rewind-loading="true" className="text-mg-muted">{t('chat.rewind.loading')}</p>;
  if (plan.unavailable !== null) {
    return (
      <>
        <p data-rewind-unavailable={plan.unavailable}>{unavailableText(t, plan.unavailable, providerLabel(plan.provider))}</p>
        {plan.unavailable === 'legacy' && <LegacyUpdate tabId={legacy.tabId} onDone={legacy.onDone} />}
      </>
    );
  }
  if (action === 'diverge') return <p>{t('chat.diverge.explain')}</p>;
  return (
    <>
      <p data-rewind-discarded={plan.discardedMessages}>{t('chat.rewind.discarded', { count: plan.discardedMessages })}</p>
      {plan.files !== null && <ClaudeFiles files={plan.files} checked={options.restoreFiles} onChange={options.setRestoreFiles} />}
      {plan.provider === CODEX_PROVIDER_ID && <CodexNotes canSaveCopy={plan.canSaveCopy} checked={options.saveCopy} onChange={options.setSaveCopy} />}
      {plan.provider === CLAUDE_PROVIDER_ID && plan.recoverable && <p className="text-mg-muted">{t('chat.rewind.recoverable')}</p>}
      <Affected plan={plan} />
    </>
  );
}

function Checkbox({ checked, disabled = false, onChange, dataAttr, children }: {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (value: boolean) => void;
  readonly dataAttr: 'data-rewind-files' | 'data-rewind-save-copy';
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="inline-flex items-center gap-[7px] text-mg-body">
      <input type="checkbox" {...{ [dataAttr]: 'true' }} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function ClaudeFiles({ files, checked, onChange }: {
  readonly files: NonNullable<RewindPlan['files']>;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-col gap-[5px]">
      <Checkbox dataAttr="data-rewind-files" checked={checked && files.available} disabled={!files.available} onChange={onChange}>
        {t('chat.rewind.restoreFiles')}
      </Checkbox>
      {!files.available && <p className="text-mg-muted">{t('chat.rewind.filesUnavailable')}</p>}
      {files.available && <ChangedFiles files={files} />}
      <p className="text-[11px] text-mg-muted">{t('chat.rewind.filesScope')}</p>
    </div>
  );
}

// El plan trae las rutas y el TOTAL de líneas, no las de cada fichero: con uno solo es su resumen exacto; con
// varios, la lista y el total aparte (un «+N −M» no lleva texto que traducir).
function ChangedFiles({ files }: { readonly files: NonNullable<RewindPlan['files']> }): React.JSX.Element | null {
  const t = useT();
  const [only] = files.changed;
  if (only === undefined) return null;
  if (files.changed.length === 1) {
    return <p data-rewind-files-list="true" className="font-mono text-[11px] text-mg-sec">{t('chat.rewind.filesSummary', { path: only, insertions: files.insertions, deletions: files.deletions })}</p>;
  }
  return (
    <ul data-rewind-files-list="true" className="max-h-[110px] overflow-y-auto font-mono text-[11px] text-mg-sec">
      {files.changed.map((path) => <li key={path} className="truncate">{path}</li>)}
      <li className="pt-[2px] text-mg-muted">+{files.insertions} −{files.deletions}</li>
    </ul>
  );
}

function CodexNotes({ canSaveCopy, checked, onChange }: {
  readonly canSaveCopy: boolean;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
}): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-col gap-[5px]">
      <p>{t('chat.rewind.codexFiles')}</p>
      {canSaveCopy && (
        <>
          <Checkbox dataAttr="data-rewind-save-copy" checked={checked} onChange={onChange}>{t('chat.rewind.saveCopy')}</Checkbox>
          <p className="text-[11px] text-mg-muted">{t('chat.rewind.saveCopyNote')}</p>
        </>
      )}
      <p className="text-mg-muted">{t('chat.rewind.codexNotRecoverable')}</p>
    </div>
  );
}

// Lo que la acción se lleva por delante además de los mensajes: el turno en marcha, la cola y los permisos.
function Affected({ plan }: { readonly plan: RewindPlan }): React.JSX.Element | null {
  const t = useT();
  if (!plan.turnRunning && plan.queuedCount === 0 && plan.pendingCount === 0) return null;
  return (
    <ul data-rewind-affected="true" className="list-disc pl-[18px] text-mg-body">
      {plan.turnRunning && <li>{t('chat.rewind.stopsTurn')}</li>}
      {plan.queuedCount > 0 && <li>{t('chat.rewind.queueReturns', { count: plan.queuedCount })}</li>}
      {plan.pendingCount > 0 && <li>{t('chat.rewind.pendingCancelled')}</li>}
    </ul>
  );
}

// «Actualizar esta conversación» (hilo de una versión anterior de Codex): pide confirmación aquí mismo.
function LegacyUpdate({ tabId, onDone }: { readonly tabId: string; readonly onDone: () => void }): React.JSX.Element | null {
  const t = useT();
  const tab = useWorkbenchStore((s) => s.tabs.find((candidate) => candidate.id === tabId));
  const liveSessionId = useWorkbenchStore((s) => s.sessionIdByChat[tabId]);
  const updateLegacyCodex = useWorkbenchStore((s) => s.updateLegacyCodex);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const threadId = tab === undefined ? undefined : conversationIdOfTab(tab, liveSessionId);
  if (tab === undefined || threadId === undefined) return null;
  const accountDir = tab.resolvedConfigDir ?? tab.accountId;
  const run = async (): Promise<void> => {
    setFailure(null);
    try {
      const backupDir = await updateLegacyCodex(tabId, accountDir, threadId);
      onDone();
      notify({ level: 'success', title: t('history.legacyCodex.done', { backupDir }), source: 'history' });
    } catch (err) {
      setFailure(describeError(err));
    }
  };
  if (!confirming) return <div><DialogButton onClick={() => setConfirming(true)}>{t('history.legacyCodex.update')}</DialogButton></div>;
  return (
    <div className="flex flex-col gap-[6px]">
      <p>{t('history.legacyCodex.confirm')}</p>
      {failure !== null && <p role="alert" className="text-mg-danger">{failure}</p>}
      <div className="flex gap-[8px]">
        <DialogButton onClick={() => setConfirming(false)}>{t('chat.rewind.cancel')}</DialogButton>
        <DialogButton primary onClick={() => void run()}>{t('history.legacyCodex.update')}</DialogButton>
      </div>
    </div>
  );
}
