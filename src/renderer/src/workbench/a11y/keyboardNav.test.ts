import { describe, expect, it } from 'vitest';
import { isArrowNavKey, nextIndexForArrow } from './keyboardNav';

describe('nextIndexForArrow', () => {
  it('nextIndexForArrow_arrowRight_avanzaUno', () => {
    expect(nextIndexForArrow(3, 0, 'ArrowRight')).toBe(1);
  });

  it('nextIndexForArrow_arrowDown_avanzaUno', () => {
    expect(nextIndexForArrow(3, 1, 'ArrowDown')).toBe(2);
  });

  it('nextIndexForArrow_arrowRightEnElUltimo_envuelveAlPrimero', () => {
    expect(nextIndexForArrow(3, 2, 'ArrowRight')).toBe(0);
  });

  it('nextIndexForArrow_arrowLeftEnElPrimero_envuelveAlUltimo', () => {
    expect(nextIndexForArrow(3, 0, 'ArrowLeft')).toBe(2);
  });

  it('nextIndexForArrow_arrowUp_retrocedeUno', () => {
    expect(nextIndexForArrow(3, 2, 'ArrowUp')).toBe(1);
  });

  it('nextIndexForArrow_home_vaAlPrimero', () => {
    expect(nextIndexForArrow(5, 3, 'Home')).toBe(0);
  });

  it('nextIndexForArrow_end_vaAlUltimo', () => {
    expect(nextIndexForArrow(5, 1, 'End')).toBe(4);
  });

  it('nextIndexForArrow_teclaIrrelevante_mantieneElActual', () => {
    expect(nextIndexForArrow(5, 2, 'a')).toBe(2);
  });

  it('nextIndexForArrow_countCero_devuelveCero', () => {
    expect(nextIndexForArrow(0, 0, 'ArrowRight')).toBe(0);
  });

  it('nextIndexForArrow_countUno_seQuedaEnCero', () => {
    expect(nextIndexForArrow(1, 0, 'ArrowRight')).toBe(0);
  });
});

describe('isArrowNavKey', () => {
  it('isArrowNavKey_flechasYHomeEnd_true', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(isArrowNavKey(key)).toBe(true);
    }
  });

  it('isArrowNavKey_otraTecla_false', () => {
    expect(isArrowNavKey('Enter')).toBe(false);
    expect(isArrowNavKey('Tab')).toBe(false);
  });
});
