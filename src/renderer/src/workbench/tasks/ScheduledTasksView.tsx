import { useState } from 'react';
import type { TaskRecord } from '@shared/tasks';
import { activeFormatLocale } from '../../i18n/format';
import { formatDateTime } from '@shared/i18n/format';
import { useT } from '../../i18n/uiLanguage';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { describeError } from '../describeError';
import { Icon } from '../components/Icon';
import { useLocalPopover } from '../localPopovers';
import { reportActionError } from '../notificationStore';
import { useWorkbenchStore } from '../workbenchStore';
import { DesktopTasksTab } from './DesktopTasksTab';
import { NewTaskDialog } from './NewTaskDialog';
import { launchTask } from './startTask';
import { openTaskConversation, realStartTaskDeps } from './taskActions';
import { duplicateDraftOf, describeSchedule, filterTasks, lastRunKind } from './scheduledTasksModel';
import { useTaskStore } from './taskStore';
import { taskDisplayName, taskOfTab, taskPhase } from './taskView';

type Tab = 'mine' | 'desktop';
const TAB_CLASS = 'rounded-[6px] px-[10px] py-[4px] text-[11.5px] aria-selected:bg-mg-hover aria-selected:font-semibold aria-selected:text-mg-text text-mg-sec hover:bg-mg-hover';

// «Tareas programadas»: pantalla completa con las tareas del usuario y, aparte, las de Claude Desktop (solo lectura).
// El diálogo de tarea es HERMANO del panel: dentro de él, el Escape del diálogo cerraría también la pantalla.
export function ScheduledTasksView(): React.JSX.Element | null {
  const open = useWorkbenchStore((s) => s.scheduledTasksOpen);
  return open ? <ScheduledTasksDialogs /> : null;
}

function ScheduledTasksDialogs(): React.JSX.Element {
  const [editor, setEditor] = useState<{ readonly editing: TaskRecord | null } | null>(null);
  return (
    <>
      <ScheduledTasksScreen onEdit={(editing) => setEditor({ editing })} />
      {editor !== null && <NewTaskDialog editing={editor.editing} onClose={() => setEditor(null)} />}
    </>
  );
}

function ScheduledTasksScreen({ onEdit }: { readonly onEdit: (editing: TaskRecord | null) => void }): React.JSX.Element {
  const t = useT();
  const close = useWorkbenchStore((s) => s.closeScheduledTasks);
  const dialogRef = useDialogA11y({ onClose: close });
  const [tab, setTab] = useState<Tab>('mine');
  const [query, setQuery] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim" onClick={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduled-tasks-title"
        data-scheduled-tasks="true"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(90vh,900px)] w-[min(96vw,1240px)] flex-col overflow-hidden rounded-[11px] border border-mg-border-pop bg-mg-panel text-[12px] mg-shadow-modal"
      >
        <header className="flex items-center gap-[10px] border-b border-mg-border-subtle p-[12px_18px]">
          <h2 id="scheduled-tasks-title" className="flex-1 text-[14px] font-semibold text-mg-text">{t('scheduledTasks.title')}</h2>
          <button data-scheduled-new="true" onClick={() => onEdit(null)} className="flex items-center gap-[5px] rounded-[6px] bg-mg-primary px-[10px] py-[4px] text-[11px] font-semibold text-mg-primary-ink">
            <Icon name="plus" size={12} />
            {t('scheduledTasks.new')}
          </button>
          <button data-scheduled-close="true" onClick={close} aria-label={t('scheduledTasks.close')} className="grid h-[24px] w-[24px] place-items-center rounded-[6px] text-mg-muted hover:bg-mg-hover hover:text-mg-body">
            <Icon name="close" size={13} />
          </button>
        </header>
        <div className="flex items-center gap-[10px] border-b border-mg-border-subtle p-[8px_18px]">
          <div role="tablist" className="flex gap-[4px]">
            {(['mine', 'desktop'] as const).map((id) => (
              <button key={id} role="tab" aria-selected={tab === id} data-scheduled-tab={id} onClick={() => setTab(id)} className={TAB_CLASS}>{t(`scheduledTasks.tabs.${id}`)}</button>
            ))}
          </div>
          <input
            data-scheduled-search="true" aria-label={t('scheduledTasks.search')} placeholder={t('scheduledTasks.search')} value={query} onChange={(e) => setQuery(e.target.value)}
            className="ml-auto w-[260px] rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[5px_9px] text-mg-body outline-none"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-[14px_18px]">
          {tab === 'mine' ? <MineTab query={query} onEdit={onEdit} /> : <DesktopTasksTab query={query} />}
        </div>
      </div>
    </div>
  );
}

