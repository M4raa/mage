import { describe, expect, it } from 'vitest';
import type { Variants } from 'motion/react';
import * as presets from './motionPresets';

const ANIMATABLE = new Set(['opacity', 'x', 'y', 'scale', 'rotate', 'transition']);
// No animables, declarados por variante: `height` empuja lo de debajo; `pointerEvents` solo cambia al salir.
const EXTRA_KEYS: Record<string, string> = { DISCLOSURE_VARIANTS: 'height', PANEL_CONTENT_VARIANTS: 'pointerEvents' };

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
      const extra = EXTRA_KEYS[name];
      const allowed = extra === undefined ? ANIMATABLE : new Set([...ANIMATABLE, extra]);
      for (const state of Object.values(v)) {
        for (const key of Object.keys(state as object)) expect(allowed.has(key), `${name}.${key}`).toBe(true);
      }
    }
  });
});
