import { describe, expect, it, vi } from 'vitest';
import { readCatalog } from '../../spike/codex-catalog-verification.mjs';

const model = (id, hidden = false) => ({ id, model: id, displayName: id, hidden,
  supportedReasoningEfforts: [{ reasoningEffort: 'low' }] });

describe('readCatalog', () => {
  it('readCatalog_twoPages_preservesEffortsAndOmitsHiddenModels', async () => {
    const request = vi.fn().mockResolvedValueOnce({ result: { data: [model('visible'), model('hidden', true)], nextCursor: 'page-two' } })
      .mockResolvedValueOnce({ result: { data: [model('last')], nextCursor: null } });

    const result = await readCatalog({ request });

    expect(result).toEqual([{ id: 'visible', label: 'visible', supportedEfforts: ['low'] }, { id: 'last', label: 'last', supportedEfforts: ['low'] }]);
    expect(request).toHaveBeenLastCalledWith('model/list', { limit: 100, cursor: 'page-two' });
  });

  it('readCatalog_repeatedCursor_rejectsInsteadOfLooping', async () => {
    const request = vi.fn().mockResolvedValue({ result: { data: [], nextCursor: 'same' } });

    const result = readCatalog({ request });

    await expect(result).rejects.toThrow('model/list: cursor repetido');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('readCatalog_invalidEfforts_rejectsWithoutDisclosingExternalData', async () => {
    const request = vi.fn().mockResolvedValue({ result: { data: [{ ...model('synthetic-private-text'), supportedReasoningEfforts: null }], nextCursor: null } });

    const result = readCatalog({ request });

    await expect(result).rejects.toThrow('model/list: resultado con forma inesperada');
  });
});
