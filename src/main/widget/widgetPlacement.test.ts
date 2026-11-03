import { describe, expect, it } from 'vitest';
import { clampInto, pickWorkArea, relocate, resizeAnchored, sameBounds, topRightOf } from './widgetPlacement';

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const WA2 = { x: 1920, y: 0, width: 1920, height: 1040 };
const SMALL = { x: 0, y: 0, width: 1280, height: 680 };

describe('topRightOf', () => {
  it('topRightOf_workAreaAtOrigin_placesAtRightMinusMargin', () => {
    expect(topRightOf(WA, { width: 232, height: 52 }, 24)).toEqual({ x: 1664, y: 24, width: 232, height: 52 });
  });
  it('topRightOf_secondDisplay_offsetsByWorkAreaX', () => {
    expect(topRightOf(WA2, { width: 232, height: 52 }, 24)).toEqual({ x: 3584, y: 24, width: 232, height: 52 });
  });
});

describe('clampInto', () => {
  it('clampInto_offRightEdge_movesInside', () => {
    expect(clampInto({ x: 1800, y: 10, width: 320, height: 460 }, WA)).toEqual({ x: 1600, y: 10, width: 320, height: 460 });
  });
  it('clampInto_aboveTop_movesDown', () => {
    expect(clampInto({ x: 100, y: -50, width: 320, height: 460 }, WA)).toEqual({ x: 100, y: 0, width: 320, height: 460 });
  });
  it('clampInto_largerThanWorkArea_shrinks', () => {
    expect(clampInto({ x: 0, y: 0, width: 4000, height: 2000 }, WA)).toEqual({ x: 0, y: 0, width: 1920, height: 1040 });
  });
});

describe('resizeAnchored', () => {
  it('resizeAnchored_compactToExpanded_keepsRightAndTop', () => {
    const result = resizeAnchored({ x: 1664, y: 24, width: 232, height: 52 }, { width: 320, height: 460 }, WA);
    expect(result).toEqual({ x: 1576, y: 24, width: 320, height: 460 });
  });
  it('resizeAnchored_nearBottom_clampsInside', () => {
    const result = resizeAnchored({ x: 1664, y: 900, width: 232, height: 52 }, { width: 320, height: 460 }, WA);
    expect(result).toEqual({ x: 1576, y: 580, width: 320, height: 460 });
  });
});

describe('pickWorkArea', () => {
  it('pickWorkArea_spansTwoDisplays_returnsLargerOverlap', () => {
    expect(pickWorkArea({ x: 1800, y: 0, width: 320, height: 460 }, [WA, WA2])).toBe(WA2);
  });
  it('pickWorkArea_noOverlap_returnsNull', () => {
    expect(pickWorkArea({ x: 5000, y: 0, width: 320, height: 460 }, [WA, WA2])).toBeNull();
  });
  it('pickWorkArea_emptyList_returnsNull', () => {
    expect(pickWorkArea({ x: 0, y: 0, width: 10, height: 10 }, [])).toBeNull();
  });
});

describe('relocate', () => {
  it('relocate_displayRemoved_movesToPrimaryTopRight', () => {
    expect(relocate({ x: 3584, y: 24, width: 232, height: 52 }, [WA], WA, 24)).toEqual({ x: 1664, y: 24, width: 232, height: 52 });
  });
  it('relocate_insideWorkArea_returnsSameBounds', () => {
    expect(relocate({ x: 100, y: 100, width: 232, height: 52 }, [WA], WA, 24)).toEqual({ x: 100, y: 100, width: 232, height: 52 });
  });
  it('relocate_partlyOutside_clampsInside', () => {
    expect(relocate({ x: 1100, y: 24, width: 320, height: 460 }, [SMALL], SMALL, 24)).toEqual({ x: 960, y: 24, width: 320, height: 460 });
  });
  it('relocate_workAreaShrankAway_movesToPrimaryTopRight', () => {
    expect(relocate({ x: 1664, y: 24, width: 320, height: 460 }, [SMALL], SMALL, 24)).toEqual({ x: 936, y: 24, width: 320, height: 460 });
  });
});

describe('sameBounds', () => {
  it('sameBounds_offByTwo_true', () => {
    expect(sameBounds({ x: 0, y: 0, width: 333, height: 211 }, { x: 2, y: 1, width: 335, height: 213 })).toBe(true);
  });
  it('sameBounds_offByThree_false', () => {
    expect(sameBounds({ x: 0, y: 0, width: 333, height: 211 }, { x: 3, y: 0, width: 333, height: 211 })).toBe(false);
  });
});
