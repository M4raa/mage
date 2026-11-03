import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@shared/conversations';
import type { ChatProject } from '@shared/settings';
import type { Tab } from './types';
import {
  accountToOpenWith,
  applySidebarFilter,
  buildSidebarRows,
  conversationSizeById,
  EMPTY_SIDEBAR_FILTER,
  folderProjectName,
  groupSidebarRows,
  mergeAccountHistories,
  normalizeFolderKey,
  projectSummary,
  providerMonogram,
  rowIndicator,
  type AccountConversation,
  type FilterContext,
  type GroupContext,
  type SidebarRow,
} from './sidebarModel';

const tab = (over: Partial<Tab> = {}): Tab => ({
  id: 'tab1',
  accountId: 'acc-a',
  accountAlias: 'a',
  cwd: 'C:\\vg\\proyecto-a',
  model: 'sonnet',
  provider: 'claude',
  title: 'abierta',
  privacy: 'shared',
  ...over,
});

const summary = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  sessionId: 's1',
  configDir: 'acc-a',
  cwd: 'C:\\vg\\proyecto-a',
  title: 'historica',
  privacy: 'shared',
  updatedAtMs: 1000,
  sizeBytes: 2048,
  isScheduled: false,
  ...over,
});

const historyRow = (over: Partial<ConversationSummary> = {}, accountId = 'acc-a'): SidebarRow => ({
  kind: 'history',
  item: summary(over),
  accountId,
});

const groupCtx = (over: Partial<GroupContext> = {}): GroupContext => ({
  projects: [],
  pinnedIds: new Set(),
  scratchRoots: [],
  sessionIdByChat: {},
  ...over,
});

const project = (over: Partial<ChatProject> = {}): ChatProject => ({
  id: 'p1',
  name: 'Mi proyecto',
  instructions: '',
  cwd: null,
  sessionIds: [],
  ...over,
});

describe('mergeAccountHistories', () => {
  it('mergeAccountHistories_sameClaudeSessionInTwoAccounts_keepsLastAccount', () => {
    const item = summary({ lastAccountId: 'acc-b' });

    const merged = mergeAccountHistories([
      { accountId: 'acc-a', items: [item] },
      { accountId: 'acc-b', items: [item] },
    ]);

    expect(merged).toEqual([{ item, accountId: 'acc-b' }]);
  });

  it('mergeAccountHistories_unknownLastAccount_keepsFirstList', () => {
    const item = summary();

    const merged = mergeAccountHistories([
      { accountId: 'acc-a', items: [item] },
      { accountId: 'acc-b', items: [item] },
    ]);

    expect(merged.map((entry) => entry.accountId)).toEqual(['acc-a']);
  });

  it('mergeAccountHistories_codexSameIdOtherProvider_keepsBoth', () => {
    const claude = summary({ updatedAtMs: 2 });
    const codex = summary({ providerId: 'codex', updatedAtMs: 1 });

    const merged = mergeAccountHistories([
      { accountId: 'acc-a', items: [claude] },
      { accountId: 'cx', items: [codex] },
    ]);

    expect(merged.map((entry) => entry.accountId)).toEqual(['acc-a', 'cx']);
  });

  it('mergeAccountHistories_empty_returnsEmpty', () => {
    expect(mergeAccountHistories([])).toEqual([]);
    expect(mergeAccountHistories([{ accountId: 'acc-a', items: [] }])).toEqual([]);
  });
});

describe('buildSidebarRows', () => {
  it('buildSidebarRows_openTabHidesHistoryRow', () => {
    const history: AccountConversation[] = [{ item: summary({ sessionId: 's1' }), accountId: 'acc-a' }];
    const open = tab({ resumeSessionId: 's1' });

    const rows = buildSidebarRows([open], history, {});

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'tab', accountId: 'acc-a', history: history[0]?.item });
  });

  it('buildSidebarRows_sortsByRecency', () => {
    const history: AccountConversation[] = [
      { item: summary({ sessionId: 'old', updatedAtMs: 10 }), accountId: 'acc-a' },
      { item: summary({ sessionId: 'new', updatedAtMs: 30 }), accountId: 'acc-b' },
    ];
    const open = tab({ lastMessageAtMs: 20 });

    const rows = buildSidebarRows([open], history, {});

    expect(rows.map((row) => (row.kind === 'tab' ? 'tab' : row.item.sessionId))).toEqual(['new', 'tab', 'old']);
  });
});

