import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EarlyInput } from './earlyInput.mjs';

describe('EarlyInput', () => {
  let seen;
  let sink;

  beforeEach(() => {
    seen = [];
    sink = { onLine: vi.fn(async (t) => { seen.push(t); }), onEnd: vi.fn(() => seen.push('<fin>')) };
  });

  it('push_beforeDrain_deliveredInOrderOnDrain', async () => {
    const early = new EarlyInput();
    early.push('a');
    early.push('b');

    await early.drainTo(sink);

    expect(seen).toEqual(['a', 'b']);
  });

  it('push_afterDrain_goesStraightToSink', async () => {
    const early = new EarlyInput();
    await early.drainTo(sink);

    await early.push('c');

    expect(seen).toEqual(['c']);
    expect(sink.onLine).toHaveBeenCalledTimes(1);
  });

  it('end_beforeDrain_onEndAfterLines', async () => {
    const early = new EarlyInput();
    early.push('a');
    early.end();

    await early.drainTo(sink);

    expect(seen).toEqual(['a', '<fin>']);
  });

  it('end_afterDrain_callsOnEndAtOnce', async () => {
    const early = new EarlyInput();
    await early.drainTo(sink);

    early.end();

    expect(seen).toEqual(['<fin>']);
  });

  it('push_duringDrain_deliveredAfterEarlier', async () => {
    const early = new EarlyInput();
    sink.onLine = vi.fn(async (t) => {
      seen.push(t);
      if (t === 'a') early.push('z');
    });
    early.push('a');

    await early.drainTo(sink);

    expect(seen).toEqual(['a', 'z']);
  });

  it('drainTo_empty_noCalls', async () => {
    const early = new EarlyInput();

    await early.drainTo(sink);

    expect(sink.onLine).not.toHaveBeenCalled();
    expect(sink.onEnd).not.toHaveBeenCalled();
  });

  it('drainTo_twice_throws', async () => {
    const early = new EarlyInput();
    await early.drainTo(sink);

    await expect(early.drainTo(sink)).rejects.toThrow('drainTo ya se llamó');
  });
});
