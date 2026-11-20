import { describe, expect, it } from 'vitest';
import type { AccountArtifacts, ArtifactSummary } from '@shared/artifactLibrary';
import { audienceLabel, withMorePage } from './artifactsLibraryModel';

function item(id: string, accountId = 'a'): ArtifactSummary {
  return { accountId, id, kind: 'page', rel: 'mine', title: id, openUrl: '', audience: 'owner', sortTime: null, external: false };
}

function entry(accountId: string, mineIds: readonly string[], token: string | null): AccountArtifacts {
  return {
    accountId,
    mine: { ok: true, page: { accountId, rel: 'mine', items: mineIds.map((id) => item(id, accountId)), nextPageToken: token } },
    shared: { ok: false, error: { key: 'events.detailOnly', values: { detail: 'x' } } },
  };
}

describe('withMorePage', () => {
  it('withMorePage_matchingList_appendsItemsAndTakesNewToken', () => {
    // Arrange
    const entries = [entry('a', ['1'], 'p2'), entry('b', ['9'], null)];

    // Act
    const next = withMorePage(entries, { accountId: 'a', rel: 'mine', items: [item('2')], nextPageToken: null });

    // Assert
    const mine = next[0]!.mine;
    expect(mine.ok && mine.page.items.map((i) => i.id)).toEqual(['1', '2']);
    expect(mine.ok && mine.page.nextPageToken).toBeNull();
    expect(next[1]).toBe(entries[1]);
  });

  it('withMorePage_listInError_isLeftAsIs', () => {
    // Arrange
    const entries = [entry('a', [], null)];

    // Act
    const next = withMorePage(entries, { accountId: 'a', rel: 'shared', items: [item('2')], nextPageToken: null });

    // Assert
    expect(next[0]).toBe(entries[0]);
  });

  it('withMorePage_unknownAccount_changesNothing', () => {
    // Arrange
    const entries = [entry('a', ['1'], 'p2')];

    // Act
    const next = withMorePage(entries, { accountId: 'z', rel: 'mine', items: [item('2')], nextPageToken: null });

    // Assert
    expect(next).toEqual(entries);
  });

  it('withMorePage_noEntries_isEmpty', () => {
    expect(withMorePage([], { accountId: 'a', rel: 'mine', items: [], nextPageToken: null })).toEqual([]);
  });
});

describe('audienceLabel', () => {
  const translate = (key: string): string => `«${key}»`;

  it.each([
    ['owner', '«chat.artifact.audience.owner»'],
    ['users', '«chat.artifact.audience.users»'],
    ['org', '«chat.artifact.audience.org»'],
    ['public', '«chat.artifact.audience.public»'],
  ])('audienceLabel_known_%s_isTranslated', (audience, expected) => {
    expect(audienceLabel(translate, audience)).toBe(expected);
  });

  it('audienceLabel_unknown_isShownAsIs', () => {
    expect(audienceLabel(translate, 'workspace')).toBe('workspace');
  });

  it('audienceLabel_prototypeName_isNotALabel', () => {
    expect(audienceLabel(translate, 'toString')).toBe('toString');
  });

  it('audienceLabel_empty_isEmpty', () => {
    expect(audienceLabel(translate, '')).toBe('');
  });
});
