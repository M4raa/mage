// Cableado real de las tareas (store del workbench + window.mage). Sin tests: la lógica vive en startTask.ts y taskRunner.ts.
import type { TaskRecord } from '@shared/tasks';
import { t } from '../../i18n/uiLanguage';
import { describeError } from '../describeError';
import { reportActionError } from '../notificationStore';
import { useWorkbenchStore } from '../workbenchStore';
import { launchTaskKeepingFocus, type StartTaskDeps } from './startTask';
import { useTaskStore } from './taskStore';
import type { ScheduledRunsDeps } from './taskRunner';
import { taskOfTab } from './taskView';

// Dependencias reales de `startTask`: el store de tareas y el del workbench, leídos en cada llamada.
export function realStartTaskDeps(): StartTaskDeps {
  const store = (): ReturnType<typeof useWorkbenchStore.getState> => useWorkbenchStore.getState();
  return {
    createTask: (draft) => useTaskStore.getState().create(draft),
    reloadTasks: () => useTaskStore.getState().load(),
    activeAccountId: () => store().activeAccountId,
    setActiveAccount: (accountId) => store().setActiveAccount(accountId),
    createConversation: (folder) => store().createConversation(folder),
    activeTabId: () => store().activeTabId,
    setActiveTab: (tabId) => store().setActiveTab(tabId),
    hasTab: (tabId) => store().tabs.some((tab) => tab.id === tabId),
    attachTask: (tabId, taskId) => store().attachTaskToTab(tabId, taskId),
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

// Abre la conversación de la tarea: su pestaña si está abierta; si no, la del historial.
export function openTaskConversation(task: TaskRecord, translate: typeof t): void {
  const state = useWorkbenchStore.getState();
  const tab = state.tabs.find((candidate) => taskOfTab([task], candidate, state.sessionIdByChat[candidate.id]) !== undefined);
  if (tab !== undefined) {
    state.setActiveTab(tab.id);
    state.focusPrompt();
    return;
  }
  const entry = state.allConversationHistory.find((candidate) => task.conversationId !== null && candidate.item.sessionId === task.conversationId);
  if (entry !== undefined) {
    state.openConversation(entry.item, task.accountDir);
    return;
  }
  reportActionError(translate('tasks.error.conversationNotFound'), new Error(`conversationId=${String(task.conversationId)}`), 'tasks');
}

export function realScheduledRunsDeps(): ScheduledRunsDeps {
  return {
    takeDue: () => window.mage.takeDueTaskRuns(),
    launch: (task) => launchTaskKeepingFocus(task, realStartTaskDeps()),
    reportFailed: (taskId, error) => window.mage.reportTaskRunFailed({ taskId, error }),
    reload: () => useTaskStore.getState().load(),
    onDue: (listener) => window.mage.onTasksDue(listener),
    reportError: (err) => reportActionError(t('scheduledTasks.error.runFailed'), err, 'tasks'),
    describe: describeError,
  };
}
