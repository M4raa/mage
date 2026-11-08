import { describe, expect, it } from 'vitest';
import { beginStroke, endStroke, extendStroke, undoStroke } from './penStrokes';

describe('penStrokes', () => {
  it('beginStroke_second_idsIncrement', () => {
    const strokes = beginStroke(beginStroke([], 'pen', [1, 1]), 'box', [2, 2]);

    expect(strokes.map((s) => s.id)).toEqual([1, 2]);
  });

  it('extendStroke_pen_appendsPoints', () => {
    const strokes = extendStroke(extendStroke(beginStroke([], 'pen', [0, 0]), [1, 1]), [2, 2]);

    expect(strokes[0]?.pointsDip).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it('extendStroke_box_keepsStartAndCurrent', () => {
    const strokes = extendStroke(extendStroke(beginStroke([], 'box', [0, 0]), [1, 1]), [5, 6]);

    expect(strokes[0]?.pointsDip).toEqual([[0, 0], [5, 6]]);
  });

  it('extendStroke_empty_unchanged', () => {
    expect(extendStroke([], [1, 1])).toEqual([]);
  });

  it('endStroke_singlePoint_discarded', () => {
    expect(endStroke(beginStroke([], 'arrow', [3, 3]))).toEqual([]);
  });

  it('endStroke_twoPoints_kept', () => {
    expect(endStroke(extendStroke(beginStroke([], 'arrow', [3, 3]), [4, 4]))).toHaveLength(1);
  });

  it('undoStroke_removesLast', () => {
    const strokes = beginStroke(beginStroke([], 'pen', [1, 1]), 'pen', [2, 2]);

    expect(undoStroke(strokes).map((s) => s.id)).toEqual([1]);
    expect(undoStroke([])).toEqual([]);
  });
});