describe('proveedores y carpetas', () => {
  it('providerMonogram_knownAndCustom_mapsLetters', () => {
    expect(['claude', 'codex', 'agy', 'custom:ollama'].map(providerMonogram)).toEqual(['C', 'X', 'A', 'R']);
  });

  it('folderProjectName_windowsAndPosix_lastSegment', () => {
    expect(folderProjectName('C:\\vg\\proyecto-a\\')).toBe('proyecto-a');
    expect(folderProjectName('/home/u/app')).toBe('app');
  });

  it('folderProjectName_empty_throwsWithValue', () => {
    expect(() => folderProjectName('')).toThrow(/""/);
  });

  it('normalizeFolderKey_driveLetter_lowercases', () => {
    expect(normalizeFolderKey('C:\\Vg\\Proyecto-A\\')).toBe('c:/vg/proyecto-a');
  });

  it('normalizeFolderKey_posix_keepsCase', () => {
    expect(normalizeFolderKey('/Home/U/App/')).toBe('/Home/U/App');
  });
});

describe('groupSidebarRows', () => {
  it('groupSidebarRows_privatePinned_staysPrivate', () => {
    const row = historyRow({ sessionId: 'x', privacy: 'private' });

    const groups = groupSidebarRows([row], groupCtx({ pinnedIds: new Set(['x']) }));

    expect(groups.private).toEqual([row]);
    expect(groups.pinned).toEqual([]);
  });

  it('groupSidebarRows_pinnedTab_goesPinned', () => {
    const row: SidebarRow = { kind: 'tab', tab: tab({ pinned: true }), accountId: 'acc-a' };

    const groups = groupSidebarRows([row], groupCtx());

    expect(groups.pinned).toEqual([row]);
    expect(groups.projects).toEqual([]);
  });

  it('groupSidebarRows_userProjectWithCwd_absorbsFolder', () => {
    const user = project({ cwd: 'C:\\vg' });

    const groups = groupSidebarRows([historyRow()], groupCtx({ projects: [user] }));

    expect(groups.projects).toHaveLength(1);
    expect(groups.projects[0]).toMatchObject({ key: 'p:p1', name: 'Mi proyecto', projectId: 'p1' });
    expect(groups.projects[0]?.rows).toHaveLength(1);
  });

  it('groupSidebarRows_scratchCwd_goesUnassigned', () => {
    const row = historyRow({ cwd: 'C:\\tmp\\scratch\\abc' });

    const groups = groupSidebarRows([row, historyRow({ sessionId: 'e', cwd: '' })], groupCtx({ scratchRoots: ['C:\\tmp\\scratch'] }));

    expect(groups.unassigned).toHaveLength(2);
    expect(groups.projects).toEqual([]);
  });

  it('groupSidebarRows_twoFoldersSameName_twoGroups', () => {
    const rows = [historyRow({ sessionId: 'a', cwd: 'C:\\x\\app' }), historyRow({ sessionId: 'b', cwd: 'D:\\y\\app' })];

    const groups = groupSidebarRows(rows, groupCtx());

    expect(groups.projects.map((group) => group.key)).toEqual(['d:c:/x/app', 'd:d:/y/app']);
    expect(groups.projects.map((group) => group.name)).toEqual(['app', 'app']);
  });

  it('groupSidebarRows_emptyUserProject_listedLast', () => {
    const empty = project({ id: 'p2', name: 'Vacio' });
    const rows = [historyRow({ cwd: 'C:\\x\\app' })];

    const groups = groupSidebarRows(rows, groupCtx({ projects: [empty] }));

    expect(groups.projects.map((group) => group.key)).toEqual(['d:c:/x/app', 'p:p2']);
    expect(groups.projects[1]?.rows).toEqual([]);
  });
});

