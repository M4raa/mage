import { describe, expect, it } from 'vitest';
import { resolveTrapTarget, shouldRestoreFocus } from './focusTrap';

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

describe('shouldRestoreFocus', () => {
  const body = { id: 'body' };
  const inside = { id: 'dentro' };
  const otherDialog = { id: 'otro-dialogo' };
  const isInside = (node: { id: string }): boolean => node === inside;

  it('shouldRestoreFocus_focoNull_restaura', () => {
    expect(shouldRestoreFocus(null, [body], isInside)).toBe(true);
  });

  it('shouldRestoreFocus_focoPerdidoEnBody_restaura', () => {
    expect(shouldRestoreFocus(body, [body], isInside)).toBe(true);
  });

  it('shouldRestoreFocus_focoDentroDelPanel_restaura', () => {
    expect(shouldRestoreFocus(inside, [body], isInside)).toBe(true);
  });

  it('shouldRestoreFocus_focoEnOtroDialogo_noLoRoba', () => {
    expect(shouldRestoreFocus(otherDialog, [body], isInside)).toBe(false);
  });
});
