import { describe, expect, it, vi } from 'vitest';
import type { CaptureImage, ImageDeps } from './annotatedCapture';
import type { BrowserHandle } from './browserRegistry';
import { PenCaptureExpiredError, PenSessions } from './penSession';

const BUTTON = { id: 1, role: 'button', name: 'Enviar', rectDip: [10, 20, 30, 40] as [number, number, number, number] };

function fakeImage(width: number, height: number): CaptureImage {
  return {
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: vi.fn(() => fakeImage(width, height)),
    toBitmap: vi.fn(() => Buffer.alloc(width * height * 4)),
    toPNG: () => Buffer.from(`png-${width}x${height}`),
  };
}

function setup(hasBrowser = true) {
  const handle = {
    readDom: vi.fn(async () => [BUTTON]),
    captureRaw: vi.fn(async () => ({
      image: fakeImage(900, 600),
      widthDip: 900,
      heightDip: 600,
      url: 'http://localhost:4000/',
      capturedAt: '2026-11-04T10:00:00.000Z',
    })),
  };
  const fromBitmap = vi.fn((_data: Buffer, size: { width: number; height: number }) => fakeImage(size.width, size.height));
  const imageDeps: ImageDeps = { fromBitmap };
  let counter = 0;
  const pens = new PenSessions({
    registry: { get: () => (hasBrowser ? (handle as unknown as BrowserHandle) : null) },
    imageDeps,
    newId: () => `cap${++counter}`,
  });
  return { pens, handle, fromBitmap };
}

const BOX = { id: 1, kind: 'box' as const, pointsDip: [[30, 40], [10, 20]] as const };

describe('PenSessions', () => {
  it('capture_noBrowser_browserNotOpen', async () => {
    const { pens } = setup(false);

    await expect(pens.capture('A')).rejects.toMatchObject({ code: 'browser_not_open' });
  });

  it('capture_readsDomAndCleanImage', async () => {
    const { pens, handle, fromBitmap } = setup();

    const result = await pens.capture('A');

    expect(handle.readDom).toHaveBeenCalledTimes(1);
    expect(fromBitmap).not.toHaveBeenCalled();
    expect(result.captureId).toBe('cap1');
    expect(result.elements).toEqual([BUTTON]);
    expect(result.image).toMatchObject({ mime: 'image/png', widthPx: 900, heightPx: 600 });
    expect(result).toMatchObject({ widthDip: 900, heightDip: 600, url: 'http://localhost:4000/' });
  });

  it('compose_matching_attachmentAndTexts', async () => {
    const { pens, fromBitmap } = setup();
    const { captureId } = await pens.capture('A');

    const result = pens.compose('A', captureId, [BOX]);

    expect(fromBitmap).toHaveBeenCalled();
    expect(result.attachment.mediaType).toBe('image/png');
    expect(result.strokesText).toBe('1: box (10,20,20,20)');
    expect(result.elementsText).toBe('1: button "Enviar" (10,20,30,40)');
    expect(result.url).toBe('http://localhost:4000/');
  });

  it('compose_wrongCaptureId_expired', async () => {
    const { pens } = setup();
    await pens.capture('A');

    expect(() => pens.compose('A', 'otra', [])).toThrow(PenCaptureExpiredError);
  });

  it('compose_twice_secondExpired', async () => {
    const { pens } = setup();
    const { captureId } = await pens.capture('A');
    pens.compose('A', captureId, []);

    expect(() => pens.compose('A', captureId, [])).toThrow(PenCaptureExpiredError);
  });

  it('capture_again_replacesPrevious', async () => {
    const { pens } = setup();
    const first = await pens.capture('A');
    const second = await pens.capture('A');

    expect(() => pens.compose('A', first.captureId, [])).toThrow(PenCaptureExpiredError);
    expect(() => pens.compose('A', second.captureId, [])).not.toThrow();
  });

  it('discard_thenCompose_expired', async () => {
    const { pens } = setup();
    const { captureId } = await pens.capture('A');

    pens.discard('A');

    expect(() => pens.compose('A', captureId, [])).toThrow(PenCaptureExpiredError);
  });
});
