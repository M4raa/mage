import { describe, expect, it } from 'vitest';
import { FIRST_ITEM_INDEX_BASE, INITIAL_ANCHOR, appendedTailKeys, nextListAnchor, type ListAnchor } from './chatListAnchor';

const keyOf = (s: string): string => s;

describe('nextListAnchor', () => {
  it('nextListAnchor_emptyItems_resetsIndexKeepsGeneration', () => {
    const prev: ListAnchor = { firstIndex: 999_800, firstKey: 'a', generation: 2 };
    expect(nextListAnchor(prev, [], keyOf)).toEqual({ firstIndex: FIRST_ITEM_INDEX_BASE, firstKey: null, generation: 2 });
  });

  it('nextListAnchor_firstRender_takesFirstKey', () => {
    expect(nextListAnchor(INITIAL_ANCHOR, ['a', 'b'], keyOf)).toEqual({ firstIndex: 1_000_000, firstKey: 'a', generation: 0 });
  });

  it('nextListAnchor_sameFirstKey_returnsSameReference', () => {
    const prev: ListAnchor = { firstIndex: 1_000_000, firstKey: 'a', generation: 0 };
    expect(nextListAnchor(prev, ['a', 'b', 'c'], keyOf)).toBe(prev);
  });

  it('nextListAnchor_prepend200_lowersIndexBy200', () => {
    const prev: ListAnchor = { firstIndex: 1_000_000, firstKey: 'a', generation: 0 };
    const items = [...Array.from({ length: 200 }, (_, i) => `p${i}`), 'a', 'b'];
    expect(nextListAnchor(prev, items, keyOf)).toEqual({ firstIndex: 999_800, firstKey: 'p0', generation: 0 });
  });

  it('nextListAnchor_appendOnly_keepsIndex', () => {
    const prev: ListAnchor = { firstIndex: 1_000_000, firstKey: 'a', generation: 0 };
    expect(nextListAnchor(prev, ['a', 'b', 'c', 'd'], keyOf)).toBe(prev);
  });

  it('nextListAnchor_replacedContent_bumpsGeneration', () => {
    const prev: ListAnchor = { firstIndex: 999_800, firstKey: 'a', generation: 3 };
    expect(nextListAnchor(prev, ['x', 'y'], keyOf)).toEqual({ firstIndex: 1_000_000, firstKey: 'x', generation: 4 });
  });

  it('nextListAnchor_prependBeyondZero_bumpsGeneration', () => {
    const prev: ListAnchor = { firstIndex: 1, firstKey: 'a', generation: 0 };
    expect(nextListAnchor(prev, ['p0', 'p1', 'a'], keyOf)).toEqual({ firstIndex: 1_000_000, firstKey: 'p0', generation: 1 });
  });
});

describe('appendedTailKeys', () => {
  it('appendedTailKeys_twoAppended_returnsThem', () => {
    expect(appendedTailKeys({ length: 2, lastKey: 'b' }, ['a', 'b', 'c', 'd'])).toEqual(['c', 'd']);
  });

  it('appendedTailKeys_prepend_returnsNone', () => {
    expect(appendedTailKeys({ length: 2, lastKey: 'b' }, ['p0', 'a', 'b'])).toEqual([]);
  });

  it('appendedTailKeys_firstRender_none', () => {
    expect(appendedTailKeys({ length: 0, lastKey: null }, ['a', 'b'])).toEqual([]);
  });

  it('appendedTailKeys_replaced_none', () => {
    expect(appendedTailKeys({ length: 2, lastKey: 'b' }, ['x', 'y'])).toEqual([]);
  });
});
