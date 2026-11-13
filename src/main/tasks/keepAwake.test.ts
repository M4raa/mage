import { describe, expect, it, vi } from 'vitest';
import { KeepAwake } from './keepAwake';

function setup() {
  const blocker = { start: vi.fn(() => 42), stop: vi.fn() };
  return { blocker, awake: new KeepAwake(blocker) };
}

describe('KeepAwake.sync', () => {
  it('sync_trueDosVeces_arrancaUnaVez', () => {
    const { blocker, awake } = setup();

    awake.sync(true);
    awake.sync(true);

    expect(blocker.start).toHaveBeenCalledTimes(1);
  });

  it('sync_trueYFalse_paraElQueArranco', () => {
    const { blocker, awake } = setup();

    awake.sync(true);
    awake.sync(false);
    awake.sync(false);

    expect(blocker.stop).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('sync_falseSinArrancar_noHaceNada', () => {
    const { blocker, awake } = setup();

    awake.sync(false);

    expect(blocker.start).not.toHaveBeenCalled();
    expect(blocker.stop).not.toHaveBeenCalled();
  });
});
