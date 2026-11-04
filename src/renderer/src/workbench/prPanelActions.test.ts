import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrDetail, PrKey } from '@shared/pr';
import { prKeyToString } from '@shared/pr';
import { createPrPanelActions, resetPrPanelState, type PrPanelDeps } from './prPanelActions';
import type { WorkbenchState } from './workbenchStore';
import { t } from '../i18n/uiLanguage';

const KEY: PrKey = { host: 'github.com', owner: 'acme', repo: 'demo', number: 7 };
const HEAD = 'a'.repeat(40);

function detail(headSha = HEAD): PrDetail {
  return { key: KEY, number: 7, headSha, headRefName: 'feat', baseRefName: 'main', state: 'open', isDraft: false } as PrDetail;
}

function setup(tabOverrides: Record<string, unknown> = {}) {
  const state = {
    tabs: [{ id: 't1', cwd: '/r', accountId: 'acc', resumeSessionId: 'conv-1', provider: 'claude', ...tabOverrides }],
    sessionIdByChat: {},
    prPanelByTab: {},
    prDetailByKey: { [prKeyToString(KEY)]: detail() },
    prDiffByKey: {},
    prCatalog: [],
    prMergeOptionsByRepo: {},
  } as unknown as WorkbenchState;
  const mage = {
    prRepoOf: vi.fn(async () => ({ host: 'github.com', owner: 'acme', repo: 'demo' })),
    listPrs: vi.fn(async () => ({ kind: 'off', reason: 'error' })),
    prDetail: vi.fn(async () => detail('b'.repeat(40))),
    prDiff: vi.fn(),
    writePr: vi.fn(),
    listPrCatalog: vi.fn(async () => []),
    linkPr: vi.fn(),
    unlinkPr: vi.fn(),
    migrateTabPr: vi.fn(async () => null),
  };
  const insertPrompt = vi.fn();
  const deps = {
    mage,
    get: () => state,
    set: (fn: (s: WorkbenchState) => Partial<WorkbenchState>) => Object.assign(state, fn(state)),
    insertPrompt,
  } as unknown as PrPanelDeps;
  return { actions: createPrPanelActions(deps), state, mage, insertPrompt };
}

describe('createPrPanelActions', () => {
  beforeEach(() => resetPrPanelState());

  it('runPrAction_loadedDetail_sendsItsHeadAsExpected', async () => {
    const { actions, mage } = setup();
    mage.writePr.mockResolvedValue({ kind: 'ok' });

    await actions.runPrAction('t1', KEY, { kind: 'close' });

    expect(mage.writePr).toHaveBeenCalledWith({ cwd: '/r', accountDir: 'acc', key: KEY, expectedHeadSha: HEAD, action: { kind: 'close' } });
    expect(mage.prDetail).toHaveBeenCalledTimes(1);
  });

  it('runPrAction_headChanged_reportsConflictAndReloadsDetail', async () => {
    const { actions, mage, state } = setup();
    mage.writePr.mockResolvedValue({ kind: 'conflict', currentHeadSha: 'b'.repeat(40) });

    await actions.runPrAction('t1', KEY, { kind: 'merge', strategy: 'squash', deleteBranch: false });

    expect(state.prPanelByTab.t1?.error).toBe(t('pr.conflict'));
    expect(state.prDetailByKey[prKeyToString(KEY)]?.headSha).toBe('b'.repeat(40));
    expect(mage.listPrs).not.toHaveBeenCalled();
  });

  it('migratePrOnce_calledTwice_migratesOnce', async () => {
    const { actions, mage } = setup({ prNumber: 7 });

    await actions.migratePrOnce('t1');
    await actions.migratePrOnce('t1');

    expect(mage.migrateTabPr).toHaveBeenCalledTimes(1);
    expect(mage.migrateTabPr).toHaveBeenCalledWith({ cwd: '/r', accountDir: 'acc', conversationId: 'conv-1', number: 7 });
  });

  it('migratePrOnce_tabWithoutPrNumber_doesNothing', async () => {
    const { actions, mage } = setup();

    await actions.migratePrOnce('t1');

    expect(mage.migrateTabPr).not.toHaveBeenCalled();
  });

  it('insertResolveConflictsPrompt_loadedDetail_insertsPromptWithBranches', () => {
    const { actions, insertPrompt } = setup();

    actions.insertResolveConflictsPrompt('t1', KEY);

    expect(insertPrompt).toHaveBeenCalledWith('t1', expect.stringContaining('#7 (feat'));
  });
});
