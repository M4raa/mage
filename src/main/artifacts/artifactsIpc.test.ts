import { describe, expect, it, vi } from 'vitest';
import { listArtifacts, moreArtifacts, requireArtifactAccount, type ArtifactsIpcDeps } from './artifactsIpc';

const ACCOUNT = '/home/u/.claude';

function deps(overrides: Partial<ArtifactsIpcDeps> = {}): ArtifactsIpcDeps {
  return {
    handle: vi.fn(),
    service: { page: vi.fn(async () => ({ accountId: ACCOUNT, rel: 'mine' as const, items: [], nextPageToken: null })), listAll: vi.fn(async () => []) },
    accountIds: () => [ACCOUNT],
    ...overrides,
  };
}

describe('artifactsIpc', () => {
  it('listArtifacts_valid_listsTheCurrentAccounts', async () => {
    // Arrange
    const d = deps();

    // Act
    await listArtifacts(d, { refresh: true });

    // Assert
    expect(d.service.listAll).toHaveBeenCalledWith([ACCOUNT], true);
  });

  it('listArtifacts_extraField_throwsWithValue', () => {
    expect(() => listArtifacts(deps(), { refresh: false, accountId: 'x' })).toThrow(/inválida.*accountId/);
  });

  it('moreArtifacts_valid_asksThatPageWithoutCache', async () => {
    // Arrange
    const d = deps();

    // Act
    await moreArtifacts(d, { accountId: ACCOUNT, rel: 'shared', pageToken: 'p2' });

    // Assert
    expect(d.service.page).toHaveBeenCalledWith(ACCOUNT, 'shared', { pageToken: 'p2', refresh: false });
  });

  it('moreArtifacts_accountWithoutList_throws', () => {
    expect(() => moreArtifacts(deps(), { accountId: '/etc', rel: 'mine', pageToken: 'p2' })).toThrow(/\/etc/);
  });

  it('moreArtifacts_badRelOrEmptyToken_throws', () => {
    expect(() => moreArtifacts(deps(), { accountId: ACCOUNT, rel: 'all', pageToken: 'p2' })).toThrow(/inválida/);
    expect(() => moreArtifacts(deps(), { accountId: ACCOUNT, rel: 'mine', pageToken: '' })).toThrow(/inválida/);
  });

  it('requireArtifactAccount_known_returnsIt', () => {
    expect(requireArtifactAccount(deps(), ACCOUNT)).toBe(ACCOUNT);
  });
});