function KeepAwakeBanner(): React.JSX.Element {
  const t = useT();
  const keepAwake = useWorkbenchStore((s) => s.settings.scheduledTasksKeepAwake);
  const setKeepAwake = useWorkbenchStore((s) => s.setScheduledTasksKeepAwake);
  return (
    <div data-scheduled-banner="true" className="mb-[12px] flex items-center gap-[8px] rounded-[8px] border border-mg-border-subtle bg-mg-window p-[8px_12px] text-mg-body2">
      <Icon name="info" size={13} />
      <span className="min-w-0 flex-1">{t('scheduledTasks.banner')}</span>
      <label title={t('scheduledTasks.keepAwakeHint')} className="flex items-center gap-[6px] text-mg-body">
        <input type="checkbox" data-keep-awake="true" checked={keepAwake} onChange={(e) => setKeepAwake(e.target.checked)} />
        {t('scheduledTasks.keepAwake')}
      </label>
    </div>
  );
}

function MineTab({ query, onEdit }: { readonly query: string; readonly onEdit: (editing: TaskRecord | null) => void }): React.JSX.Element {
  const t = useT();
  const tasks = useTaskStore((s) => s.tasks);
  const shown = filterTasks(tasks, query);
  return (
    <>
      <KeepAwakeBanner />
      {shown.length === 0 && (
        <p data-scheduled-empty="true" className="p-[10px_2px] text-[11.5px] text-mg-muted">{tasks.length === 0 ? t('scheduledTasks.empty') : t('scheduledTasks.noMatches')}</p>
      )}
      <div className="flex flex-col gap-[8px]">
        {shown.map((task) => <TaskCard key={task.id} task={task} onEdit={() => onEdit(task)} />)}
      </div>
    </>
  );
}

function useTaskPhase(task: TaskRecord): ReturnType<typeof taskPhase> {
  const tabId = useWorkbenchStore((s) => s.tabs.find((tab) => taskOfTab([task], tab, s.sessionIdByChat[tab.id]) !== undefined)?.id);
  const status = useWorkbenchStore((s) => (tabId === undefined ? undefined : s.statusByChat[tabId]));
  const pendingCount = useWorkbenchStore((s) => (tabId === undefined ? 0 : s.pendingByChat[tabId]?.length ?? 0));
  return taskPhase({ status, pendingCount, task });
}

function lastRunText(task: TaskRecord, translate: ReturnType<typeof useT>): string {
  const kind = lastRunKind(task);
  if (kind === 'never' || task.lastRun === null) return translate('scheduledTasks.lastRun.never');
  const when = formatDateTime(task.lastRun.atMs, activeFormatLocale());
  if (kind === 'failed') return translate('scheduledTasks.lastRun.failed', { when, error: task.lastRun.error ?? '' });
  return translate(kind === 'late' ? 'scheduledTasks.lastRun.late' : 'scheduledTasks.lastRun.started', { when });
}

function TaskCard({ task, onEdit }: { readonly task: TaskRecord; readonly onEdit: () => void }): React.JSX.Element {
  const t = useT();
  const phase = useTaskPhase(task);
  const name = taskDisplayName(task);
  const summary = task.schedule === null ? t('scheduledTasks.unscheduled') : describeSchedule(task.schedule, t, activeFormatLocale());
  const next = task.nextRunAtMs === null ? t('scheduledTasks.noNextRun') : t('scheduledTasks.nextRun', { when: formatDateTime(task.nextRunAtMs, activeFormatLocale()) });
  const hasConversation = task.sessionId !== null || task.conversationId !== null;
  const openLast = (): void => {
    useWorkbenchStore.getState().closeScheduledTasks();
    openTaskConversation(task, t);
  };
  return (
    <div data-scheduled-card={task.id} data-enabled={String(task.enabled)} data-next-run={task.nextRunAtMs ?? ''} data-task-phase={phase} className="flex items-center gap-[10px] rounded-[9px] border border-mg-border-subtle bg-mg-window p-[10px_12px]">
      <button data-scheduled-edit="true" onClick={onEdit} className="flex min-w-0 flex-1 flex-col gap-[2px] text-left">
        <span className="truncate text-[12.5px] font-semibold text-mg-text" title={name}>{name}</span>
        <span data-scheduled-summary="true" className="truncate text-mg-body2">{summary}</span>
        <span className="truncate text-[11px] text-mg-muted">{next}</span>
        <span className="truncate text-[11px] text-mg-muted">{lastRunText(task, t)} · {t(`tasks.phase.${phase}`)}</span>
      </button>
      {hasConversation && <button data-scheduled-open-last="true" onClick={openLast} className="shrink-0 rounded-[6px] border border-mg-border-ctrl px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover">{t('scheduledTasks.openLast')}</button>}
      {task.schedule !== null && <EnabledToggle task={task} name={name} />}
      <TaskMenu task={task} name={name} />
    </div>
  );
}

