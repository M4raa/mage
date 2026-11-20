import { describe, expect, it, vi } from 'vitest';
import type { AccountInfo } from '@shared/accounts';
import { UserFacingError, localized } from '@shared/i18n/localizedText';
import { ARTIFACT_LIST_TTL_MS, ArtifactsService, artifactAccountIds, listPath, toArtifactPage } from './artifactsService';

const MINE = '/home/u/.claude';
const OTHER = '/home/u/.claude-p';

// Fila como la medida en la lista `mine` (CLI 2.1.319), con campos que no deben cruzar al renderer.
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'page',
    id: '477497ff-1111-2222-3333-444455556666',
    rel: 'mine',
    title: 'Informe',
    open_url: 'https://claude.ai/artifact/ApBG3JewJ2xSMoUq4UFmkW',
    audience: 'owner',
    sort_time: '2026-11-19T22:44:00Z',
    owner_account: 'acct-SECRET',
    thumbnail_url: 'https://x.frame.claudeusercontent.com/_f/1/_thumb.img?t=SECRET',
    view_count: 3,
    ...overrides,
  };
}

function account(overrides: Partial<AccountInfo>): AccountInfo {
  return {
    configDir: MINE, name: '.claude', isMain: true, providerId: 'claude', authKind: 'subscription', email: null, org: null,
    loginStatus: 'logged_in', expiresAt: null, defaultModel: null, ...overrides,
  };
}

describe('listPath', () => {
  it('listPath_firstPage_hasRelKindSortAndLimit', () => {
    // Act
    const path = listPath('shared', null);

    // Assert
    expect(path).toBe('/api/frame/artifacts?rel=shared&kind=page%2Cdocument&sort=last_viewed&limit=30');
  });

  it('listPath_withToken_addsPageToken', () => {
    // Act
    const query = new URLSearchParams(listPath('mine', 'tok+/=').split('?')[1]);

    // Assert
    expect(query.get('rel')).toBe('mine');
    expect(query.get('page_token')).toBe('tok+/=');
  });
});

describe('toArtifactPage', () => {
  it('toArtifactPage_validRow_exposesOnlyTheAllowedFields', () => {
    // Act
    const page = toArtifactPage(MINE, 'mine', { artifacts: [row()], next_page_token: 'next' });

    // Assert
    expect(page.items).toEqual([{
      accountId: MINE, id: '477497ff-1111-2222-3333-444455556666', kind: 'page', rel: 'mine', title: 'Informe',
      openUrl: 'https://claude.ai/artifact/ApBG3JewJ2xSMoUq4UFmkW', audience: 'owner', sortTime: Date.parse('2026-11-19T22:44:00Z'), external: false,
    }]);
    expect(JSON.stringify(page)).not.toContain('SECRET');
    expect(page.nextPageToken).toBe('next');
  });

  it('toArtifactPage_softDeletedOrUnknownKind_areDropped', () => {
    // Act
    const page = toArtifactPage(MINE, 'mine', { artifacts: [row({ soft_deleted: true }), row({ kind: 'canvas' }), row({ id: 'b', kind: 'document' })] });

    // Assert
    expect(page.items.map((item) => item.id)).toEqual(['b']);
  });

  it('toArtifactPage_unsafeIdOrMissingId_isDropped', () => {
    // Act
    const page = toArtifactPage(MINE, 'mine', { artifacts: [row({ id: 'evil.example.com/x' }), row({ id: undefined }), null] });

    // Assert
    expect(page.items).toEqual([]);
  });

  it('toArtifactPage_openUrlOfOtherHost_becomesEmpty', () => {
    // Act
    const page = toArtifactPage(MINE, 'mine', { artifacts: [row({ open_url: 'https://claude.ai.evil.com/a' }), row({ id: 'c', open_url: 'javascript:alert(1)' })] });

    // Assert
    expect(page.items.map((item) => item.openUrl)).toEqual(['', '']);
  });

  it('toArtifactPage_outsideOrganization_isExternal', () => {
    // Act
    const page = toArtifactPage(MINE, 'shared', { artifacts: [row({ outside_organization: true })] });

    // Assert
    expect(page.items[0]).toMatchObject({ rel: 'shared', external: true });
  });

  it('toArtifactPage_badDatesAndMissingOptionals_degradeToNullAndEmpty', () => {
    // Act
    const page = toArtifactPage(MINE, 'shared', { artifacts: [{ id: 'd', kind: 'page', sort_time: 'ayer', title: 42 }] });

    // Assert
    expect(page.items[0]).toMatchObject({ title: '', audience: '', openUrl: '', sortTime: null });
  });

  it('toArtifactPage_nullListAndNoToken_isEmptyWithoutNext', () => {
    // Act
    const page = toArtifactPage(MINE, 'mine', { artifacts: null, next_page_token: '' });

    // Assert
    expect(page).toEqual({ accountId: MINE, rel: 'mine', items: [], nextPageToken: null });
  });

  it('toArtifactPage_notAnObject_throwsWithAccount', () => {
    // Act + Assert
    expect(() => toArtifactPage(MINE, 'mine', 'html')).toThrow(/\.claude/);
  });
});

