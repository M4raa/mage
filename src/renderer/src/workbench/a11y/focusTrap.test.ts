import { describe, expect, it } from 'vitest';
import { resolveTrapTarget } from './focusTrap';

describe('resolveTrapTarget', () => {
  it('resolveTrapTarget_tabEnElUltimo_envuelveAlPrimero', () => {
    expect(resolveTrapTarget(3, 2, false)).toBe(0);
  });

  it('resolveTrapTarget_shiftTabEnElPrimero_envuelveAlUltimo', () => {
    expect(resolveTrapTarget(3, 0, true)).toBe(2);
  });

  it('resolveTrapTarget_tabEnMedio_devuelveNull', () => {
    expect(resolveTrapTarget(3, 1, false)).toBeNull();
  });

  it('resolveTrapTarget_shiftTabEnMedio_devuelveNull', () => {
    expect(resolveTrapTarget(3, 1, true)).toBeNull();
  });

  it('resolveTrapTarget_focoFueraTab_vaAlPrimero', () => {
    expect(resolveTrapTarget(3, -1, false)).toBe(0);
  });

  it('resolveTrapTarget_focoFueraShiftTab_vaAlUltimo', () => {
    expect(resolveTrapTarget(3, -1, true)).toBe(2);
  });

  it('resolveTrapTarget_unSoloFocusable_seQuedaEnCero', () => {
    expect(resolveTrapTarget(1, 0, false)).toBe(0);
  });

  it('resolveTrapTarget_sinFocusables_devuelveNull', () => {
    expect(resolveTrapTarget(0, -1, false)).toBeNull();
  });
});
