import { describe, expect, it } from 'vitest';
import { PendingSends } from './pendingSends.mjs';

describe('PendingSends', () => {
  it('track_yResolver_noQuedaIncierto', () => {
    const sends = new PendingSends();
    sends.track('a', 'hola');

    sends.settle('a');

    expect(sends.markAllUncertain()).toEqual([]);
  });

  it('markAllUncertain_devuelveLosNoResueltosEnOrden', () => {
    const sends = new PendingSends();
    sends.track('a', 'uno');
    sends.track('b', 'dos');
    sends.track('c', 'tres');
    sends.settle('b');

    expect(sends.markAllUncertain()).toEqual([{ commandId: 'a', text: 'uno' }, { commandId: 'c', text: 'tres' }]);
  });

  it('takeUncertain_vaciaLaLista', () => {
    const sends = new PendingSends();
    sends.track('a', 'uno');
    sends.markAllUncertain();

    expect(sends.takeUncertain()).toEqual([{ commandId: 'a', text: 'uno' }]);
    expect(sends.takeUncertain()).toEqual([]);
  });

  it('track_idRepetido_lanza', () => {
    const sends = new PendingSends();
    sends.track('a', 'uno');

    expect(() => sends.track('a', 'dos')).toThrow('a');
  });
});
