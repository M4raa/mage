import { describe, expect, it } from 'vitest';
import { FIRST_ITEM_INDEX_BASE, INITIAL_ANCHOR, SETTLE_FRAMES, appendedTailKeys, nextListAnchor, pinToBottom, settleAtBottom, watchChatBottom, type FrameApi, type ListAnchor, type SizeObserver, type WatchedScroller } from './chatListAnchor';

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

type FakeScroller = WatchedScroller<string> & { listener: (() => void) | null };

function fakeScroller(init: { scrollTop: number; scrollHeight: number; clientHeight: number; children?: readonly string[] | null }): FakeScroller {
  const scroller: FakeScroller = {
    scrollTop: init.scrollTop,
    scrollHeight: init.scrollHeight,
    clientHeight: init.clientHeight,
    firstElementChild: init.children === null ? null : { children: init.children ?? [] },
    listener: null,
    addEventListener: (_type, listener) => {
      scroller.listener = listener;
    },
    removeEventListener: () => {
      scroller.listener = null;
    },
  };
  return scroller;
}

function fakeObserver(): { observed: unknown[]; disconnected: boolean; onResize: (() => void) | null; create: (onResize: () => void) => SizeObserver<string> } {
  const state = {
    observed: [] as unknown[],
    disconnected: false,
    onResize: null as (() => void) | null,
    create: (onResize: () => void): SizeObserver<string> => {
      state.onResize = onResize;
      return {
        observe: (target) => state.observed.push(target),
        disconnect: () => {
          state.disconnected = true;
        },
      };
    },
  };
  return state;
}

describe('watchChatBottom', () => {
  it('watchChatBottom_resizeWhileStuck_pinsToRealBottom', () => {
    const scroller = fakeScroller({ scrollTop: 100, scrollHeight: 1000, clientHeight: 500 });
    const observer = fakeObserver();
    watchChatBottom(scroller, { current: true }, observer.create);
    observer.onResize?.();
    expect(scroller.scrollTop).toBe(500);
  });

  it('watchChatBottom_resizeWhileNotStuck_leavesScroll', () => {
    const scroller = fakeScroller({ scrollTop: 100, scrollHeight: 1000, clientHeight: 500 });
    const observer = fakeObserver();
    watchChatBottom(scroller, { current: false }, observer.create);
    observer.onResize?.();
    expect(scroller.scrollTop).toBe(100);
  });

  it('watchChatBottom_userScrollsFarUp_unsticks', () => {
    const scroller = fakeScroller({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });
    const stuck = { current: true };
    watchChatBottom(scroller, stuck, fakeObserver().create);
    scroller.listener?.();
    expect(stuck.current).toBe(false);
  });

  it('watchChatBottom_scrollWithinMargin_sticks', () => {
    const scroller = fakeScroller({ scrollTop: 430, scrollHeight: 1000, clientHeight: 500 });
    const stuck = { current: false };
    watchChatBottom(scroller, stuck, fakeObserver().create);
    scroller.listener?.();
    expect(stuck.current).toBe(true);
  });

  it('watchChatBottom_scrollAtExactMargin_sticks', () => {
    const scroller = fakeScroller({ scrollTop: 420, scrollHeight: 1000, clientHeight: 500 });
    const stuck = { current: false };
    watchChatBottom(scroller, stuck, fakeObserver().create);
    scroller.listener?.();
    expect(stuck.current).toBe(true);
  });

  it('watchChatBottom_observesScrollerAndViewportChildren', () => {
    const scroller = fakeScroller({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500, children: ['cabecera', 'lista', 'pie'] });
    const observer = fakeObserver();
    watchChatBottom(scroller, { current: true }, observer.create);
    expect(observer.observed).toEqual([scroller, 'cabecera', 'lista', 'pie']);
  });

  it('watchChatBottom_noViewport_observesOnlyScroller', () => {
    const scroller = fakeScroller({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500, children: null });
    const observer = fakeObserver();
    watchChatBottom(scroller, { current: true }, observer.create);
    expect(observer.observed).toEqual([scroller]);
  });

  it('watchChatBottom_dispose_disconnectsAndRemovesListener', () => {
    const scroller = fakeScroller({ scrollTop: 0, scrollHeight: 1000, clientHeight: 500 });
    const observer = fakeObserver();
    const dispose = watchChatBottom(scroller, { current: true }, observer.create);
    dispose();
    expect(observer.disconnected).toBe(true);
    expect(scroller.listener).toBeNull();
  });
});

