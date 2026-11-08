import { describe, expect, it, vi } from 'vitest';
import { composeCapture, type CaptureImage, type ImageDeps, type RawCapture } from './annotatedCapture';
import type { DomElement } from './elementRegistry';

// Imagen falsa que recuerda su tamaño; resize devuelve otra con el tamaño pedido.
function fakeImage(width: number, height: number, empty = false): CaptureImage & {
  resize: ReturnType<typeof vi.fn>;
  toBitmap: ReturnType<typeof vi.fn>;
} {
  return {
    isEmpty: () => empty,
    getSize: () => ({ width, height }),
    resize: vi.fn((options: { width: number; height: number }) => fakeImage(options.width, options.height)),
    toBitmap: vi.fn(() => Buffer.alloc(width * height * 4)),
    toPNG: () => Buffer.from(`png-${width}x${height}`),
  };
}

function rawOf(image: CaptureImage, widthDip: number): RawCapture {
  return { image, widthDip, heightDip: 600, url: 'http://localhost/', capturedAt: '2026-11-04T10:00:00.000Z' };
}

function newDeps() {
  const fromBitmap = vi.fn((data: Buffer, size: { width: number; height: number }) => {
    void data;
    return fakeImage(size.width, size.height);
  });
  return { fromBitmap, deps: { fromBitmap } as ImageDeps };
}

const button: DomElement = { id: 1, role: 'button', name: 'ok', rectDip: [10, 10, 40, 30] };

describe('composeCapture', () => {
  it('composeCapture_small_noResizeNoBitmap', () => {
    const image = fakeImage(900, 600);

    const result = composeCapture(rawOf(image, 900), { elements: [], strokes: [] }, newDeps().deps);

    expect(image.resize).not.toHaveBeenCalled();
    expect(image.toBitmap).not.toHaveBeenCalled();
    expect(result.image.deviceScale).toBe(1);
    expect(result.image.base64).toBe(Buffer.from('png-900x600').toString('base64'));
  });

  it('composeCapture_large_resizedToMax', () => {
    const image = fakeImage(2700, 1800);

    const result = composeCapture(rawOf(image, 1800), { elements: [], strokes: [] }, newDeps().deps);

    expect(image.resize).toHaveBeenCalledWith({ width: 1568, height: 1045, quality: 'good' });
    expect(result.image.deviceScale).toBe(0.87);
    expect(result.image.widthPx).toBe(1568);
  });

  it('composeCapture_withElements_drawsAndRebuilds', () => {
    const image = fakeImage(900, 600);
    const { fromBitmap, deps } = newDeps();

    composeCapture(rawOf(image, 900), { elements: [button], strokes: [] }, deps);

    expect(fromBitmap).toHaveBeenCalledTimes(1);
    const [data, size] = fromBitmap.mock.calls[0] as [Buffer, { width: number; height: number }];
    expect(data.length).toBe(900 * 600 * 4);
    expect(size).toEqual({ width: 900, height: 600 });
    expect(data.some((byte) => byte !== 0)).toBe(true);
  });

  it('composeCapture_emptyImage_throws', () => {
    const image = fakeImage(900, 600, true);

    expect(() => composeCapture(rawOf(image, 900), { elements: [], strokes: [] }, newDeps().deps)).toThrow(
      /vacía.*http:\/\/localhost\//,
    );
  });

  it('composeCapture_keepsElementsStrokesUrlAndTime', () => {
    const strokes = [{ id: 1, kind: 'pen' as const, pointsDip: [[0, 0], [5, 5]] as const }];

    const result = composeCapture(rawOf(fakeImage(900, 600), 900), { elements: [button], strokes }, newDeps().deps);

    expect(result.elements).toEqual([button]);
    expect(result.strokes).toEqual(strokes);
    expect(result.url).toBe('http://localhost/');
    expect(result.capturedAt).toBe('2026-11-04T10:00:00.000Z');
  });
});
