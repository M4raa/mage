import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { useT } from '../../i18n/uiLanguage';
import { usePaneTabId } from '../paneContext';
import { DISCLOSURE_VARIANTS } from '../motionPresets';
import { backgroundTasksSummary, type BackgroundTaskRow } from '../backgroundTasks';
import { formatElapsed } from '../thinkingStatus';
import { Icon } from './Icon';
import { RotatingChevron } from './AnimatedIcon';
import { AGENT_STATE_DOT, useNow } from './AgentsDock';

// Tareas en segundo plano ANCLADAS encima del input (P-038 V2): un Bash con `run_in_background`, un monitor…
// Sin esto, con el turno acabado y el comando aún corriendo, el chat parecía colgado. Dock propio, aparte del de
// agentes (decisión del usuario), con el mismo estilo: una línea de resumen que se despliega en una fila por tarea.
const NO_TASKS: readonly BackgroundTaskRow[] = [];

export function TasksDock(): React.JSX.Element {
  const tabId = usePaneTabId();
  const tasks = useWorkbenchStore((s) => s.backgroundTasksByChat[tabId] ?? NO_TASKS);
  return <AnimatePresence initial={false}>{tasks.length > 0 && <TasksDockBody key="tasks" tabId={tabId} tasks={tasks} />}</AnimatePresence>;
}

function TasksDockBody({ tabId, tasks }: { readonly tabId: string; readonly tasks: readonly BackgroundTaskRow[] }): React.JSX.Element {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const now = useNow(true);
  return (
    <motion.div variants={DISCLOSURE_VARIANTS} initial="initial" animate="animate" exit="exit" className="overflow-hidden px-[22px] pt-[8px]">
      <div data-tasks-dock="true" role="group" aria-label={t('chat.tasks.ariaLabel')} className="overflow-hidden rounded-[10px] border border-mg-border bg-mg-panel">
        <button
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          data-tasks-dock-summary="true"
          className="flex h-[26px] w-full min-w-0 items-center gap-[8px] pl-[10px] pr-[10px] text-left text-[11px] text-mg-body2 hover:text-mg-text"
        >
          <RotatingChevron open={expanded} size={10} />
          <span aria-hidden="true" className={`h-[7px] w-[7px] flex-none rounded-full ${AGENT_STATE_DOT.running}`} />
          <span className="flex-none font-semibold">{backgroundTasksSummary(tasks.length, t)}</span>
          {/* Plegado, la primera tarea dice QUÉ corre (lo que más ayuda a no creer el chat colgado). */}
          {!expanded && <span className="min-w-0 flex-1 truncate text-mg-sec">{tasks[0]?.description}</span>}
        </button>
        {expanded && tasks.map((task) => <TaskRow key={task.taskId} tabId={tabId} task={task} elapsedMs={now - task.sinceMs} />)}
      </div>
    </motion.div>
  );
}

function TaskRow({ tabId, task, elapsedMs }: { readonly tabId: string; readonly task: BackgroundTaskRow; readonly elapsedMs: number }): React.JSX.Element {
  const t = useT();
  const stopTask = useWorkbenchStore((s) => s.stopSubagent);
  return (
    <div data-tasks-dock-row={task.taskId} className="flex h-[26px] items-center gap-[8px] border-t border-mg-border-subtle pl-[28px] pr-[6px] text-[11px]">
      <Icon name="toolBash" size={11} className="flex-none text-mg-sec" />
      <span className="min-w-0 flex-1 truncate text-mg-body2" title={task.description}>{task.description}</span>
      <span className="flex-none font-mono text-[10px] text-mg-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatElapsed(elapsedMs)}
      </span>
      {/* `stop_task` es el mismo control del CLI que para un subagente: vale para cualquier `task_id`. */}
      <button
        onClick={() => stopTask(tabId, task.taskId)}
        data-tasks-stop="true"
        aria-label={t('chat.tasks.stopAria', { name: task.description })}
        data-tip={t('chat.tasks.stopTip')}
        className="flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[4px] text-mg-muted hover:bg-mg-danger-bg hover:text-mg-danger"
      >
        <Icon name="stop" size={10} />
      </button>
    </div>
  );
}
