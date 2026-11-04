import { describe, expect, it } from 'vitest';
import type { Variants } from 'motion/react';
import * as presets from './motionPresets';

const ANIMATABLE = new Set(['opacity', 'x', 'y', 'scale', 'rotate', 'transition']);

const exportedVariants = (): [string, Variants][] =>
  Object.entries(presets).filter(
    (e): e is [string, Variants] =>
      e[0].endsWith('_VARIANTS') && typeof e[1] === 'object',
  );

describe('motionPresets', () => {
  it('presets_exitShorterThanEnter', () => {
    for (const [name, v] of exportedVariants()) {
      const enter = (v.animate as { transition: { duration: number } }).transition.duration;
      const exit = (v.exit as { transition: { duration: number } }).transition.duration;
      expect(exit, name).toBeLessThan(enter);
      expect(exit, name).toBeCloseTo(enter * presets.EXIT_FACTOR, 6);
    }
  });

  it('presets_onlyOpacityAndTransform', () => {
    for (const [name, v] of exportedVariants()) {
      // DISCLOSURE_VARIANTS anima `height` a proposito: empuja lo que tiene debajo (041 §5).
      const allowed = name === 'DISCLOSURE_VARIANTS' ? new Set([...ANIMATABLE, 'height']) : ANIMATABLE;
      for (const state of Object.values(v)) {
        for (const key of Object.keys(state as object)) expect(allowed.has(key), `${name}.${key}`).toBe(true);
      }
    }
  });
});
