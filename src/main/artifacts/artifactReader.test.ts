import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import {
  ArtifactReader, MAX_ARTIFACT_BYTES, MAX_ARTIFACT_FILES, artifactCacheDir, bootPath, contentUrl, parseBoot, planArtifactFiles,
  type ArtifactCacheFs, type ArtifactReaderDeps,
} from './artifactReader';

const ID = '477497ff-1111-2222-3333-444455556666';
const ACCOUNT = '/home/u/.claude';
const USER_DATA = path.resolve('/datos/Mage');

// Boot como el medido (CLI 2.1.319), con los campos sensibles que no deben salir.
function boot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ver: '5-abc123', assetToken: 'ASSET-SECRET', share_key: 'SHARE-SECRET', subscriptionToken: 'SUB-SECRET',
    author: { account_uuid: 'AUTHOR-SECRET', email: 'a@b.c' }, title: 'Informe',
    files: [{ path: 'index.html', contentType: 'text/html' }, { path: 'css/a.css', contentType: 'text/css' }],
    perm: { role: 'owner' },
    ...overrides,
  };
}

function memoryFs(existing: readonly string[] = []): ArtifactCacheFs & { files: Map<string, Uint8Array>; dirs: Set<string> } {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>(existing);
  return {
    files,
    dirs,
    exists: (target) => dirs.has(target) || files.has(target),
    mkdir: (target) => void dirs.add(target),
    writeFile: (target, bytes) => void files.set(target, bytes),
    rename: (from, to) => {
      for (const [key, value] of [...files]) if (key.startsWith(from)) files.set(to + key.slice(from.length), value);
      dirs.add(to);
    },
    rmrf: vi.fn(),
  };
}

function reader(overrides: Partial<ArtifactReaderDeps> = {}): ArtifactReader {
  return new ArtifactReader({
    client: { getJson: vi.fn(async () => boot()), getAsset: vi.fn(async () => new Uint8Array([1, 2, 3])) },
    userDataDir: USER_DATA,
    fs: memoryFs(),
    newId: () => 'n1',
    ...overrides,
  });
}

describe('parseBoot', () => {
  it('parseBoot_measuredShape_keepsOnlyWhatIsUsed', () => {
    // Act
    const parsed = parseBoot(boot());

    // Assert
    expect(parsed).toEqual({ ver: '5-abc123', assetToken: 'ASSET-SECRET', title: 'Informe', files: ['index.html', 'css/a.css'] });
    expect(JSON.stringify(parsed)).not.toMatch(/SHARE-SECRET|SUB-SECRET|AUTHOR-SECRET/);
  });

  it('parseBoot_missingToken_throwsNamingFieldsNotValues', () => {
    // Act
    const run = (): unknown => parseBoot(boot({ assetToken: undefined, share_key: 'SHARE-SECRET' }));

    // Assert
    expect(run).toThrow(/assetToken/);
    expect(run).toThrow(expect.objectContaining({ message: expect.not.stringContaining('SHARE-SECRET') }));
  });

  it('parseBoot_unsafeVersion_throws', () => {
    expect(() => parseBoot(boot({ ver: '../x' }))).toThrow(/Version/);
  });

  it('parseBoot_noFiles_throws', () => {
    expect(() => parseBoot(boot({ files: [] }))).toThrow(/files/);
  });

  it('parseBoot_noTitle_isEmpty', () => {
    expect(parseBoot(boot({ title: null })).title).toBe('');
  });
});

describe('planArtifactFiles', () => {
  it('planArtifactFiles_nested_splitsInSegments', () => {
    expect(planArtifactFiles(['index.html', 'css/a.css'])).toEqual([['index.html'], ['css', 'a.css']]);
  });

  it('planArtifactFiles_exactlyTheMaximum_isAccepted', () => {
    // Arrange
    const files = ['index.html', ...Array.from({ length: MAX_ARTIFACT_FILES - 1 }, (_, i) => `f${i}.js`)];

    // Act + Assert
    expect(planArtifactFiles(files)).toHaveLength(MAX_ARTIFACT_FILES);
  });

  it('planArtifactFiles_overTheMaximum_throwsClearly', () => {
    // Arrange
    const files = ['index.html', ...Array.from({ length: MAX_ARTIFACT_FILES }, (_, i) => `f${i}.js`)];

    // Act + Assert
    expect(() => planArtifactFiles(files)).toThrow(/21 ficheros.*20/);
  });

  it.each(['../evil.html', 'a/../../b.js', '/abs.html', 'C:\\x.html', 'a//b.js', '', 'a\\b.js', '.hidden'])('planArtifactFiles_unsafePath_throws (%s)', (file) => {
    expect(() => planArtifactFiles(['index.html', file])).toThrow(/no valida/);
  });

  it('planArtifactFiles_entryNotHtml_throws', () => {
    expect(() => planArtifactFiles(['doc.md'])).toThrow(/doc\.md/);
  });

  it('planArtifactFiles_empty_throws', () => {
    expect(() => planArtifactFiles([])).toThrow(/HTML/);
  });
});