describe('applySidebarFilter', () => {
  const fctx = (over: Partial<FilterContext> = {}): FilterContext => ({
    isWorking: () => false,
    archivedIds: new Set(),
    sessionIdByChat: {},
    ...over,
  });

  it('applySidebarFilter_archivedHiddenNotCounted', () => {
    const rows = [historyRow({ sessionId: 'a' }), historyRow({ sessionId: 'b' })];

    const result = applySidebarFilter(rows, EMPTY_SIDEBAR_FILTER, fctx({ archivedIds: new Set(['b']) }));

    expect(result.rows).toHaveLength(1);
    expect(result.hiddenCount).toBe(0);
  });

  it('applySidebarFilter_archivedOnly_showsOnlyArchived', () => {
    const rows = [historyRow({ sessionId: 'a' }), historyRow({ sessionId: 'b' })];

    const result = applySidebarFilter(rows, { ...EMPTY_SIDEBAR_FILTER, archived: true }, fctx({ archivedIds: new Set(['b']) }));

    expect(result.rows.map((row) => (row.kind === 'history' ? row.item.sessionId : ''))).toEqual(['b']);
  });

  it('applySidebarFilter_providerFilter_countsHidden', () => {
    const rows = [historyRow({ sessionId: 'a' }), historyRow({ sessionId: 'b', providerId: 'codex' })];

    const result = applySidebarFilter(rows, { ...EMPTY_SIDEBAR_FILTER, provider: 'codex' }, fctx());

    expect(result.rows).toHaveLength(1);
    expect(result.hiddenCount).toBe(1);
  });

  it('applySidebarFilter_queryAndAccount_combine', () => {
    const rows = [
      historyRow({ sessionId: 'a', title: 'Arreglar login' }, 'acc-a'),
      historyRow({ sessionId: 'b', title: 'Arreglar login' }, 'acc-b'),
      historyRow({ sessionId: 'c', title: 'Otra cosa' }, 'acc-a'),
    ];

    const result = applySidebarFilter(rows, { ...EMPTY_SIDEBAR_FILTER, query: ' LOGIN ', accountId: 'acc-a' }, fctx());

    expect(result.rows).toHaveLength(1);
    expect(result.hiddenCount).toBe(2);
  });
});

describe('rowIndicator y projectSummary', () => {
  it('rowIndicator_permissionBeatsError', () => {
    expect(rowIndicator({ status: 'needs_permission', background: undefined, readOnly: false })).toBe('attention');
    expect(rowIndicator({ status: 'error', background: 'needs_action', readOnly: false })).toBe('attention');
    expect(rowIndicator({ status: 'error', background: 'working', readOnly: true })).toBe('error');
  });

  it('rowIndicator_backgroundWorking_isWorking', () => {
    expect(rowIndicator({ status: 'idle', background: 'working', readOnly: true })).toBe('working');
    expect(rowIndicator({ status: 'streaming', background: undefined, readOnly: false })).toBe('working');
  });

  it('rowIndicator_idle_null', () => {
    expect(rowIndicator({ status: undefined, background: 'done', readOnly: false })).toBeNull();
    expect(rowIndicator({ status: 'idle', background: undefined, readOnly: true })).toBe('readOnly');
  });

  it('projectSummary_countsAttentionAndWorking', () => {
    expect(projectSummary(['attention', null, 'attention', 'working'])).toEqual({ attention: 2, working: true });
    expect(projectSummary([])).toEqual({ attention: 0, working: false });
  });
});

describe('accountToOpenWith', () => {
  const active = { id: 'acc-active', providerId: 'claude' };

  it('accountToOpenWith_claudeSharedActiveClaude_usesActive', () => {
    expect(accountToOpenWith(historyRow({}, 'acc-b'), active)).toBe('acc-active');
  });

  it('accountToOpenWith_activeCodex_usesRowAccount', () => {
    expect(accountToOpenWith(historyRow({}, 'acc-b'), { id: 'cx', providerId: 'codex' })).toBe('acc-b');
    expect(accountToOpenWith(historyRow({ providerId: 'codex' }, 'cx-b'), active)).toBe('cx-b');
    expect(accountToOpenWith(historyRow({}, 'acc-b'), undefined)).toBe('acc-b');
  });

  it('accountToOpenWith_private_usesRowAccount', () => {
    expect(accountToOpenWith(historyRow({ privacy: 'private' }, 'acc-b'), active)).toBe('acc-b');
  });
});

describe('conversationSizeById', () => {
  it('conversationSizeById_sameHistory_returnsSameMapWithSizes', () => {
    const history: AccountConversation[] = [{ item: summary({ sessionId: 'a', sizeBytes: 5 }), accountId: 'acc-a' }];

    const first = conversationSizeById(history);

    expect(first.get('a')).toBe(5);
    expect(conversationSizeById(history)).toBe(first);
  });

  it('conversationSizeById_empty_returnsEmptyMap', () => {
    expect(conversationSizeById([]).size).toBe(0);
  });
});