describe('pinToBottom', () => {
  it('pinToBottom_contentShorterThanView_staysAtZero', () => {
    const scroller = { scrollTop: 0, scrollHeight: 300, clientHeight: 500 };
    pinToBottom(scroller);
    expect(scroller.scrollTop).toBe(0);
  });
});

function fakeFrames(): { requested: number; run: () => void; pendingCount: () => number; api: FrameApi } {
  const queue: { id: number; callback: () => void }[] = [];
  const state = {
    requested: 0,
    run: (): void => {
      queue.shift()?.callback();
    },
    pendingCount: (): number => queue.length,
    api: {
      request: (callback: () => void): number => {
        state.requested += 1;
        queue.push({ id: state.requested, callback });
        return state.requested;
      },
      cancel: (id: number): void => {
        const at = queue.findIndex((entry) => entry.id === id);
        if (at >= 0) queue.splice(at, 1);
      },
    },
  };
  return state;
}

function drain(frames: { run: () => void; pendingCount: () => number }): void {
  while (frames.pendingCount() > 0) frames.run();
}

describe('settleAtBottom', () => {
  it('settleAtBottom_stuckYDespegado_pegaEnElSiguienteFrame', () => {
    const scroller = fakeScroller({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    const frames = fakeFrames();
    settleAtBottom(scroller, { current: true }, frames.api);
    frames.run();
    expect(scroller.scrollTop).toBe(800);
  });

  it('settleAtBottom_virtuosoLoMueveDespues_vuelveAPegar', () => {
    const scroller = fakeScroller({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    const frames = fakeFrames();
    settleAtBottom(scroller, { current: true }, frames.api);
    frames.run();
    scroller.scrollTop = 790;
    frames.run();
    expect(scroller.scrollTop).toBe(800);
  });

  it('settleAtBottom_noPegado_noTocaYNoPideMas', () => {
    const scroller = fakeScroller({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    const frames = fakeFrames();
    settleAtBottom(scroller, { current: false }, frames.api);
    frames.run();
    expect(scroller.scrollTop).toBe(0);
    expect(frames.requested).toBe(1);
  });

  it('settleAtBottom_trasLosFrames_para', () => {
    const scroller = fakeScroller({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    const frames = fakeFrames();
    settleAtBottom(scroller, { current: true }, frames.api, 3);
    drain(frames);
    expect(frames.requested).toBe(4);
  });

  it('settleAtBottom_cancelar_noEjecutaMas', () => {
    const scroller = fakeScroller({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    const frames = fakeFrames();
    const cancel = settleAtBottom(scroller, { current: true }, frames.api);
    cancel();
    frames.run();
    expect(scroller.scrollTop).toBe(0);
  });

  it('settleAtBottom_framesNegativo_lanzaConElValor', () => {
    const scroller = fakeScroller({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    expect(() => settleAtBottom(scroller, { current: true }, fakeFrames().api, -1)).toThrow('-1');
  });

  it('settleAtBottom_porDefecto_usaSettleFrames', () => {
    const scroller = fakeScroller({ scrollTop: 0, scrollHeight: 1000, clientHeight: 200 });
    const frames = fakeFrames();
    settleAtBottom(scroller, { current: true }, frames.api);
    drain(frames);
    expect(frames.requested).toBe(SETTLE_FRAMES + 1);
  });
});
