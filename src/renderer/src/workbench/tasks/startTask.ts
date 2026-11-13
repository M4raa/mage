import type { ImageAttachment } from '@shared/ipc';
import type { MentionResolution, MentionResolveParams } from '@shared/mentions';
import { scheduledTaskMessage } from '@shared/systemWrappers';
import type { TaskDraft, TaskRecord } from '@shared/tasks';
import { t } from '../../i18n/uiLanguage';
import { applyResolution, failedMentions } from '../mentionDraft';
import { taskDisplayName } from './taskView';

// Arranque de una tarea (R3): crea el registro, abre la conversación en la carpeta de trabajo, pasa a main el id
// de la tarea con la sesión y manda el objetivo con los documentos autorizados como menciones.
export interface StartTaskDeps {
  readonly createTask: (draft: TaskDraft) => Promise<TaskRecord>;
  readonly reloadTasks: () => Promise<void>;
  readonly activeAccountId: () => string;
  readonly setActiveAccount: (accountId: string) => void;
  readonly createConversation: (folder: { readonly cwd: string }) => Promise<void>;
  readonly activeTabId: () => string;
  readonly setActiveTab: (tabId: string) => void;
  readonly hasTab: (tabId: string) => boolean;
  readonly attachTask: (tabId: string, taskId: string) => void;
  readonly ensureSession: (tabId: string) => Promise<string>;
  readonly tabMentionContext: (tabId: string) => { readonly accountDir: string; readonly provider: string };
  readonly resolveMentions: (params: MentionResolveParams) => Promise<MentionResolution>;
  readonly sendMessageToTab: (tabId: string, text: string, attachments: readonly ImageAttachment[]) => Promise<void>;
}

// Separador deducido de la propia ruta (corre en el renderer, sin `node:path`), como `splitPath` de createdFilesView.
function splitPath(fullPath: string): { readonly dir: string; readonly name: string } {
  const cut = Math.max(fullPath.lastIndexOf('/'), fullPath.lastIndexOf('\\'));
  if (cut < 0) return { dir: '', name: fullPath };
  return { dir: fullPath.slice(0, cut), name: fullPath.slice(cut + 1) };
}

// Documentos agrupados por carpeta (una resolución por carpeta: main exige que cuelguen del `cwd`).
function groupByFolder(documents: readonly string[]): ReadonlyMap<string, readonly { readonly absPath: string; readonly relPath: string }[]> {
  const groups = new Map<string, { absPath: string; relPath: string }[]>();
  for (const absPath of documents) {
    const { dir, name } = splitPath(absPath);
    groups.set(dir, [...(groups.get(dir) ?? []), { absPath, relPath: name }]);
  }
  return groups;
}

async function resolveDocuments(documents: readonly string[], tabId: string, deps: StartTaskDeps): Promise<readonly MentionResolution[]> {
  const context = deps.tabMentionContext(tabId);
  const resolutions: MentionResolution[] = [];
  for (const [cwd, refs] of groupByFolder(documents)) {
    const resolution = await deps.resolveMentions({ cwd, accountDir: context.accountDir, provider: context.provider, refs });
    const failed = failedMentions(resolution);
    if (failed.size > 0) {
      const relPath = [...failed.keys()][0] as string;
      const path = refs.find((ref) => ref.relPath === relPath)?.absPath ?? relPath;
      throw new Error(t('tasks.error.documentFailed', { path }));
    }
    resolutions.push(resolution);
  }
  return resolutions;
}

export async function startTask(draft: TaskDraft, deps: StartTaskDeps): Promise<string> {
  if (draft.folders[0] === undefined) throw new Error(`La tarea necesita al menos una carpeta: ${JSON.stringify(draft.folders)}`);
  const task = await deps.createTask(draft);
  return launchTask(task, deps);
}

// Lanza una tarea YA registrada (a mano o por el planificador): conversación nueva en su carpeta y primer mensaje.
// Con programación, el mensaje va dentro de `<scheduled-task name="…">` (título e insignia «programada»).
export async function launchTask(task: TaskRecord, deps: StartTaskDeps): Promise<string> {
  const cwd = task.folders[0];
  if (cwd === undefined) throw new Error(`La tarea necesita al menos una carpeta: ${JSON.stringify(task.folders)}`);
  if (deps.activeAccountId() !== task.accountDir) deps.setActiveAccount(task.accountDir);
  await deps.createConversation({ cwd });
  const tabId = deps.activeTabId();
  deps.attachTask(tabId, task.id);
  await deps.ensureSession(tabId);
  await deps.reloadTasks();
  const resolutions = await resolveDocuments(task.documents, tabId, deps);
  const merged = resolutions.reduce(
    (acc, resolution) => applyResolution(acc.text, acc.attachments, resolution),
    { text: task.goal.trim(), attachments: [] as readonly ImageAttachment[] },
  );
  const text = task.schedule === null ? merged.text : scheduledTaskMessage({ name: taskDisplayName(task), text: merged.text });
  await deps.sendMessageToTab(tabId, text, merged.attachments);
  return tabId;
}

// Ejecución del PLANIFICADOR (D-8): el camino de siempre activa la cuenta de la tarea y su pestaña nueva; al acabar
// (bien o mal) se devuelven la cuenta y la pestaña que tenía el usuario. La de la tarea queda abierta, sin foco.
// "Ejecutar ahora" y "Empezar tarea" usan `launchTask` y sí la enseñan.
export async function launchTaskKeepingFocus(task: TaskRecord, deps: StartTaskDeps): Promise<string> {
  const before = { accountId: deps.activeAccountId(), tabId: deps.activeTabId() };
  try {
    return await launchTask(task, deps);
  } finally {
    restoreFocus(before, deps);
  }
}

function restoreFocus(before: { readonly accountId: string; readonly tabId: string }, deps: StartTaskDeps): void {
  if (before.accountId.length > 0 && deps.activeAccountId() !== before.accountId) deps.setActiveAccount(before.accountId);
  if (before.tabId.length > 0 && deps.activeTabId() !== before.tabId && deps.hasTab(before.tabId)) deps.setActiveTab(before.tabId);
}
