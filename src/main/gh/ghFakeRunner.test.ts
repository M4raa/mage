import { beforeEach, describe, expect, it } from 'vitest';
import { resetFakeGh, runFakeGh } from './ghFakeRunner';

const OPTIONS = { cwd: '/r', env: {} };
const DEMO = 'github.com/acme/demo';
const OTHER = 'github.com/acme/otro';

async function gh(...args: string[]): Promise<{ code: number; stdout: string }> {
  return runFakeGh('gh-falso', args, OPTIONS);
}

async function view(repo: string, fields = 'title,state,headRefOid,reviewDecision,comments'): Promise<Record<string, unknown>> {
  return JSON.parse((await gh('pr', 'view', '7', '-R', repo, '--json', fields)).stdout) as Record<string, unknown>;
}

describe('runFakeGh panel de PR', () => {
  beforeEach(resetFakeGh);

  it('fake_twoReposSameNumber_differentTitles', async () => {
    const demo = await view(DEMO);
    const other = await view(OTHER);

    expect(demo.title).toBe('VG: PR falso de verify:gui');
    expect(other.title).toBe('VG: otra PR #7');
    expect(demo.headRefOid).toMatch(/^[0-9a-f]{40}$/);
    expect(other.headRefOid).toMatch(/^[0-9a-f]{40}$/);
    expect(demo.headRefOid).not.toBe(other.headRefOid);
    expect(JSON.parse((await gh('repo', 'view', OTHER, '--json', 'mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed')).stdout)).toEqual({
      mergeCommitAllowed: true,
      squashMergeAllowed: true,
      rebaseMergeAllowed: false,
    });
  });

  it('fake_mergeWithWrongHead_exit1', async () => {
    const head = (await view(DEMO)).headRefOid as string;

    const wrong = await gh('pr', 'merge', '7', '-R', DEMO, '--squash', '--match-head-commit', 'f'.repeat(40));
    expect((await view(DEMO)).state).toBe('OPEN');
    const right = await gh('pr', 'merge', '7', '-R', DEMO, '--squash', '--match-head-commit', head);

    expect(wrong.code).toBe(1);
    expect(right.code).toBe(0);
    expect((await view(DEMO)).state).toBe('MERGED');
    expect((await view(OTHER)).state).toBe('OPEN');
  });

  it('fake_commentAppears', async () => {
    await gh('pr', 'comment', '7', '-R', OTHER, '-b', 'hola desde el falso');
    await gh('pr', 'review', '7', '-R', OTHER, '--approve');
    await gh('pr', 'close', '7', '-R', OTHER);

    const other = await view(OTHER);

    expect(other.comments).toMatchObject([{ body: 'hola desde el falso', author: { login: 'vg-bot' } }]);
    expect(other.reviewDecision).toBe('APPROVED');
    expect(other.state).toBe('CLOSED');
    expect((await view(DEMO)).comments).toEqual([]);
    expect((await gh('pr', 'list', '-R', OTHER, '--state', 'open', '--json', 'number')).stdout).toBe('[]');
    expect(JSON.parse((await gh('pr', 'list', '-R', OTHER, '--state', 'closed', '--json', 'number')).stdout)).toEqual([{ number: 7 }]);
  });

  it('fake_adminThrows', async () => {
    await expect(gh('pr', 'merge', '7', '-R', DEMO, '--squash', '--admin')).rejects.toThrow('--admin');
  });

  it('fake_legacyBranchFlow_unchanged', async () => {
    const list = JSON.parse((await gh('pr', 'list', '--head=feat/x', '--state', 'all', '--limit', '10', '--json', 'number,title,isDraft,headRefName')).stdout) as unknown[];

    expect(list).toEqual([{ number: 7, title: 'VG: PR falso de verify:gui', isDraft: true, headRefName: 'feat/x' }]);
    expect((await gh('pr', 'list', '--head=main', '--json', 'number')).stdout).toBe('[]');
    expect((await gh('pr', 'list', '--head=vg-sin-sesion', '--json', 'number')).code).toBe(4);
  });
});