describe('artifactAccountIds', () => {
  it('artifactAccountIds_onlyClaudeSubscriptionsWithSession', () => {
    // Arrange
    const accounts = [
      account({ configDir: 'sub' }),
      account({ configDir: 'expired', loginStatus: 'expired' }),
      account({ configDir: 'api', authKind: 'api-key' }),
      account({ configDir: 'out', loginStatus: 'logged_out' }),
      account({ configDir: 'codex', providerId: 'codex' }),
    ];

    // Act
    const ids = artifactAccountIds(accounts);

    // Assert
    expect(ids).toEqual(['sub', 'expired']);
  });

  it('artifactAccountIds_empty_isEmpty', () => {
    expect(artifactAccountIds([])).toEqual([]);
  });
});

describe('ArtifactsService', () => {
  function serviceWith(getJson: (accountId: string, path: string) => Promise<unknown>, clock = { now: 1_000 }): ArtifactsService {
    return new ArtifactsService({ client: { getJson: vi.fn(getJson) }, now: () => clock.now });
  }

  it('page_withinTtl_servesCacheWithoutFetching', async () => {
    // Arrange
    const getJson = vi.fn(async () => ({ artifacts: [row()] }));
    const clock = { now: 1_000 };
    const service = serviceWith(getJson, clock);
    await service.page(MINE, 'mine', { pageToken: null, refresh: false });
    clock.now += ARTIFACT_LIST_TTL_MS - 1;

    // Act
    await service.page(MINE, 'mine', { pageToken: null, refresh: false });

    // Assert
    expect(getJson).toHaveBeenCalledTimes(1);
  });

  it('page_afterTtl_refetches', async () => {
    // Arrange
    const getJson = vi.fn(async () => ({ artifacts: [] }));
    const clock = { now: 1_000 };
    const service = serviceWith(getJson, clock);
    await service.page(MINE, 'mine', { pageToken: null, refresh: false });
    clock.now += ARTIFACT_LIST_TTL_MS;

    // Act
    await service.page(MINE, 'mine', { pageToken: null, refresh: false });

    // Assert
    expect(getJson).toHaveBeenCalledTimes(2);
  });

  it('page_refresh_skipsCacheAndReplacesIt', async () => {
    // Arrange
    const getJson = vi.fn().mockResolvedValueOnce({ artifacts: [] }).mockResolvedValueOnce({ artifacts: [row()] });
    const service = serviceWith(getJson);
    await service.page(MINE, 'mine', { pageToken: null, refresh: false });

    // Act
    await service.page(MINE, 'mine', { pageToken: null, refresh: true });
    const cached = await service.page(MINE, 'mine', { pageToken: null, refresh: false });

    // Assert
    expect(getJson).toHaveBeenCalledTimes(2);
    expect(cached.items).toHaveLength(1);
  });

  it('page_cacheIsPerAccountAndRel', async () => {
    // Arrange
    const getJson = vi.fn(async () => ({ artifacts: [] }));
    const service = serviceWith(getJson);

    // Act
    await service.page(MINE, 'mine', { pageToken: null, refresh: false });
    await service.page(MINE, 'shared', { pageToken: null, refresh: false });
    await service.page(OTHER, 'mine', { pageToken: null, refresh: false });

    // Assert
    expect(getJson).toHaveBeenCalledTimes(3);
  });

  it('page_withToken_neverUsesCache', async () => {
    // Arrange
    const getJson = vi.fn(async () => ({ artifacts: [] }));
    const service = serviceWith(getJson);

    // Act
    await service.page(MINE, 'mine', { pageToken: 'p2', refresh: false });
    await service.page(MINE, 'mine', { pageToken: 'p2', refresh: false });

    // Assert
    expect(getJson).toHaveBeenCalledTimes(2);
    expect((getJson.mock.calls as unknown[][])[0]![1]).toContain('page_token=p2');
  });

  it('page_emptyAccount_throws', async () => {
    await expect(serviceWith(async () => ({})).page(' ', 'mine', { pageToken: null, refresh: false })).rejects.toThrow(/Cuenta vacia/);
  });

  it('listAll_oneAccountFails_othersStillListed', async () => {
    // Arrange
    const expired = new UserFacingError(localized('errors.artifacts.sessionExpired', { account: OTHER }));
    const service = serviceWith(async (accountId) => {
      if (accountId === OTHER) throw expired;
      return { artifacts: [row()] };
    });

    // Act
    const result = await service.listAll([MINE, OTHER], false);

    // Assert
    expect(result[0]).toMatchObject({ accountId: MINE, mine: { ok: true }, shared: { ok: true } });
    expect(result[1]).toMatchObject({ accountId: OTHER, mine: { ok: false, error: expired.localized }, shared: { ok: false } });
  });

  it('listAll_foreignError_travelsAsText', async () => {
    // Arrange
    const service = serviceWith(async () => {
      throw new Error('ECONNRESET');
    });

    // Act
    const [entry] = await service.listAll([MINE], false);

    // Assert
    expect(entry!.mine).toEqual({ ok: false, error: { key: 'events.detailOnly', values: { detail: 'ECONNRESET' } } });
  });

  it('listAll_noAccounts_isEmpty', async () => {
    expect(await serviceWith(async () => ({})).listAll([], false)).toEqual([]);
  });
});
