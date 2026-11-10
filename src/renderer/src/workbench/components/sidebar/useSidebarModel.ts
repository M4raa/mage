import { useMemo } from 'react';
import { useTaskStore } from '../../tasks/taskStore';
import { buildTaskIndex, isTaskRow } from '../../tasks/taskView';
import { useWorkbenchStore, type WorkbenchState } from '../../workbenchStore';
import type { Account, ChatStatus } from '../../types';
import { backgroundOfConversation, type BackgroundSession } from '../../backgroundWork';
import {
  applySidebarFilter,
  buildSidebarRows,
  groupSidebarRows,
  missingOwnerOf as findMissingOwner,
  providerOfRow,
  rowAccountKnown,
  rowIndicator,
  sidebarRowId,
  EMPTY_SIDEBAR_FILTER,
  type RowIndicator,
  type SidebarFilter,
  type SidebarGroups,
  type SidebarRow,
} from '../../sidebarModel';

const KEY_SEPARATOR = '|';
const PAIR_SEPARATOR = '=';

// Estados vivos y bloqueos como CADENAS: un selector que devuelve un primitivo solo vuelve a pintar el lateral
// cuando cambia el conjunto de conversaciones trabajando, no con cada delta de cada conversación (F2.5).
function liveStatusKey(s: WorkbenchState): string {
  return s.tabs
    .map((tab) => `${tab.id}${PAIR_SEPARATOR}${s.statusByChat[tab.id] ?? 'idle'}`)
    .filter((pair) => !pair.endsWith(`${PAIR_SEPARATOR}idle`))
    .join(KEY_SEPARATOR);
}

function readOnlyKey(s: WorkbenchState): string {
  return s.tabs.filter((tab) => s.lockByChat[tab.id]?.owner === false).map((tab) => tab.id).join(KEY_SEPARATOR);
}

function parseStatuses(key: string): ReadonlyMap<string, ChatStatus> {
  const pairs = key.length === 0 ? [] : key.split(KEY_SEPARATOR);
  return new Map(pairs.map((pair) => {
    const at = pair.lastIndexOf(PAIR_SEPARATOR);
    return [pair.slice(0, at), pair.slice(at + 1) as ChatStatus] as const;
  }));
}

export interface SidebarView {
  readonly groups: SidebarGroups;
  readonly hiddenCount: number;
  readonly workingCount: number;
  readonly providers: readonly string[];
  readonly accounts: readonly Account[];
  readonly filterActive: boolean;
  readonly statusOf: (row: SidebarRow) => ChatStatus | undefined;
  readonly indicatorOf: (row: SidebarRow) => RowIndicator | null;
  readonly backgroundOf: (row: SidebarRow) => BackgroundSession | undefined;
  readonly accountOf: (row: SidebarRow) => Account | undefined;
  readonly missingOwnerOf: (row: SidebarRow) => string | undefined;
}

// Todo lo que el lateral necesita para pintarse: filas de todas las cuentas, filtradas y agrupadas. Estado
// bruto + `useMemo` (nunca un selector que devuelva un array nuevo por render: bucle en Zustand v5).
export function useSidebarModel(filter: SidebarFilter): SidebarView {
  const tabs = useWorkbenchStore((s) => s.tabs);
  const sessionIdByChat = useWorkbenchStore((s) => s.sessionIdByChat);
  const history = useWorkbenchStore((s) => s.allConversationHistory);
  const accounts = useWorkbenchStore((s) => s.accounts);
  const settings = useWorkbenchStore((s) => s.settings);
  const scratchRoots = useWorkbenchStore((s) => s.scratchRoots);
  const backgroundSessions = useWorkbenchStore((s) => s.backgroundSessions);
  const tasks = useTaskStore((s) => s.tasks);
  const statusKey = useWorkbenchStore(liveStatusKey);
  const lockKey = useWorkbenchStore(readOnlyKey);
  const statuses = useMemo(() => parseStatuses(statusKey), [statusKey]);
  const readOnlyIds = useMemo(() => new Set(lockKey.length === 0 ? [] : lockKey.split(KEY_SEPARATOR)), [lockKey]);
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const taskIndex = useMemo(() => buildTaskIndex(tasks), [tasks]);
  const rows = useMemo(() => buildSidebarRows(tabs, history, sessionIdByChat).filter((row) => !isTaskRow(row, taskIndex, sessionIdByChat)), [tabs, history, sessionIdByChat, taskIndex]);

  return useMemo(() => {
    const backgroundOf = (row: SidebarRow): BackgroundSession | undefined => {
      const id = sidebarRowId(row, sessionIdByChat);
      return row.kind === 'history' && id !== undefined ? backgroundOfConversation(backgroundSessions, id) : undefined;
    };
    const statusOf = (row: SidebarRow): ChatStatus | undefined => (row.kind === 'tab' ? statuses.get(row.tab.id) : undefined);
    const indicatorOf = (row: SidebarRow): RowIndicator | null =>
      rowIndicator({ status: statusOf(row), background: backgroundOf(row)?.state, readOnly: row.kind === 'tab' && readOnlyIds.has(row.tab.id) });
    // «Trabajando»: lo que avanza o espera una respuesta tuya.
    const isWorking = (row: SidebarRow): boolean => {
      const indicator = indicatorOf(row);
      return indicator === 'working' || indicator === 'attention';
    };
    const archivedIds = new Set(settings.archivedConversations);
    const filtered = applySidebarFilter(rows, filter, { isWorking, archivedIds, sessionIdByChat });
    const groups = groupSidebarRows(filtered.rows, { projects: settings.chatProjects, pinnedIds: new Set(settings.pinnedConversations), scratchRoots, sessionIdByChat });
    const visibleToChips = applySidebarFilter(rows, EMPTY_SIDEBAR_FILTER, { isWorking, archivedIds, sessionIdByChat }).rows;
    const accountIds = new Set(rows.filter(rowAccountKnown).map((row) => row.accountId));
    return {
      groups,
      hiddenCount: filtered.hiddenCount,
      workingCount: visibleToChips.filter(isWorking).length,
      providers: [...new Set(rows.map(providerOfRow))],
      accounts: accounts.filter((account) => accountIds.has(account.id)),
      filterActive: filter.archived || filter.working || filter.provider !== null || filter.accountId !== null || filter.query.trim().length > 0,
      statusOf,
      indicatorOf,
      backgroundOf,
      // Sin cuenta conocida no se nombra ninguna (antes salía la activa en todas las compartidas sin apuntar).
      accountOf: (row) => (findMissingOwner(row, (id) => accountById.has(id)) === undefined && rowAccountKnown(row) ? accountById.get(row.accountId) : undefined),
      missingOwnerOf: (row) => findMissingOwner(row, (id) => accountById.has(id)),
    };
  }, [rows, filter, statuses, readOnlyIds, settings, scratchRoots, sessionIdByChat, backgroundSessions, accounts, accountById]);
}
