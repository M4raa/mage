import { useState } from 'react';
import { useT } from '../../i18n/uiLanguage';
import { SectionLabel } from '../components/sidebar/SidebarGroups';
import { reportActionError } from '../notificationStore';
import { useWorkbenchStore } from '../workbenchStore';
import { NewTaskDialog } from './NewTaskDialog';
import { openTaskConversation } from './taskActions';
import { useTaskStore } from './taskStore';
import { taskOfTab, taskPhase, taskTitle } from './taskView';
import type { TaskRecord } from '@shared/tasks';

// Sección «Tareas» del lateral (U30): separada de las conversaciones, con su botón «Nueva tarea».
export function TasksSection(): React.JSX.Element {
  const t = useT();
  const tasks = useTaskStore((s) => s.tasks);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <section data-tasks-section="true" className="flex flex-col gap-px">
      <SectionLabel text={t('sidebar.tasks.title')} hint={`${tasks.length}`} />
      {tasks.length === 0 && <div className="p-[2px_9px_4px] text-[11px] text-mg-muted">{t('sidebar.tasks.empty')}</div>}
      {tasks.map((task) => <TaskRow key={task.id} task={task} />)}
      <button
        data-new-task="true"
        onClick={() => setDialogOpen(true)}
        className="mx-[2px] mt-[2px] rounded-[6px] p-[4px_9px] text-left text-[11px] text-mg-icon hover:bg-mg-hover hover:text-mg-body"
      >
        ＋ {t('sidebar.tasks.new')}
      </button>
      {dialogOpen && <NewTaskDialog onClose={() => setDialogOpen(false)} />}
    </section>
  );
}

function TaskRow({ task }: { readonly task: TaskRecord }): React.JSX.Element {
  const t = useT();
  const tabId = useWorkbenchStore((s) => s.tabs.find((tab) => taskOfTab([task], tab, s.sessionIdByChat[tab.id]) !== undefined)?.id);
  const status = useWorkbenchStore((s) => (tabId === undefined ? undefined : s.statusByChat[tabId]));
  const pendingCount = useWorkbenchStore((s) => (tabId === undefined ? 0 : s.pendingByChat[tabId]?.length ?? 0));
  const phase = taskPhase({ status, pendingCount, task });
  const remove = (): void => {
    void useTaskStore.getState().remove(task.id).catch((err: unknown) => reportActionError(t('sidebar.tasks.remove'), err, 'tasks'));
  };
  return (
    <div data-task-row={task.id} data-task-phase={phase} className="group flex items-center gap-[4px] rounded-[6px] hover:bg-mg-hover">
      <button onClick={() => openTaskConversation(task, t)} className="flex min-w-0 flex-1 flex-col gap-[1px] p-[4px_9px] text-left">
        <span className="truncate text-mg-body" title={taskTitle(task.goal)}>{taskTitle(task.goal)}</span>
        <span className="text-[10px] text-mg-muted">{t(`tasks.phase.${phase}`)}</span>
      </button>
      <button
        onClick={remove}
        aria-label={t('sidebar.tasks.remove')}
        title={`${t('sidebar.tasks.remove')}. ${t('sidebar.tasks.removeHint')}`}
        className="mr-[4px] rounded-[5px] px-[5px] py-[2px] text-[11px] text-mg-icon opacity-0 hover:bg-mg-hover group-hover:opacity-100 focus-visible:opacity-100"
      >
        ✕
      </button>
    </div>
  );
}
