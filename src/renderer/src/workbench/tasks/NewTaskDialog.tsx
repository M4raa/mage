import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { LibraryView } from '@shared/ipc';
import { TASK_LIMITS, type TaskDraft, type TaskProvider, type TaskRecord } from '@shared/tasks';
import { useT, useUiLanguageStore } from '../../i18n/uiLanguage';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { describeError } from '../describeError';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS } from '../motionPresets';
import { useWorkbenchStore } from '../workbenchStore';
import type { Account } from '../types';
import { ScheduleFields } from './ScheduleFields';
import { startTask } from './startTask';
import { realStartTaskDeps } from './taskActions';
import { defaultScheduleForm, formFromSchedule, scheduleFromForm, type ScheduleForm } from './taskScheduleForm';
import { saveTaskForm } from './taskRunner';
import { useTaskStore } from './taskStore';
import { canStartTask, capabilitiesFor, taskDisplayName } from './taskView';

const TASK_PROVIDERS: readonly string[] = ['claude', 'codex'];
const FIELD_CLASS = 'w-full rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[7px_9px] text-mg-body outline-none';
const SMALL_BUTTON_CLASS = 'rounded-[6px] border border-mg-border-ctrl px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover';

const taskAccounts = (accounts: readonly Account[]): readonly Account[] => accounts.filter((account) => TASK_PROVIDERS.includes(account.providerId));

function initialAccountId(accounts: readonly Account[], activeId: string): string {
  const candidates = taskAccounts(accounts);
  return (candidates.find((account) => account.id === activeId) ?? candidates[0])?.id ?? '';
}

interface LibraryState {
  readonly view: LibraryView | null;
  readonly error: string | null;
}

function useLibraryView(): LibraryState {
  const [state, setState] = useState<LibraryState>({ view: null, error: null });
  useEffect(() => {
    let cancelled = false;
    // Sin biblioteca legible la lista de capacidades queda vacía y el diálogo dice por qué; la tarea sigue siendo posible.
    window.mage.libraryView().then((loaded) => { if (!cancelled) setState({ view: loaded, error: null }); }).catch((err: unknown) => {
      console.warn('Biblioteca no disponible para las tareas:', describeError(err));
      if (!cancelled) setState({ view: null, error: describeError(err) });
    });
    return () => { cancelled = true; };
  }, []);
  return state;
}

type WhenMode = 'now' | 'schedule';

// Estado del formulario (valores iniciales del registro que se edita o los de una tarea nueva) y lo que se deriva de él.
function useTaskForm(editing: TaskRecord | null) {
  const accounts = useWorkbenchStore((s) => s.accounts);
  const activeAccountId = useWorkbenchStore((s) => s.activeAccountId);
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [name, setName] = useState(() => (editing === null ? '' : taskDisplayName(editing)));
  const [goal, setGoal] = useState(editing?.goal ?? '');
  const [accountDir, setAccountDir] = useState(() => editing?.accountDir ?? initialAccountId(accounts, activeAccountId));
  const [folders, setFolders] = useState<readonly string[]>(editing?.folders ?? []);
  const [documents, setDocuments] = useState<readonly string[]>(editing?.documents ?? []);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set(editing?.capabilities ?? []));
  const [mode, setMode] = useState<WhenMode>(() => (editing !== null && editing.schedule === null ? 'now' : 'schedule'));
  const [scheduleForm, setScheduleForm] = useState(() => (editing?.schedule ? formFromSchedule(editing.schedule, Date.now(), timeZone) : defaultScheduleForm(Date.now(), timeZone)));
  const schedule = mode === 'schedule' ? scheduleFromForm(scheduleForm, timeZone) : null;
  const changeAccount = (id: string): void => { setAccountDir(id); setChosen(new Set()); };
  const toggle = (title: string): void => setChosen((current) => {
    const next = new Set(current);
    if (!next.delete(title)) next.add(title);
    return next;
  });
  return {
    accounts, name, setName, goal, setGoal, accountDir, changeAccount, folders, setFolders, documents, setDocuments,
    chosen, toggle, mode, setMode, scheduleForm, setScheduleForm, schedule, scheduleValid: mode === 'now' || schedule !== null,
  };
}

