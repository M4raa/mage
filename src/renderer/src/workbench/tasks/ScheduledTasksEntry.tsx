import { useT } from '../../i18n/uiLanguage';
import { Icon } from '../components/Icon';
import { useWorkbenchStore } from '../workbenchStore';
import { useTaskStore } from './taskStore';

// Entrada del lateral que abre la pantalla «Tareas programadas» (sustituye a la antigua sección «Tareas»).
export function ScheduledTasksEntry(): React.JSX.Element {
  const t = useT();
  const count = useTaskStore((s) => s.tasks.length);
  const open = useWorkbenchStore((s) => s.openScheduledTasks);
  return (
    <button
      data-scheduled-tasks-entry="true"
      onClick={open}
      className="mx-[2px] flex items-center gap-[7px] rounded-[6px] p-[4px_9px] text-left text-[12px] text-mg-body hover:bg-mg-hover"
    >
      <Icon name="clock" size={13} />
      <span className="min-w-0 flex-1 truncate">{t('sidebar.scheduledTasks')}</span>
      <span className="text-[10.5px] text-mg-muted">{count}</span>
    </button>
  );
}
