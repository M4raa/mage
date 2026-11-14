import { describe, expect, it, vi } from 'vitest';
import { taskRunMarker } from './taskRunMarker';

function marker(record: (conversationId: string) => void = () => undefined) {
  const recordSpy = vi.fn(record);
  const warn = vi.fn();
  return { mark: taskRunMarker({ record: recordSpy, warn }), record: recordSpy, warn };
}

describe('taskRunMarker', () => {
  it('taskRunMarker_primeraConversacion_laGuarda', () => {
    const { mark, record } = marker();

    mark('conv-1');

    expect(record).toHaveBeenCalledExactlyOnceWith('conv-1');
  });

  it('taskRunMarker_nullYLuegoLaMisma_guardaUnaVez', () => {
    const { mark, record } = marker();

    mark(null);
    mark('conv-1');
    mark('conv-1');

    expect(record).toHaveBeenCalledTimes(1);
  });

  it('taskRunMarker_otraConversacionTrasLaPrimera_noLaGuarda', () => {
    const { mark, record } = marker();

    mark('conv-1');
    mark('conv-2');

    expect(record).toHaveBeenCalledExactlyOnceWith('conv-1');
  });

  it('taskRunMarker_falloDelIndice_trazaYNoLanza', () => {
    const { mark, warn } = marker(() => {
      throw new Error('disco lleno');
    });

    expect(() => mark('conv-1')).not.toThrow();

    expect(warn).toHaveBeenCalledWith(expect.any(String), { conversationId: 'conv-1', error: 'disco lleno' });
  });
});