type TaskFormState = ReturnType<typeof useTaskForm>;

// Guarda (crea o edita) o ejecuta ahora, según el modo; con «ejecutar ahora» la conversación nueva pasa a primer plano.
function submitTaskForm(form: TaskFormState, provider: TaskProvider, editing: TaskRecord | null): Promise<void> {
  const draft: TaskDraft = {
    name: form.name.trim(), schedule: form.schedule, goal: form.goal.trim(), language: useUiLanguageStore.getState().resolved.language,
    provider, accountDir: form.accountDir, folders: form.folders, documents: form.documents, capabilities: [...form.chosen],
  };
  const tasks = useTaskStore.getState();
  return saveTaskForm({ editingId: editing?.id ?? null, draft }, {
    edit: (id, d) => tasks.edit(id, d), create: (d) => tasks.create(d), start: (d) => startTask(d, realStartTaskDeps()),
  }).then((outcome) => {
    if (outcome === 'started') useWorkbenchStore.getState().closeScheduledTasks();
  });
}

interface NewTaskDialogProps {
  readonly onClose: () => void;
  readonly editing: TaskRecord | null;
}

export function NewTaskDialog({ onClose, editing }: NewTaskDialogProps): React.JSX.Element {
  const t = useT();
  const form = useTaskForm(editing);
  const { view: library, error: libraryError } = useLibraryView();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogA11y({ onClose });
  const provider = form.accounts.find((candidate) => candidate.id === form.accountDir)?.providerId ?? '';
  const capabilities = useMemo(() => (library === null ? [] : capabilitiesFor(library, provider, form.accountDir)), [library, provider, form.accountDir]);
  const submit = (): void => {
    if (provider !== 'claude' && provider !== 'codex') return;
    setBusy(true);
    setError(null);
    submitTaskForm(form, provider, editing).then(onClose).catch((err: unknown) => {
      setError(`${t('tasks.error.startFailed')}: ${describeError(err)}`);
      setBusy(false);
    });
  };
  const startsNow = editing === null && form.mode === 'now';
  const valid = canStartTask({ name: form.name, goal: form.goal, accountDir: form.accountDir, folders: form.folders, scheduleValid: form.scheduleValid });

  return (
    <motion.div variants={MODAL_SCRIM_VARIANTS} initial="initial" animate="animate" className="fixed inset-0 z-[60] flex items-center justify-center bg-mg-scrim" onClick={onClose}>
      <motion.div
        variants={MODAL_PANEL_VARIANTS} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="newtask-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[480px] flex-col gap-[14px] overflow-y-auto rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="newtask-title" className="text-[13px] font-bold text-mg-text">{editing === null ? t('tasks.dialog.title') : t('tasks.dialog.editTitle')}</div>
        <Field label={t('tasks.dialog.name')}>
          <input data-task-name="true" autoFocus maxLength={TASK_LIMITS.nameMaxChars} value={form.name} onChange={(e) => form.setName(e.target.value)} placeholder={t('tasks.dialog.namePlaceholder')} className={FIELD_CLASS} />
        </Field>
        <Field label={t('tasks.dialog.goal')}>
          <textarea data-task-goal="true" rows={4} value={form.goal} onChange={(e) => form.setGoal(e.target.value)} placeholder={t('tasks.dialog.goalPlaceholder')} className={`${FIELD_CLASS} resize-y`} />
        </Field>
        <WhenGroup mode={form.mode} editing={editing !== null} onMode={form.setMode} scheduleForm={form.scheduleForm} onScheduleForm={form.setScheduleForm} />
        <Field label={t('tasks.dialog.account')}>
          <select value={form.accountDir} onChange={(e) => form.changeAccount(e.target.value)} className={FIELD_CLASS}>
            {taskAccounts(form.accounts).map((a) => <option key={a.id} value={a.id}>{`${a.alias} · ${a.provider}`}</option>)}
          </select>
        </Field>
        <PathList label={t('tasks.dialog.folders')} addLabel={t('tasks.dialog.addFolders')} paths={form.folders} markFirst={t('tasks.dialog.workingFolder')}
          pick={() => window.mage.pickTaskFolders()} onChange={form.setFolders} />
        <PathList label={t('tasks.dialog.documents')} addLabel={t('tasks.dialog.addDocuments')} paths={form.documents}
          pick={() => window.mage.pickTaskDocuments()} onChange={form.setDocuments} />
        <Capabilities items={capabilities} chosen={form.chosen} onToggle={form.toggle} loadError={libraryError} />
        {error !== null && <div role="alert" className="text-[11px] text-mg-danger">{error}</div>}
        <div className="flex justify-end gap-[8px]">
          <button onClick={onClose} className={SMALL_BUTTON_CLASS}>{t('tasks.dialog.cancel')}</button>
          <button data-task-start="true" disabled={busy || !valid} onClick={submit}
            className="rounded-[6px] bg-mg-primary px-[12px] py-[4px] text-[11px] font-semibold text-mg-primary-ink disabled:opacity-40">{startsNow ? t('tasks.dialog.start') : t('tasks.dialog.save')}</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

interface WhenGroupProps {
  readonly mode: WhenMode;
  readonly editing: boolean;
  readonly onMode: (mode: WhenMode) => void;
  readonly scheduleForm: ScheduleForm;
  readonly onScheduleForm: (form: ScheduleForm) => void;
}

// «Cuándo»: ejecutar ahora (o dejarla sin programar, al editar) o programarla.
function WhenGroup({ mode, editing, onMode, scheduleForm, onScheduleForm }: WhenGroupProps): React.JSX.Element {
  const t = useT();
  return (
    <fieldset className="flex flex-col gap-[8px]">
      <legend className="mb-[6px] text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('tasks.dialog.when').toUpperCase()}</legend>
      <label className="flex items-center gap-[6px] text-mg-body">
        <input type="radio" name="task-when" data-task-when="now" checked={mode === 'now'} onChange={() => onMode('now')} />
        {editing ? t('tasks.dialog.whenUnscheduled') : t('tasks.dialog.whenNow')}
      </label>
      <label className="flex items-center gap-[6px] text-mg-body">
        <input type="radio" name="task-when" data-task-when="schedule" checked={mode === 'schedule'} onChange={() => onMode('schedule')} />
        {t('tasks.dialog.whenSchedule')}
      </label>
      {mode === 'schedule' && <ScheduleFields form={scheduleForm} onChange={onScheduleForm} />}
    </fieldset>
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
  readonly onToggle: (title: string) => void;
  readonly loadError: string | null;
}

function Capabilities({ items, chosen, onToggle, loadError }: CapabilitiesProps): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-col gap-[6px]">
      <span className="text-[10.5px] font-bold tracking-[.06em] text-mg-ter">{t('tasks.dialog.capabilities').toUpperCase()}</span>
      {loadError !== null && <span role="alert" className="text-[11px] text-mg-danger">{t('tasks.dialog.capabilitiesFailed', { error: loadError })}</span>}
      {loadError === null && items.length === 0 && <span className="text-[11px] text-mg-muted">{t('tasks.dialog.noCapabilities')}</span>}
      {items.map((item) => (
        <label key={item.packageId} className="flex items-center gap-[6px] text-mg-body">
          <input type="checkbox" checked={chosen.has(item.title)} onChange={() => onToggle(item.title)} />
          {item.title}
        </label>
      ))}
    </div>
  );
}
