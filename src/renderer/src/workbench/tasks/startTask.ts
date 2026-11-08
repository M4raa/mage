import type { ImageAttachment } from '@shared/ipc';
import type { MentionResolution, MentionResolveParams } from '@shared/mentions';
import type { TaskDraft, TaskRecord } from '@shared/tasks';
import { t } from '../../i18n/uiLanguage';
import { applyResolution, failedMentions } from '../mentionDraft';

// Arranque de una tarea (R3): crea el registro, abre la conversación en la carpeta de trabajo, pasa a main el id
// de la tarea con la sesión y manda el objetivo con los documentos autorizados como menciones.
export interface StartTaskDeps {
  readonly createTask: (draft: TaskDraft) => Promise<TaskRecord>;
  readonly reloadTasks: () => Promise<void>;
  readonly activeAccountId: () => string;
  readonly setActiveAccount: (accountId: string) => void;
  readonly createConversation: (folder: { readonly cwd: string }) => Promise<void>;
  readonly activeTabId: () => string;
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
  const cwd = draft.folders[0];
  if (cwd === undefined) throw new Error(`La tarea necesita al menos una carpeta: ${JSON.stringify(draft.folders)}`);
  const task = await deps.createTask(draft);
  if (deps.activeAccountId() !== draft.accountDir) deps.setActiveAccount(draft.accountDir);
  await deps.createConversation({ cwd });
  const tabId = deps.activeTabId();
  deps.attachTask(tabId, task.id);
  await deps.ensureSession(tabId);
  await deps.reloadTasks();
  const resolutions = await resolveDocuments(draft.documents, tabId, deps);
  const merged = resolutions.reduce(
    (acc, resolution) => applyResolution(acc.text, acc.attachments, resolution),
    { text: draft.goal.trim(), attachments: [] as readonly ImageAttachment[] },
  );
  await deps.sendMessageToTab(tabId, merged.text, merged.attachments);
  return tabId;
}
