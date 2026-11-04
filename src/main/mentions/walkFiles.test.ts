import { describe, expect, it } from 'vitest';
import { walkFiles, type WalkDeps, type WalkEntry } from './walkFiles';

type Node = 'file' | 'dir' | 'link';
const entry = (name: string, type: Node): WalkEntry => ({
  name,
  isDirectory: () => type === 'dir',
  isFile: () => type === 'file',
  isSymbolicLink: () => type === 'link',
});

function makeDeps(tree: Record<string, readonly [string, Node][]>): WalkDeps {
  return {
    readdir: async (abs) => (tree[abs] ?? []).map(([name, type]) => entry(name, type)),
    onUnreadable: () => undefined,
  };
}

describe('walkFiles', () => {
  it('walkFiles_skipsIgnoredAndSymlinks', async () => {
    const deps = makeDeps({
      '/r': [['a.ts', 'file'], ['node_modules', 'dir'], ['.git', 'dir'], ['src', 'dir'], ['escape', 'link']],
      '/r/src': [['b.ts', 'file'], ['dist', 'dir']],
      '/r/node_modules': [['x.js', 'file']],
      '/r/escape': [['secret.txt', 'file']],
    });

    expect((await walkFiles('/r', 100, deps)).sort()).toEqual(['a.ts', 'src/b.ts']);
  });

  it('walkFiles_stopsAtMax', async () => {
    const deps = makeDeps({ '/r': [['a', 'file'], ['b', 'file'], ['c', 'file']] });

    expect(await walkFiles('/r', 2, deps)).toEqual(['a', 'b']);
  });

  it('walkFiles_invalidMax_throwsWithValue', async () => {
    await expect(walkFiles('/r', 0, makeDeps({}))).rejects.toThrow(/0/);
  });
});
