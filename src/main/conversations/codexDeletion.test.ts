import { describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@shared/i18n/localizedText';
import { deleteCodexConversation, type CodexDeletionDeps } from './codexDeletion';

const HOME = '/home/.codex-x';

function makeDeps(children: readonly string[], deleteThread: CodexDeletionDeps['deleteThread'] = () => Promise.resolve()) {
  const calls: string[] = [];
  const deps: CodexDeletionDeps = {
    history: { childThreadsOf: () => children },
    deleteThread: vi.fn(async (home: string, id: string) => {
      calls.push(`delete:${id}`);
      await deleteThread(home, id);
    }),
    forget: vi.fn((id: string) => { calls.push(`forget:${id}`); }),
    log: vi.fn(),
  };
  return { deps, calls };
}

describe('deleteCodexConversation', () => {
  it('deleteCodexConversation_withReviewChild_deletesChildThenParent', async () => {
    const { deps, calls } = makeDeps(['child']);

    await deleteCodexConversation(deps, HOME, 'parent');

    expect(calls).toEqual(['delete:child', 'forget:child', 'delete:parent', 'forget:parent']);
  });

  it('deleteCodexConversation_childFails_stillDeletesParentAndWarns', async () => {
    const { deps, calls } = makeDeps(['child'], (_home, id) => (id === 'child' ? Promise.reject(new Error('boom')) : Promise.resolve()));

    await deleteCodexConversation(deps, HOME, 'parent');

    expect(calls).toEqual(['delete:child', 'delete:parent', 'forget:parent']);
    expect(deps.log).toHaveBeenCalledWith('warn', expect.any(String), { threadId: 'child', error: 'boom' });
  });

  it('deleteCodexConversation_forkedHistory_throwsHasCopies', async () => {
    const { deps } = makeDeps([], () => Promise.reject(new Error('-32600 forked history still references it')));

    const failure = await deleteCodexConversation(deps, HOME, 'parent').catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(UserFacingError);
    expect(JSON.stringify(failure)).toContain('errors.rewind.hasCopies');
    expect(deps.forget).not.toHaveBeenCalled();
  });

  it('deleteCodexConversation_otherError_rethrows', async () => {
    const { deps } = makeDeps([], () => Promise.reject(new Error('disco lleno')));

    await expect(deleteCodexConversation(deps, HOME, 'parent')).rejects.toThrow('disco lleno');
    expect(deps.forget).not.toHaveBeenCalled();
  });

  it('deleteCodexConversation_ok_forgetsRewindState', async () => {
    const { deps } = makeDeps([]);

    await deleteCodexConversation(deps, HOME, 'parent');

    expect(deps.forget).toHaveBeenCalledWith('parent');
  });
});
