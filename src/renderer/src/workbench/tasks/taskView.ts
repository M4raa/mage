import type { LibraryView } from '@shared/ipc';
import { parseDeliverables, parsePlan, type TaskPlanStep, type TaskRecord } from '@shared/tasks';
import { conversationIdOfTab } from '../conversationId';
import { sidebarRowId, type SidebarRow } from '../sidebarModel';
import type { Block, ChatStatus, Tab } from '../types';

// Modelo puro de las tareas en el renderer (R3): qué conversación es de una tarea, qué plan y qué entregables
// anunció el agente, en qué fase está y cuándo toca comprobar. Sin React ni store.

const TITLE_MAX_CHARS = 80;
const ELLIPSIS = '…';

export interface TaskIndex {
  readonly sessionIds: ReadonlySet<string>;
  readonly conversationIds: ReadonlySet<string>;
}

export function buildTaskIndex(tasks: readonly TaskRecord[]): TaskIndex {
  const sessionIds = new Set<string>();
  const conversationIds = new Set<string>();
  for (const task of tasks) {
    if (task.sessionId !== null) sessionIds.add(task.sessionId);
    if (task.conversationId !== null) conversationIds.add(task.conversationId);
  }
  return { sessionIds, conversationIds };
}

export function taskOfTab(
  tasks: readonly TaskRecord[],
  tab: Pick<Tab, 'provider' | 'resumeSessionId'>,
  liveSessionId: string | undefined,
): TaskRecord | undefined {
  const conversationId = conversationIdOfTab(tab, liveSessionId);
  return tasks.find((task) =>
    (liveSessionId !== undefined && task.sessionId === liveSessionId)
    || (conversationId !== undefined && task.conversationId === conversationId));
}

export function isTaskRow(row: SidebarRow, index: TaskIndex, sessionIdByChat: Readonly<Record<string, string>>): boolean {
  const id = sidebarRowId(row, sessionIdByChat);
  if (id !== undefined && index.conversationIds.has(id)) return true;
  if (row.kind !== 'tab') return false;
  const live = sessionIdByChat[row.tab.id];
  return live !== undefined && index.sessionIds.has(live);
}

// Texto de cada bloque del agente, en orden.
export function agentTexts(blocks: readonly Block[]): readonly string[] {
  return blocks.flatMap((block) => (block.kind === 'agent' ? [block.runs.map((run) => run.text).join('')] : []));
}

// Del ÚLTIMO bloque del agente que traiga algo válido (un manifiesto roto no tapa el anterior bueno).
function lastParsed<T>(blocks: readonly Block[], parse: (text: string) => T | null): T | null {
  const texts = agentTexts(blocks);
  for (let i = texts.length - 1; i >= 0; i -= 1) {
    const found = parse(texts[i] as string);
    if (found !== null) return found;
  }
  return null;
}

export const planOf = (blocks: readonly Block[]): readonly TaskPlanStep[] | null => lastParsed(blocks, parsePlan);

export const declaredDeliverablesOf = (blocks: readonly Block[]): readonly string[] | null => lastParsed(blocks, parseDeliverables);

export type TaskPhase = 'working' | 'waiting' | 'unverified' | 'needsReview' | 'verified';

export function taskPhase(input: { readonly status: ChatStatus | undefined; readonly pendingCount: number; readonly task: TaskRecord }): TaskPhase {
  if (input.pendingCount > 0 || input.status === 'needs_permission') return 'waiting';
  if (input.status === 'streaming') return 'working';
  if (input.task.verdict === 'verified') return 'verified';
  if (input.task.verdict === 'incomplete') return 'needsReview';
  return 'unverified';
}

export function taskTitle(goal: string): string {
  const first = goal.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? '';
  if (first.length <= TITLE_MAX_CHARS) return first;
  return `${first.slice(0, TITLE_MAX_CHARS - 1)}${ELLIPSIS}`;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((value, i) => value === b[i]);

// Comprobar cuando el turno acaba y el manifiesto es distinto del ya comprobado.
export function shouldVerify(
  prev: ChatStatus | undefined,
  next: ChatStatus | undefined,
  declared: readonly string[] | null,
  task: TaskRecord,
): boolean {
  if (prev !== 'streaming' || next !== 'idle' || declared === null) return false;
  return !sameList(declared, task.deliverables.map((d) => d.declared));
}

export interface TaskForm {
  readonly goal: string;
  readonly accountDir: string;
  readonly folders: readonly string[];
}

export function canStartTask(form: TaskForm): boolean {
  return form.goal.trim().length > 0 && form.accountDir.length > 0 && form.folders.length > 0;
}

export interface TaskCapability {
  readonly packageId: string;
  readonly title: string;
}

const sameDir = (a: string, b: string, platform: string): boolean => (platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

// Capacidades instaladas y activas de ese motor y esa cuenta, con el título legible de su entrada.
export function capabilitiesFor(
  view: Pick<LibraryView, 'platform' | 'entries' | 'installs'>,
  provider: string,
  accountDir: string,
): readonly TaskCapability[] {
  const titles = new Map(view.entries.map((entry) => [entry.id, entry.title]));
  return view.installs
    .filter((install) => install.enabled && install.engine === provider && sameDir(install.accountDir, accountDir, view.platform))
    .map((install) => ({ packageId: install.packageId, title: titles.get(install.packageId) ?? install.packageId }));
}
