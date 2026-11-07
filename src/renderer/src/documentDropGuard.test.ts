import { describe, expect, it, vi } from 'vitest';
import { installDocumentDropGuard, type DropGuardTarget } from './documentDropGuard';

type Listener = (event: DragEvent) => void;

function fakeTarget(): { target: DropGuardTarget; listeners: Map<string, Listener> } {
  const listeners = new Map<string, Listener>();
  const target: DropGuardTarget = {
    addEventListener: (type, listener) => void listeners.set(type, listener),
    removeEventListener: (type, listener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  return { target, listeners };
}

function fakeEvent(defaultPrevented: boolean, dataTransfer: { dropEffect: string } | null = { dropEffect: 'copy' }) {
  const event = { defaultPrevented, preventDefault: vi.fn(), dataTransfer };
  return { event, asDragEvent: event as unknown as DragEvent };
}

describe('installDocumentDropGuard', () => {
  it('installDocumentDropGuard_dragoverSinTratar_loCancelaConDropEffectNone', () => {
    const { target, listeners } = fakeTarget();
    const { event, asDragEvent } = fakeEvent(false);

    installDocumentDropGuard(target);
    listeners.get('dragover')?.(asDragEvent);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.dataTransfer?.dropEffect).toBe('none');
  });

  it('installDocumentDropGuard_dragoverYaTratadoPorElChat_noLoToca', () => {
    const { target, listeners } = fakeTarget();
    const { event, asDragEvent } = fakeEvent(true);

    installDocumentDropGuard(target);
    listeners.get('dragover')?.(asDragEvent);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.dataTransfer?.dropEffect).toBe('copy');
  });

  it('installDocumentDropGuard_dragoverSinDataTransfer_noFalla', () => {
    const { target, listeners } = fakeTarget();
    const { event, asDragEvent } = fakeEvent(false, null);

    installDocumentDropGuard(target);

    expect(() => listeners.get('dragover')?.(asDragEvent)).not.toThrow();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it.each([true, false])('installDocumentDropGuard_drop_siempreCancela (defaultPrevented=%s)', (defaultPrevented) => {
    const { target, listeners } = fakeTarget();
    const { event, asDragEvent } = fakeEvent(defaultPrevented);

    installDocumentDropGuard(target);
    listeners.get('drop')?.(asDragEvent);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('installDocumentDropGuard_alDesinstalar_quitaLosDosOyentes', () => {
    const { target, listeners } = fakeTarget();

    const uninstall = installDocumentDropGuard(target);
    expect(listeners.size).toBe(2);
    uninstall();

    expect(listeners.size).toBe(0);
  });
});
