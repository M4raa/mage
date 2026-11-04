import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { LibraryView } from '@shared/ipc';
import type { TaskDraft } from '@shared/tasks';
import { useT, useUiLanguageStore } from '../../i18n/uiLanguage';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { describeError } from '../describeError';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { useWorkbenchStore } from '../workbenchStore';
import type { Account } from '../types';
import { startTask, type StartTaskDeps } from './startTask';
import { useTaskStore } from './taskStore';
import { canStartTask, capabilitiesFor } from './taskView';

const TASK_PROVIDERS: readonly string[] = ['claude', 'codex'];
const FIELD_CLASS = 'w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] text-mg-body outline-none';
const SMALL_BUTTON_CLASS = 'rounded-[6px] border border-mg-border-ctrl px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover';

// Dependencias reales de `startTask`: el store de tareas y el del workbench, leídos en cada llamada.
function realDeps(): StartTaskDeps {
  const store = (): ReturnType<typeof useWorkbenchStore.getState> => useWorkbenchStore.getState();
  return {
    createTask: (draft) => useTaskStore.getState().create(draft),
    reloadTasks: () => useTaskStore.getState().load(),
    activeAccountId: () => store().activeAccountId,
    setActiveAccount: (accountId) => store().setActiveAccount(accountId),
    createConversation: (folder) => store().createConversation('shared', folder),
    activeTabId: () => store().activeTabId,
    ensureSession: (tabId) => store().ensureSession(tabId),
    tabMentionContext: (tabId) => {
      const tab = store().tabs.find((candidate) => candidate.id === tabId);
      if (tab === undefined) throw new Error(`No hay pestaña ${JSON.stringify(tabId)} para la tarea`);
      return { accountDir: tab.resolvedConfigDir ?? tab.accountId, provider: tab.provider };
    },
    resolveMentions: (params) => window.mage.resolveMentions(params),
    sendMessageToTab: (tabId, text, attachments) => store().sendMessageToTab(tabId, text, attachments),
  };
}

const taskAccounts = (accounts: readonly Account[]): readonly Account[] => accounts.filter((account) => TASK_PROVIDERS.includes(account.providerId));

function initialAccountId(accounts: readonly Account[], activeId: string): string {
  const candidates = taskAccounts(accounts);
  return (candidates.find((account) => account.id === activeId) ?? candidates[0])?.id ?? '';
}

function useLibraryView(): LibraryView | null {
  const [view, setView] = useState<LibraryView | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Sin biblioteca legible la lista de capacidades queda vacía (se dice en el diálogo); la tarea sigue siendo posible.
    window.mage.libraryView().then((loaded) => { if (!cancelled) setView(loaded); }).catch((err: unknown) => console.warn('Biblioteca no disponible para las tareas:', describeError(err)));
    return () => { cancelled = true; };
  }, []);
  return view;
}

