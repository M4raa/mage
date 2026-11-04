import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileIndexService, INDEX_TTL_MS, type FileIndexDeps } from './fileIndex';

const CWD = '/proj';
const params = (query = '', limit = 10) => ({ cwd: CWD, accountDir: '/acc', query, limit });

function makeDeps(overrides: Partial<FileIndexDeps> = {}): FileIndexDeps {
  return {
    listGitFiles: vi.fn(async () => ['src/app.ts', 'docs/spec.pdf', 'img/logo.png']),
    walk: vi.fn(async () => ['walked.ts']),
    isTrusted: () => true,
    stat: vi.fn(async () => ({ bytes: 42 })),
    readHead: vi.fn(async () => new Uint8Array([65])),
    now: () => 0,
    ...overrides,
  };
}

describe('FileIndexService.search', () => {
  it('search_untrusted_returnsUntrustedEmpty', async () => {
    const deps = makeDeps({ isTrusted: () => false });

    const result = await new FileIndexService(deps).search(params());

    expect(result).toEqual({ candidates: [], truncated: false, reason: 'untrusted' });
    expect(deps.listGitFiles).not.toHaveBeenCalled();
  });

  it('search_gitList_rankedAndClassified', async () => {
    const result = await new FileIndexService(makeDeps()).search(params());

    expect(result.reason).toBe('ok');
    expect(result.candidates.map((c) => [c.relPath, c.kind, c.bytes])).toEqual([
      ['src/app.ts', 'text', 42],
      ['img/logo.png', 'image', 42],
      ['docs/spec.pdf', 'pdf', 42],
    ]);
    expect(result.candidates[0]?.absPath).toBe(join(CWD, 'src/app.ts'));
  });

  it('search_noRepo_fallsBackToWalk', async () => {
    const deps = makeDeps({ listGitFiles: vi.fn(async () => null) });

    const result = await new FileIndexService(deps).search(params());

    expect(result.candidates.map((c) => c.relPath)).toEqual(['walked.ts']);
    expect(deps.walk).toHaveBeenCalledWith(CWD, 50_000);
  });

  it('search_cachedWithinTtl_listsOnce', async () => {
    const deps = makeDeps({ now: () => 1000 });
    const service = new FileIndexService(deps);

    await service.search(params('a'));
    await service.search(params('b'));

    expect(deps.listGitFiles).toHaveBeenCalledTimes(1);
  });

  it('search_afterTtl_relists', async () => {
    let now = 0;
    const deps = makeDeps({ now: () => now });
    const service = new FileIndexService(deps);

    await service.search(params());
    now = INDEX_TTL_MS + 1;
    await service.search(params());

    expect(deps.listGitFiles).toHaveBeenCalledTimes(2);
  });

  it('search_missingFile_dropped', async () => {
    const deps = makeDeps({ stat: vi.fn(async (abs: string) => (abs.endsWith('app.ts') ? null : { bytes: 1 })) });

    const result = await new FileIndexService(deps).search(params());

    expect(result.candidates.map((c) => c.relPath)).toEqual(['img/logo.png', 'docs/spec.pdf']);
  });

  it('search_invalidLimit_throwsWithValue', async () => {
    const service = new FileIndexService(makeDeps());

    await expect(service.search(params('', 0))).rejects.toThrow(/0/);
    await expect(service.search(params('', 51))).rejects.toThrow(/51/);
    await expect(service.search(params('', 1.5))).rejects.toThrow(/1\.5/);
  });
});