describe('cache paths and urls', () => {
  it('artifactCacheDir_isUnderUserDataByAccountIdAndVer', () => {
    // Act
    const dir = artifactCacheDir(USER_DATA, ACCOUNT, ID, '5-abc');

    // Assert
    const relative = path.relative(USER_DATA, dir).split(path.sep);
    expect(relative[0]).toBe('artifact-cache');
    expect(relative[1]).toMatch(/^[0-9a-f]{16}$/);
    expect(relative.slice(2)).toEqual([ID, '5-abc']);
  });

  it('artifactCacheDir_differentAccounts_differentDirs', () => {
    expect(artifactCacheDir(USER_DATA, ACCOUNT, ID, '1')).not.toBe(artifactCacheDir(USER_DATA, '/home/u/.claude-p', ID, '1'));
  });

  it.each([['evil/..', '1'], [ID, '..']])('artifactCacheDir_unsafeIdOrVer_throws (%s, %s)', (id, ver) => {
    expect(() => artifactCacheDir(USER_DATA, ACCOUNT, id, ver)).toThrow(/no valid/);
  });

  it('contentUrl_isTheMeasuredRouteOnTheArtifactHost', () => {
    expect(contentUrl(ID, '5-abc', ['css', 'a b.css'], 't+/=')).toBe(`https://${ID}.frame.claudeusercontent.com/_f/5-abc/css/a%20b.css?__frame_t=t%2B%2F%3D`);
  });

  it('bootPath_isTheMeasuredRoute', () => {
    expect(bootPath(ID)).toBe(`/api/frame/${ID}?via=model_read&bk=probe`);
  });
});

describe('ArtifactReader.ensureCached', () => {
  it('ensureCached_firstOpen_downloadsAllFilesAndReturnsNoToken', async () => {
    // Arrange
    const fs = memoryFs();
    const getAsset = vi.fn(async () => new Uint8Array([1]));
    const r = reader({ fs, client: { getJson: vi.fn(async () => boot()), getAsset } });

    // Act
    const cached = await r.ensureCached(ACCOUNT, ID);

    // Assert
    const root = artifactCacheDir(USER_DATA, ACCOUNT, ID, '5-abc123');
    expect(cached).toEqual({ root, entryPath: path.join(root, 'index.html'), title: 'Informe' });
    expect(getAsset).toHaveBeenCalledTimes(2);
    expect(fs.files.has(path.join(root, 'css', 'a.css'))).toBe(true);
    expect(JSON.stringify(cached)).not.toContain('SECRET');
  });

  it('ensureCached_versionAlreadyCached_onlyAsksBoot', async () => {
    // Arrange
    const root = artifactCacheDir(USER_DATA, ACCOUNT, ID, '5-abc123');
    const getAsset = vi.fn(async () => new Uint8Array());
    const r = reader({ fs: memoryFs([root]), client: { getJson: vi.fn(async () => boot()), getAsset } });

    // Act
    await r.ensureCached(ACCOUNT, ID);

    // Assert
    expect(getAsset).not.toHaveBeenCalled();
  });

  it('ensureCached_sharesOneTotalBudget', async () => {
    // Arrange
    const getAsset = vi.fn(async (_url: string, _max: number) => new Uint8Array(1000));
    const r = reader({ client: { getJson: vi.fn(async () => boot()), getAsset } });

    // Act
    await r.ensureCached(ACCOUNT, ID);

    // Assert
    expect(getAsset.mock.calls.map((call) => call[1])).toEqual([MAX_ARTIFACT_BYTES, MAX_ARTIFACT_BYTES - 1000]);
  });

  it('ensureCached_overTotalBudget_throwsTotalTooLargeAndWritesNothing', async () => {
    // Arrange
    const fs = memoryFs();
    const tooLarge = new UserFacingError(localized('errors.artifacts.tooLarge', { file: 'css/a.css', limitKib: 1 }));
    const getAsset = vi.fn().mockResolvedValueOnce(new Uint8Array(1)).mockRejectedValueOnce(tooLarge);
    const r = reader({ fs, client: { getJson: vi.fn(async () => boot()), getAsset } });

    // Act + Assert
    await expect(r.ensureCached(ACCOUNT, ID)).rejects.toThrow(/10 MiB en total/);
    expect(fs.files.size).toBe(0);
  });

  it('ensureCached_otherAssetError_isRethrownAsIs', async () => {
    // Arrange
    const r = reader({ client: { getJson: vi.fn(async () => boot()), getAsset: vi.fn(async () => { throw new Error('ECONNRESET'); }) } });

    // Act + Assert
    await expect(r.ensureCached(ACCOUNT, ID)).rejects.toThrow('ECONNRESET');
  });

  it('ensureCached_renameLostTheRace_reusesTheOtherCopy', async () => {
    // Arrange
    const fs = memoryFs();
    const root = artifactCacheDir(USER_DATA, ACCOUNT, ID, '5-abc123');
    fs.rename = () => {
      fs.dirs.add(root);
      throw new Error('EPERM');
    };
    const r = reader({ fs });

    // Act
    const cached = await r.ensureCached(ACCOUNT, ID);

    // Assert
    expect(cached.root).toBe(root);
    expect(fs.rmrf).toHaveBeenCalledWith(`${root}.tmp-n1`);
  });

  it('ensureCached_renameFailsWithoutCopy_throws', async () => {
    // Arrange
    const fs = memoryFs();
    fs.rename = () => {
      throw new Error('EACCES');
    };

    // Act + Assert
    await expect(reader({ fs }).ensureCached(ACCOUNT, ID)).rejects.toThrow('EACCES');
  });

  it('ensureCached_unsafeId_throwsWithoutRequests', async () => {
    // Arrange
    const getJson = vi.fn();
    const r = reader({ client: { getJson, getAsset: vi.fn() } });

    // Act + Assert
    await expect(r.ensureCached(ACCOUNT, 'x.evil.com/')).rejects.toThrow(/no valido/);
    expect(getJson).not.toHaveBeenCalled();
  });
});