export function NewTaskDialog({ onClose }: { readonly onClose: () => void }): React.JSX.Element {
  const t = useT();
  const accounts = useWorkbenchStore((s) => s.accounts);
  const activeAccountId = useWorkbenchStore((s) => s.activeAccountId);
  const library = useLibraryView();
  const [goal, setGoal] = useState('');
  const [accountDir, setAccountDir] = useState(() => initialAccountId(accounts, activeAccountId));
  const [folders, setFolders] = useState<readonly string[]>([]);
  const [documents, setDocuments] = useState<readonly string[]>([]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogA11y({ onClose });
  const account = accounts.find((candidate) => candidate.id === accountDir);
  const provider = account?.providerId ?? '';
  const capabilities = useMemo(() => (library === null ? [] : capabilitiesFor(library, provider, accountDir)), [library, provider, accountDir]);

  const changeAccount = (id: string): void => { setAccountDir(id); setChosen(new Set()); };
  const toggle = (packageId: string): void => setChosen((current) => {
    const next = new Set(current);
    if (!next.delete(packageId)) next.add(packageId);
    return next;
  });
  const submit = (): void => {
    if (account === undefined || (provider !== 'claude' && provider !== 'codex')) return;
    const draft: TaskDraft = {
      goal: goal.trim(), language: useUiLanguageStore.getState().resolved.language, provider, accountDir, folders, documents,
      capabilities: capabilities.filter((capability) => chosen.has(capability.packageId)).map((capability) => capability.title),
    };
    setBusy(true);
    setError(null);
    startTask(draft, realDeps()).then(onClose).catch((err: unknown) => {
      setError(`${t('tasks.error.startFailed')}: ${describeError(err)}`);
      setBusy(false);
    });
  };

  return (
    <motion.div variants={MODAL_SCRIM_VARIANTS} initial="initial" animate="animate" className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim" onClick={onClose}>
      <motion.div
        variants={MODAL_PANEL_VARIANTS} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="newtask-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[480px] flex-col gap-[14px] overflow-y-auto rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="newtask-title" className="text-[13px] font-bold text-mg-text">{t('tasks.dialog.title')}</div>
        <Field label={t('tasks.dialog.goal')}>
          <textarea data-task-goal="true" autoFocus rows={4} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t('tasks.dialog.goalPlaceholder')} className={`${FIELD_CLASS} resize-y`} />
        </Field>
        <Field label={t('tasks.dialog.account')}>
          <select value={accountDir} onChange={(e) => changeAccount(e.target.value)} className={FIELD_CLASS}>
            {taskAccounts(accounts).map((a) => <option key={a.id} value={a.id}>{`${a.alias} · ${a.provider}`}</option>)}
          </select>
        </Field>
        <PathList label={t('tasks.dialog.folders')} addLabel={t('tasks.dialog.addFolders')} paths={folders} markFirst={t('tasks.dialog.workingFolder')}
          pick={() => window.mage.pickTaskFolders()} onChange={setFolders} />
        <PathList label={t('tasks.dialog.documents')} addLabel={t('tasks.dialog.addDocuments')} paths={documents}
          pick={() => window.mage.pickTaskDocuments()} onChange={setDocuments} />
        <Capabilities items={capabilities} chosen={chosen} onToggle={toggle} />
        {error !== null && <div role="alert" className="text-[11px] text-mg-danger">{error}</div>}
        <div className="flex justify-end gap-[8px]">
          <button onClick={onClose} className={SMALL_BUTTON_CLASS}>{t('tasks.dialog.cancel')}</button>
          <button data-task-start="true" disabled={busy || !canStartTask({ goal, accountDir, folders })} onClick={submit}
            className="rounded-[6px] bg-mg-primary px-[12px] py-[4px] text-[11px] font-semibold text-mg-primary-ink disabled:opacity-40">{t('tasks.dialog.start')}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="flex flex-col gap-[6px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{label.toUpperCase()}</span>
      {children}
    </label>
  );
}

interface PathListProps {
  readonly label: string;
  readonly addLabel: string;
  readonly paths: readonly string[];
  readonly markFirst?: string;
  readonly pick: () => Promise<readonly string[]>;
  readonly onChange: (paths: readonly string[]) => void;
}

// Lista de rutas con «añadir» (selector del SO) y «quitar»; sin duplicados.
function PathList({ label, addLabel, paths, markFirst, pick, onChange }: PathListProps): React.JSX.Element {
  const t = useT();
  const add = (): void => {
    void pick().then((picked) => onChange([...new Set([...paths, ...picked])])).catch((err: unknown) => console.warn(`${label}:`, describeError(err)));
  };
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{label.toUpperCase()}</span>
      {paths.map((path, index) => (
        <div key={path} className="flex items-center gap-[6px]">
          <span className="min-w-0 flex-1 truncate text-mg-body" title={path}>{path}</span>
          {index === 0 && markFirst !== undefined && <span className="text-[10px] text-mg-muted">{markFirst}</span>}
          <button onClick={() => onChange(paths.filter((p) => p !== path))} aria-label={`${t('tasks.dialog.remove')} ${path}`} className="text-mg-icon hover:text-mg-body">✕</button>
        </div>
      ))}
      <button onClick={add} className={`${SMALL_BUTTON_CLASS} self-start`}>{addLabel}</button>
    </div>
  );
}

interface CapabilitiesProps {
  readonly items: readonly { readonly packageId: string; readonly title: string }[];
  readonly chosen: ReadonlySet<string>;
  readonly onToggle: (packageId: string) => void;
}

function Capabilities({ items, chosen, onToggle }: CapabilitiesProps): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('tasks.dialog.capabilities').toUpperCase()}</span>
      {items.length === 0 && <span className="text-[11px] text-mg-muted">{t('tasks.dialog.noCapabilities')}</span>}
      {items.map((item) => (
        <label key={item.packageId} className="flex items-center gap-[6px] text-mg-body">
          <input type="checkbox" checked={chosen.has(item.packageId)} onChange={() => onToggle(item.packageId)} />
          {item.title}
        </label>
      ))}
    </div>
  );
}
