import { describe, expect, it } from 'vitest';
import { isBackgroundTestRun, offScreenPosition } from './backgroundTestWindow';

describe('isBackgroundTestRun', () => {
  it('isBackgroundTestRun_sinEmpaquetarYVariable_true', () => {
    expect(isBackgroundTestRun(false, { MAGE_TEST_BACKGROUND: '1' })).toBe(true);
  });

  it('isBackgroundTestRun_empaquetada_falseAunqueEsteLaVariable', () => {
    expect(isBackgroundTestRun(true, { MAGE_TEST_BACKGROUND: '1' })).toBe(false);
  });

  it('isBackgroundTestRun_variableAusenteOConOtroValor_false', () => {
    expect(isBackgroundTestRun(false, {})).toBe(false);
    expect(isBackgroundTestRun(false, { MAGE_TEST_BACKGROUND: 'true' })).toBe(false);
  });
});

describe('offScreenPosition', () => {
  it('offScreenPosition_unaPantalla_aLaIzquierdaDeElla', () => {
    expect(offScreenPosition([{ x: 0, y: 0 }], 1200)).toEqual({ x: -1400, y: 0 });
  });

  it('offScreenPosition_pantallaALaIzquierda_aLaIzquierdaDeEsaTambien', () => {
    expect(offScreenPosition([{ x: 0, y: 0 }, { x: -1920, y: -200 }], 1000)).toEqual({ x: -3120, y: -200 });
  });

  it('offScreenPosition_sinPantallasOAnchoInvalido_lanzaConElValor', () => {
    expect(() => offScreenPosition([], 100)).toThrow(/Sin pantallas/);
    expect(() => offScreenPosition([{ x: 0, y: 0 }], 0)).toThrow(/Ancho de ventana no valido: 0/);
  });
});
