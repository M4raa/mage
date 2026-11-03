// Modelo PURO del lateral de conversaciones de TODAS las cuentas (D6): fusión de los historiales,
// agrupación (Fijadas → Proyectos → Sin proyecto → Privadas), filtros e indicadores de fila. Sin store
// ni IPC: el componente solo pinta lo que sale de aquí.
import type { ConversationSummary } from '@shared/conversations';
import type { ChatProject } from '@shared/settings';
import type { Tab, ChatStatus } from './types';
import type { BackgroundState } from './backgroundWork';
import { rowRecency, rowTitle } from './conversationList';
import { conversationIdOfTab } from './conversationId';
import { projectForRow } from './chatProjects';
import { isInside } from './chatInfoView';

const DEFAULT_PROVIDER = 'claude';

export interface AccountConversation {
  readonly item: ConversationSummary;
  readonly accountId: string;
}

export interface AccountHistory {
  readonly accountId: string;
  readonly items: readonly ConversationSummary[];
}

function historyKey(item: ConversationSummary): string {
  return `${item.providerId ?? DEFAULT_PROVIDER}:${item.privacy}:${item.sessionId}`;
}

// Une los historiales de varias cuentas. Una conversación compartida de Claude sale en todas las cuentas de
// Claude (`projects/` está enlazado): queda UNA vez, con la cuenta con la que se usó por última vez o, si no se
// sabe, la primera que la listó.
export function mergeAccountHistories(lists: readonly AccountHistory[]): AccountConversation[] {
  const byKey = new Map<string, AccountConversation>();
  for (const list of lists) {
    for (const item of list.items) {
      const key = historyKey(item);
      const current = byKey.get(key);
      const isLastAccount = item.lastAccountId !== undefined && list.accountId === item.lastAccountId;
      if (current === undefined || (isLastAccount && current.accountId !== item.lastAccountId)) {
        byKey.set(key, { item, accountId: list.accountId });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => b.item.updatedAtMs - a.item.updatedAtMs);
}

export type SidebarRow =
  | { readonly kind: 'tab'; readonly tab: Tab; readonly history?: ConversationSummary; readonly accountId: string }
  | { readonly kind: 'history'; readonly item: ConversationSummary; readonly accountId: string };

// Id de la conversación de una fila (el que lleva el historial), o undefined si la pestaña aún no tiene.
export function sidebarRowId(row: SidebarRow, sessionIdByChat: Readonly<Record<string, string>>): string | undefined {
  if (row.kind === 'history') return row.item.sessionId;
  return conversationIdOfTab(row.tab, sessionIdByChat[row.tab.id]);
}

export function providerOfRow(row: SidebarRow): string {
  return row.kind === 'tab' ? row.tab.provider : (row.item.providerId ?? DEFAULT_PROVIDER);
}

function privacyOfRow(row: SidebarRow): 'shared' | 'private' {
  return row.kind === 'tab' ? row.tab.privacy : row.item.privacy;
}

function cwdOfRow(row: SidebarRow): string {
  return row.kind === 'tab' ? row.tab.cwd : row.item.cwd;
}

// Pestañas abiertas + historial de todas las cuentas, por recencia. Una conversación abierta se enseña con su
// estado vivo y su entrada de historial se descarta.
export function buildSidebarRows(
  tabs: readonly Tab[],
  history: readonly AccountConversation[],
  sessionIdByChat: Readonly<Record<string, string>>,
): SidebarRow[] {
  const historyById = new Map(history.map((entry) => [entry.item.sessionId, entry.item]));
  const openIds = new Set<string>();
  const tabRows = tabs.map((tab): SidebarRow => {
    const id = conversationIdOfTab(tab, sessionIdByChat[tab.id]);
    if (id !== undefined) openIds.add(id);
    const known = id === undefined ? undefined : historyById.get(id);
    return known === undefined
      ? { kind: 'tab', tab, accountId: tab.accountId }
      : { kind: 'tab', tab, history: known, accountId: tab.accountId };
  });
  const historyRows = history
    .filter((entry) => !openIds.has(entry.item.sessionId))
    .map((entry): SidebarRow => ({ kind: 'history', item: entry.item, accountId: entry.accountId }));
  return [...tabRows, ...historyRows].sort((a, b) => rowRecency(b) - rowRecency(a));
}

export type ProviderMonogram = 'C' | 'X' | 'A' | 'R';

const MONOGRAMS: Readonly<Record<string, ProviderMonogram>> = { claude: 'C', codex: 'X', agy: 'A' };

// Letra del proveedor; cualquier otro es un proveedor del usuario (runtime propio).
export function providerMonogram(providerId: string): ProviderMonogram {
  return MONOGRAMS[providerId] ?? 'R';
}

const SEPARATORS = /[\\/]+/;

// Nombre de un proyecto por carpeta: su último segmento.
export function folderProjectName(cwd: string): string {
  const last = cwd.split(SEPARATORS).filter((segment) => segment.length > 0).at(-1);
  if (last === undefined) throw new Error(`Carpeta sin nombre de proyecto: ${JSON.stringify(cwd)}`);
  return last;
}

// Clave estable de una carpeta: separadores a `/`, sin barra final y, con letra de unidad (Windows), sin
// distinguir mayúsculas.
export function normalizeFolderKey(cwd: string): string {
  const slashed = cwd.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[a-z]:/i.test(slashed) ? slashed.toLowerCase() : slashed;
}

export interface ProjectGroup {
  readonly key: string;
  readonly name: string;
  readonly cwd: string | null;
  readonly projectId: string | null;
  readonly rows: SidebarRow[];
}

export interface SidebarGroups {
  readonly pinned: SidebarRow[];
  readonly projects: ProjectGroup[];
  readonly unassigned: SidebarRow[];
  readonly private: SidebarRow[];
}

export interface GroupContext {
  readonly projects: readonly ChatProject[];
  readonly pinnedIds: ReadonlySet<string>;
  readonly scratchRoots: readonly string[];
  readonly sessionIdByChat: Readonly<Record<string, string>>;
}

function isPinnedRow(row: SidebarRow, ctx: GroupContext): boolean {
  if (row.kind === 'tab' && row.tab.pinned === true) return true;
  const id = sidebarRowId(row, ctx.sessionIdByChat);
  return id !== undefined && ctx.pinnedIds.has(id);
}

function isScratchRow(row: SidebarRow, scratchRoots: readonly string[]): boolean {
  const cwd = cwdOfRow(row);
  return cwd.trim().length === 0 || scratchRoots.some((root) => root.length > 0 && isInside(cwd, root));
}

// Grupo de proyecto de una fila compartida, o null si va a «Sin proyecto».
function projectGroupFor(row: SidebarRow, ctx: GroupContext): Omit<ProjectGroup, 'rows'> | null {
  const project = projectForRow(row, ctx.projects, ctx.sessionIdByChat);
  if (project !== undefined) return { key: `p:${project.id}`, name: project.name, cwd: project.cwd, projectId: project.id };
  if (isScratchRow(row, ctx.scratchRoots)) return null;
  const cwd = cwdOfRow(row);
  return { key: `d:${normalizeFolderKey(cwd)}`, name: folderProjectName(cwd), cwd, projectId: null };
}

function groupRecency(group: ProjectGroup): number {
  return Math.max(0, ...group.rows.map(rowRecency));
}

// Los grupos con filas, por su fila más reciente; los vacíos (proyectos del usuario sin conversaciones), al final
// por nombre.
function sortProjectGroups(groups: readonly ProjectGroup[]): ProjectGroup[] {
  const filled = groups.filter((group) => group.rows.length > 0).sort((a, b) => groupRecency(b) - groupRecency(a));
  const empty = groups.filter((group) => group.rows.length === 0).sort((a, b) => a.name.localeCompare(b.name));
  return [...filled, ...empty];
}

function addToProjectGroup(groups: Map<string, ProjectGroup>, target: Omit<ProjectGroup, 'rows'>, row: SidebarRow): void {
  const existing = groups.get(target.key);
  if (existing !== undefined) {
    existing.rows.push(row);
    return;
  }
  groups.set(target.key, { ...target, rows: [row] });
}

export function groupSidebarRows(rows: readonly SidebarRow[], ctx: GroupContext): SidebarGroups {
  const pinned: SidebarRow[] = [];
  const unassigned: SidebarRow[] = [];
  const privateRows: SidebarRow[] = [];
  const groups = new Map<string, ProjectGroup>(
    ctx.projects.map((project) => [
      `p:${project.id}`,
      { key: `p:${project.id}`, name: project.name, cwd: project.cwd, projectId: project.id, rows: [] },
    ]),
  );
  for (const row of rows) {
    if (privacyOfRow(row) === 'private') {
      privateRows.push(row);
      continue;
    }
    if (isPinnedRow(row, ctx)) {
      pinned.push(row);
      continue;
    }
    const target = projectGroupFor(row, ctx);
    if (target === null) unassigned.push(row);
    else addToProjectGroup(groups, target, row);
  }
  return { pinned, projects: sortProjectGroups([...groups.values()]), unassigned, private: privateRows };
}

export interface SidebarFilter {
  readonly working: boolean;
  readonly provider: string | null;
  readonly accountId: string | null;
  readonly archived: boolean;
  readonly query: string;
}

export const EMPTY_SIDEBAR_FILTER: SidebarFilter = { working: false, provider: null, accountId: null, archived: false, query: '' };

export interface FilterContext {
  readonly isWorking: (row: SidebarRow) => boolean;
  readonly archivedIds: ReadonlySet<string>;
  readonly sessionIdByChat: Readonly<Record<string, string>>;
}

function matchesFilter(row: SidebarRow, filter: SidebarFilter, ctx: FilterContext, needle: string): boolean {
  if (filter.working && !ctx.isWorking(row)) return false;
  if (filter.provider !== null && providerOfRow(row) !== filter.provider) return false;
  if (filter.accountId !== null && row.accountId !== filter.accountId) return false;
  return needle.length === 0 || rowTitle(row).toLowerCase().includes(needle);
}

// El archivado va primero y NO cuenta como «oculto»; lo que quitan los demás filtros sí.
export function applySidebarFilter(
  rows: readonly SidebarRow[],
  filter: SidebarFilter,
  ctx: FilterContext,
): { rows: SidebarRow[]; hiddenCount: number } {
  const needle = filter.query.trim().toLowerCase();
  const scoped = rows.filter((row) => {
    const id = sidebarRowId(row, ctx.sessionIdByChat);
    return (id !== undefined && ctx.archivedIds.has(id)) === filter.archived;
  });
  const kept = scoped.filter((row) => matchesFilter(row, filter, ctx, needle));
  return { rows: kept, hiddenCount: scoped.length - kept.length };
}

export type RowIndicator = 'attention' | 'error' | 'working' | 'readOnly';

export function rowIndicator(state: {
  readonly status: ChatStatus | undefined;
  readonly background: BackgroundState | undefined;
  readonly readOnly: boolean;
}): RowIndicator | null {
  if (state.status === 'needs_permission' || state.background === 'needs_action') return 'attention';
  if (state.status === 'error') return 'error';
  if (state.status === 'streaming' || state.background === 'working') return 'working';
  return state.readOnly ? 'readOnly' : null;
}

export function projectSummary(indicators: readonly (RowIndicator | null)[]): { readonly attention: number; readonly working: boolean } {
  return {
    attention: indicators.filter((indicator) => indicator === 'attention').length,
    working: indicators.includes('working'),
  };
}

// Con qué cuenta se abre una fila: una conversación compartida de Claude se abre con la cuenta activa si es de
// Claude (regla de `openConversation`); el resto, con la de la fila.
export function accountToOpenWith(row: SidebarRow, active: { readonly id: string; readonly providerId: string } | undefined): string {
  const isSharedClaudeHistory = row.kind === 'history' && providerOfRow(row) === DEFAULT_PROVIDER && row.item.privacy === 'shared';
  if (isSharedClaudeHistory && active !== undefined && active.providerId === DEFAULT_PROVIDER) return active.id;
  return row.accountId;
}