function reportFailure(err: unknown, key: 'scheduledTasks.error.actionFailed' | 'scheduledTasks.error.runFailed', translate: ReturnType<typeof useT>): void {
  reportActionError(translate(key), err, 'tasks');
}

function EnabledToggle({ task, name }: { readonly task: TaskRecord; readonly name: string }): React.JSX.Element {
  const t = useT();
  const toggle = (enabled: boolean): void => {
    useTaskStore.getState().setEnabled(task.id, enabled).catch((err: unknown) => reportFailure(err, 'scheduledTasks.error.actionFailed', t));
  };
  return <input type="checkbox" data-scheduled-toggle="true" aria-label={t('scheduledTasks.enabledAria', { name })} checked={task.enabled} onChange={(e) => toggle(e.target.checked)} />;
}

// «Ejecutar ahora»: la pantalla se cierra, main marca la ejecución y el renderer abre la conversación.
async function runTaskNow(task: TaskRecord, translate: ReturnType<typeof useT>): Promise<void> {
  useWorkbenchStore.getState().closeScheduledTasks();
  try {
    const marked = await useTaskStore.getState().runNow(task.id);
    await launchTask(marked, realStartTaskDeps());
  } catch (err) {
    // Registrar el fallo en main es lo que hace que la tarjeta diga «falló»; si eso también falla, se avisa de las dos cosas.
    await window.mage.reportTaskRunFailed({ taskId: task.id, error: describeError(err) })
      .catch((reportErr: unknown) => reportFailure(reportErr, 'scheduledTasks.error.actionFailed', translate));
    reportFailure(err, 'scheduledTasks.error.runFailed', translate);
  }
}

function TaskMenu({ task, name }: { readonly task: TaskRecord; readonly name: string }): React.JSX.Element {
  const t = useT();
  const [open, setOpen] = useState(false);
  useLocalPopover(open);
  const item = 'flex w-full items-center gap-[8px] px-[11px] py-[6px] text-left text-[11.5px] text-mg-body2 hover:bg-mg-hover';
  const act = (run: () => Promise<unknown>): void => {
    setOpen(false);
    run().catch((err: unknown) => reportFailure(err, 'scheduledTasks.error.actionFailed', t));
  };
  return (
    <div className="relative" onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button data-scheduled-menu="true" aria-haspopup="menu" aria-expanded={open} aria-label={t('scheduledTasks.menuAria', { name })} onClick={() => setOpen(!open)} className="grid h-[26px] w-[26px] place-items-center rounded-[6px] text-mg-sec hover:bg-mg-hover hover:text-mg-body">
        <Icon name="ellipsis" size={14} />
      </button>
      {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
      {open && (
        <div role="menu" className="absolute right-0 top-full z-20 mt-[4px] w-[190px] overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] mg-shadow-pop">
          <button role="menuitem" className={item} onClick={() => { setOpen(false); void runTaskNow(task, t); }}><Icon name="play" size={12} />{t('scheduledTasks.menu.runNow')}</button>
          <button role="menuitem" className={item} onClick={() => act(() => useTaskStore.getState().create(duplicateDraftOf(task, t('scheduledTasks.copyName', { name }))))}><Icon name="copy" size={12} />{t('scheduledTasks.menu.duplicate')}</button>
          <button role="menuitem" title={t('scheduledTasks.deleteHint')} className={`${item} text-mg-danger`} onClick={() => act(() => useTaskStore.getState().remove(task.id))}><Icon name="trash" size={12} />{t('scheduledTasks.menu.delete')}</button>
        </div>
      )}
    </div>
  );
}
