import { describe, expect, it, vi } from 'vitest';
import { readApps } from '../../spike/codex-apps-verification.mjs';

describe('readApps', () => {
  it('readApps_twoPages_refetchesAndReturnsSafeCounts', async () => {
    const request = vi.fn().mockResolvedValueOnce({ result: { data: [{ isAccessible: true, isEnabled: false, name: 'synthetic-private-text' }], nextCursor: 'page-two' } })
      .mockResolvedValueOnce({ result: { data: [{ isAccessible: true, isEnabled: true }], nextCursor: null } });

    const result = await readApps({ request }, { forceRefetch: true, threadId: 'artificial-thread' });

    expect(result).toEqual({ status: 'ok', count: 2, accessible: 2, enabled: 1, pages: 2 });
    expect(request).toHaveBeenLastCalledWith('app/list', { limit: 50, forceRefetch: true, threadId: 'artificial-thread', cursor: 'page-two' });
  });

  it('readApps_authenticationError_preservesCodeWithoutMessage', async () => {
    const request = vi.fn().mockResolvedValue({ error: { code: -32603, message: 'authentication synthetic-private-text' } });

    const result = await readApps({ request }, { forceRefetch: true });

    expect(result).toEqual({ errorCode: -32603, errorCategory: 'authentication' });
  });

  it('readApps_emptyList_returnsSuccessInsteadOfError', async () => {
    const request = vi.fn().mockResolvedValue({ result: { data: [], nextCursor: null } });

    const result = await readApps({ request }, { forceRefetch: true });

    expect(result).toEqual({ status: 'ok', count: 0, accessible: 0, enabled: 0, pages: 1 });
  });

  it('readApps_repeatedCursor_rejectsInsteadOfLooping', async () => {
    const request = vi.fn().mockResolvedValue({ result: { data: [], nextCursor: 'same' } });

    const result = readApps({ request }, { forceRefetch: true });

    await expect(result).rejects.toThrow('app/list: cursor repetido');
  });

  it('readApps_invalidList_rejectsWithoutExternalContents', async () => {
    const request = vi.fn().mockResolvedValue({ result: { data: 'synthetic-private-text' } });

    const result = readApps({ request }, { forceRefetch: true });

    await expect(result).rejects.toThrow('app/list: resultado con forma inesperada');
  });
});
