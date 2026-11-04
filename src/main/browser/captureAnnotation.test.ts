import { describe, expect, it } from 'vitest';
import {
  annotateBitmap,
  fitWithin,
  formatElementList,
  formatStrokeList,
  parseStrokes,
  type Bitmap,
  type Stroke,
} from './captureAnnotation';
import type { DomElement } from './elementRegistry';

const MAGENTA = [255, 0, 255, 255];
const WHITE = [255, 255, 255, 255];
const GREEN = [0, 200, 0, 255];
const BLACK = [0, 0, 0, 0];

function newBitmap(width: number, height: number): Bitmap {
  return { data: Buffer.alloc(width * height * 4), width, height };
}

function pixelAt(bitmap: Bitmap, x: number, y: number): number[] {
  const index = (y * bitmap.width + x) * 4;
  return [...bitmap.data.subarray(index, index + 4)];
}

function element(id: number, rectDip: [number, number, number, number], name = 'ok'): DomElement {
  return { id, role: 'button', name, rectDip };
}

function stroke(kind: Stroke['kind'], pointsDip: Stroke['pointsDip'], id = 1): Stroke {
  return { id, kind, pointsDip };
}

function hasGreen(bitmap: Bitmap, xs: [number, number], ys: [number, number]): boolean {
  for (let y = ys[0]; y <= ys[1]; y++) {
    for (let x = xs[0]; x <= xs[1]; x++) {
      if (pixelAt(bitmap, x, y)[1] === 200) return true;
    }
  }
  return false;
}

