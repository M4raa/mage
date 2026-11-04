import { describe, expect, it } from 'vitest';
import type { PrCatalogEntry, PrSnapshot } from '@shared/pr';
import { allowedStrategies, canWrite, conversationPrKeys, nextLimit, prKeyFromUrl, prStateBadge } from './prPanelModel';

function pr(overrides: Partial<PrSnapshot> = {}): PrSnapshot {
  return { number: 7, state: 'open', isDraft: false, ...overrides } as PrSnapshot;
}

describe('nextLimit', () => {
  it('nextLimit_limitsAroundMax_clampsAtMax', () => {
    expect(nextLimit(0)).toBe(30);
    expect(nextLimit(30)).toBe(60);
    expect(nextLimit(90)).toBe(100);
    expect(nextLimit(100)).toBe(100);
  });
});

describe('allowedStrategies', () => {
  it('allowedStrategies_allOn_squashMergeRebaseOrder', () => {
    expect(allowedStrategies({ merge: true, squash: true, rebase: true })).toEqual(['squash', 'merge', 'rebase']);
  });

  it('allowedStrategies_rebaseOff_omitsRebase', () => {
    expect(allowedStrategies({ merge: true, squash: true, rebase: false })).toEqual(['squash', 'merge']);
  });

  it('allowedStrategies_noneAllowed_empty', () => {
    expect(allowedStrategies({ merge: false, squash: false, rebase: false })).toEqual([]);
  });
});

describe('conversationPrKeys', () => {
  const entries: readonly PrCatalogEntry[] = [
    { key: 'github.com/acme/demo#7', links: [{ conversationId: 'c1', primary: false }] },
    { key: 'github.com/acme/otro#7', links: [{ conversationId: 'c1', primary: true }, { conversationId: 'c2', primary: true }] },
    { key: 'no-es-una-clave', links: [{ conversationId: 'c1', primary: false }] },
    { key: 'github.com/acme/ajena#1', links: [{ conversationId: 'c2', primary: false }] },
  ];

  it('conversationPrKeys_primaryAndInvalid_primaryFirstInvalidDropped', () => {
    const keys = conversationPrKeys(entries, 'c1');

    expect(keys.map((k) => [k.key.repo, k.key.number, k.primary])).toEqual([['otro', 7, true], ['demo', 7, false]]);
  });

  it('conversationPrKeys_unknownConversation_empty', () => {
    expect(conversationPrKeys(entries, 'zzz')).toEqual([]);
    expect(conversationPrKeys([], 'c1')).toEqual([]);
  });
});

describe('prStateBadge', () => {
  it('prStateBadge_eachState_mapsBadge', () => {
    expect(prStateBadge(pr({ isDraft: true }))).toBe('draft');
    expect(prStateBadge(pr())).toBe('open');
    expect(prStateBadge(pr({ state: 'merged' }))).toBe('merged');
    expect(prStateBadge(pr({ state: 'closed', isDraft: true }))).toBe('closed');
  });
});

describe('canWrite', () => {
  it('canWrite_close_onlyWhenOpen', () => {
    expect(canWrite(pr(), 'close')).toBe(true);
    expect(canWrite(pr({ state: 'closed' }), 'close')).toBe(false);
    expect(canWrite(pr({ state: 'merged' }), 'close')).toBe(false);
  });

  it('canWrite_reopen_onlyWhenClosedNotMerged', () => {
    expect(canWrite(pr({ state: 'closed' }), 'reopen')).toBe(true);
    expect(canWrite(pr({ state: 'merged' }), 'reopen')).toBe(false);
    expect(canWrite(pr(), 'reopen')).toBe(false);
  });

  it('canWrite_mergeAndAutoMerge_onlyOpenNotDraft', () => {
    for (const kind of ['merge', 'autoMerge'] as const) {
      expect(canWrite(pr(), kind)).toBe(true);
      expect(canWrite(pr({ isDraft: true }), kind)).toBe(false);
      expect(canWrite(pr({ state: 'closed' }), kind)).toBe(false);
    }
  });

  it('canWrite_commentAndReview_onlyWhenOpen', () => {
    for (const kind of ['comment', 'review'] as const) {
      expect(canWrite(pr({ isDraft: true }), kind)).toBe(true);
      expect(canWrite(pr({ state: 'merged' }), kind)).toBe(false);
    }
  });
});

describe('prKeyFromUrl', () => {
  it('prKeyFromUrl_github_ok', () => {
    expect(prKeyFromUrl('https://github.com/Acme/demo/pull/7')).toEqual({ host: 'github.com', owner: 'acme', repo: 'demo', number: 7 });
    expect(prKeyFromUrl('https://github.com/acme/demo/pull/12/files')).toMatchObject({ number: 12 });
  });

  it('prKeyFromUrl_notPull_null', () => {
    expect(prKeyFromUrl('https://github.com/acme/demo/issues/7')).toBeNull();
    expect(prKeyFromUrl('https://example.com/acme/demo/pull/7')).toBeNull();
    expect(prKeyFromUrl('')).toBeNull();
    expect(prKeyFromUrl('https://github.com/acme/demo/pull/0')).toBeNull();
  });
});
