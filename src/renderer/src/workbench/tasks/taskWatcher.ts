import { t } from '../../i18n/uiLanguage';
import { reportActionError } from '../notificationStore';
import type { ChatStatus } from '../types';
import { useWorkbenchStore } from '../workbenchStore';
import { useTaskStore } from './taskStore';
import { declaredDeliverablesOf, shouldVerify, taskOfTab } from './taskView';

// Vigilante de tareas (R3): al acabar un turno de una pestaña de tarea con un manifiesto nuevo, pide a main que
// compruebe los entregables; y recarga la lista cuando una pestaña de tarea queda quieta (Codex recibe ahí el
// `conversationId` de su hilo). La decisión vive en `taskView.ts`; esto solo la enchufa.
let started = false;

function checkTabs(prev: Readonly<Record<string, ChatStatus>>): void {
  const state = useWorkbenchStore.getState();
  const { tasks, load, verify } = useTaskStore.getState();
  for (const tab of state.tabs) {
    const before = prev[tab.id];
    const now = state.statusByChat[tab.id];
    if (before === now) continue;
    const task = taskOfTab(tasks, tab, state.sessionIdByChat[tab.id]);
    if (task === undefined) continue;
    if (now === 'idle') void load().catch((err: unknown) => reportActionError(t('tasks.error.verifyFailed'), err, 'tasks'));
    const declared = declaredDeliverablesOf(state.blocksByChat[tab.id] ?? []);
    if (!shouldVerify(before, now, declared, task) || declared === null) continue;
    void verify(task.id, declared).catch((err: unknown) => reportActionError(t('tasks.error.verifyFailed'), err, 'tasks'));
  }
}

export function startTaskWatcher(): void {
  if (started) return;
  started = true;
  let previous = useWorkbenchStore.getState().statusByChat;
  useWorkbenchStore.subscribe((state) => {
    if (state.statusByChat === previous) return;
    const before = previous;
    previous = state.statusByChat;
    checkTabs(before);
  });
}