describe('fitWithin', () => {
  it('fitWithin_smallImage_unchanged', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it('fitWithin_exactlyMax_unchanged', () => {
    expect(fitWithin(1568, 1000)).toEqual({ width: 1568, height: 1000 });
  });

  it('fitWithin_wideImage_longSideMax', () => {
    expect(fitWithin(3136, 1000)).toEqual({ width: 1568, height: 500 });
  });

  it('fitWithin_tallImage_longSideMax', () => {
    expect(fitWithin(1000, 3136)).toEqual({ width: 500, height: 1568 });
  });

  it('fitWithin_invalidSize_throws', () => {
    expect(() => fitWithin(0, 10)).toThrow(/0x10/);
    expect(() => fitWithin(10.5, 10)).toThrow(/10\.5x10/);
  });
});

describe('annotateBitmap', () => {
  it('annotateBitmap_elementBox_borderMagentaInsideUntouched', () => {
    const bitmap = newBitmap(100, 100);

    annotateBitmap(bitmap, { elements: [element(1, [10, 10, 40, 30])], strokes: [], pxPerDip: 1 });

    expect(pixelAt(bitmap, 30, 39)).toEqual(MAGENTA);
    expect(pixelAt(bitmap, 30, 25)).toEqual(BLACK);
  });

  it('annotateBitmap_label_digitWhiteOnMagenta', () => {
    const bitmap = newBitmap(100, 100);

    annotateBitmap(bitmap, { elements: [element(7, [50, 50, 40, 30])], strokes: [], pxPerDip: 1 });

    expect(pixelAt(bitmap, 52, 52)).toEqual(WHITE);
    expect(pixelAt(bitmap, 50, 50)).toEqual(MAGENTA);
  });

  it('annotateBitmap_pxPerDip2_scalesBox', () => {
    const bitmap = newBitmap(200, 200);

    annotateBitmap(bitmap, { elements: [element(1, [10, 10, 20, 20])], strokes: [], pxPerDip: 2 });

    expect(pixelAt(bitmap, 40, 59)).toEqual(MAGENTA);
    expect(pixelAt(bitmap, 40, 61)).toEqual(BLACK);
  });

  it('annotateBitmap_labelNearEdge_clampedInside', () => {
    const bitmap = newBitmap(40, 30);

    annotateBitmap(bitmap, { elements: [element(12, [35, 25, 5, 5])], strokes: [], pxPerDip: 1 });

    expect(pixelAt(bitmap, 39, 29)[3]).toBe(255);
  });

  it('annotateBitmap_penStroke_green', () => {
    const bitmap = newBitmap(100, 100);

    annotateBitmap(bitmap, { elements: [], strokes: [stroke('pen', [[0, 50], [99, 50]])], pxPerDip: 1 });

    expect(pixelAt(bitmap, 50, 50)).toEqual(GREEN);
    expect(pixelAt(bitmap, 50, 51)).toEqual(GREEN);
  });

  it('annotateBitmap_boxStroke_cornersGreen', () => {
    const bitmap = newBitmap(100, 100);

    annotateBitmap(bitmap, { elements: [], strokes: [stroke('box', [[20, 20], [60, 40]])], pxPerDip: 1 });

    expect(pixelAt(bitmap, 20, 20)).toEqual(GREEN);
    expect(pixelAt(bitmap, 60, 40)).toEqual(GREEN);
    expect(pixelAt(bitmap, 40, 30)).toEqual(BLACK);
  });

  it('annotateBitmap_arrow_headDrawn', () => {
    const bitmap = newBitmap(100, 100);

    annotateBitmap(bitmap, { elements: [], strokes: [stroke('arrow', [[10, 50], [90, 50]])], pxPerDip: 1 });

    expect(hasGreen(bitmap, [78, 82], [42, 46])).toBe(true);
    expect(hasGreen(bitmap, [78, 82], [54, 58])).toBe(true);
  });

  it('annotateBitmap_wrongBufferLength_throws', () => {
    const bitmap: Bitmap = { data: Buffer.alloc(10), width: 4, height: 4 };

    expect(() => annotateBitmap(bitmap, { elements: [], strokes: [], pxPerDip: 1 })).toThrow(/10.*4x4.*64/);
  });

  it.each([0, Number.NaN])('annotateBitmap_invalidPxPerDip_throws (%s)', (pxPerDip) => {
    const bitmap = newBitmap(4, 4);

    expect(() => annotateBitmap(bitmap, { elements: [], strokes: [], pxPerDip })).toThrow(/pxPerDip/);
  });
});

describe('parseStrokes', () => {
  it('parseStrokes_valid_returnsStrokes', () => {
    const raw = [{ id: 1, kind: 'box', pointsDip: [[1, 2], [3, 4]] }];

    expect(parseStrokes(raw)).toEqual(raw);
  });

  it('parseStrokes_boxWithThreePoints_throws', () => {
    const raw = [{ id: 1, kind: 'box', pointsDip: [[1, 2], [3, 4], [5, 6]] }];

    expect(() => parseStrokes(raw)).toThrow(/Trazos de la pluma no válidos/);
  });

  it('parseStrokes_negativeCoordinate_throws', () => {
    const raw = [{ id: 1, kind: 'pen', pointsDip: [[-1, 2], [3, 4]] }];

    expect(() => parseStrokes(raw)).toThrow(/Trazos de la pluma no válidos/);
  });

  it('parseStrokes_tooMany_throws', () => {
    const raw = Array.from({ length: 51 }, (_, index) => ({ id: index + 1, kind: 'pen', pointsDip: [[0, 0], [1, 1]] }));

    expect(() => parseStrokes(raw)).toThrow(/Trazos de la pluma no válidos/);
  });

  it('parseStrokes_penWithOnePoint_throws', () => {
    const raw = [{ id: 1, kind: 'pen', pointsDip: [[0, 0]] }];

    expect(() => parseStrokes(raw)).toThrow(/Trazos de la pluma no válidos/);
  });

  it('parseStrokes_notArray_throws', () => {
    expect(() => parseStrokes({ id: 1 })).toThrow(/Trazos de la pluma no válidos/);
  });

  it('parseStrokes_extraKey_throws', () => {
    const raw = [{ id: 1, kind: 'pen', pointsDip: [[0, 0], [1, 1]], color: 'red' }];

    expect(() => parseStrokes(raw)).toThrow(/Trazos de la pluma no válidos/);
  });
});

describe('format lists', () => {
  it('formatElementList_roundsAndSanitizes', () => {
    const list = [element(3, [10.4, 19.6, 30, 40.2], 'Di "hola"\nya')];

    expect(formatElementList(list)).toBe(`3: button "Di 'hola' ya" (10,20,30,40)`);
  });

  it('formatElementList_empty_emptyString', () => {
    expect(formatElementList([])).toBe('');
  });

  it('formatStrokeList_boxBoundingBox', () => {
    expect(formatStrokeList([stroke('box', [[30, 40], [10, 20]])])).toBe('1: box (10,20,20,20)');
  });
});
