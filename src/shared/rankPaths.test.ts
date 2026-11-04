import { describe, expect, it } from 'vitest';
import { rankPaths } from './rankPaths';

describe('rankPaths', () => {
  it('rankPaths_basenamePrefixFirst', () => {
    expect(rankPaths(['x/my-app.ts', 'app.ts', 'src/app/z.ts'], 'app', 10)).toEqual(['app.ts', 'x/my-app.ts', 'src/app/z.ts']);
  });

  it('rankPaths_pathOnlyMatchLast', () => {
    expect(rankPaths(['src/app/z.ts', 'a-app.ts'], 'app', 10)).toEqual(['a-app.ts', 'src/app/z.ts']);
  });

  it('rankPaths_emptyQuery_shortestFirst', () => {
    expect(rankPaths(['bb.ts', 'a.ts', 'c.ts', 'dir/x.ts'], '', 3)).toEqual(['a.ts', 'c.ts', 'bb.ts']);
  });

  it('rankPaths_noMatch_empty', () => expect(rankPaths(['a.ts'], 'zzz', 5)).toEqual([]));

  it('rankPaths_respectsLimit', () => expect(rankPaths(['a1', 'a2', 'a3'], 'a', 2)).toHaveLength(2));

  it('rankPaths_caseInsensitive', () => expect(rankPaths(['README.md'], 'read', 5)).toEqual(['README.md']));
});
