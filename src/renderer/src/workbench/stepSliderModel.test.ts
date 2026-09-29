import { describe, expect, it } from 'vitest';
import { PERMISSION_MODES } from '@shared/ipc';
import {
  defaultPermissionSteps,
  effortSteps,
  permissionModeLabel,
  permissionSteps,
  stepIndexOf,
  stepSliderAnchor,
  stepValueAt,
} from './stepSliderModel';

describe('effortSteps', () => {
  it('effortSteps_porDefecto_autoALaIzquierdaYCincoNiveles', () => {
    const steps = effortSteps();

    expect(steps.map((step) => step.value)).toEqual(['', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(steps[0]?.label).toBe('Auto');
  });

  it('effortSteps_proveedorConTresNiveles_soloEsosMasAuto', () => {
    expect(effortSteps(['low', 'medium', 'high']).map((step) => step.value)).toEqual(['', 'low', 'medium', 'high']);
  });

  it('effortSteps_nivelDesconocido_usaElValorComoEtiqueta', () => {
    expect(effortSteps(['turbo']).at(-1)).toEqual({ value: 'turbo', label: 'turbo' });
  });
});

describe('permissionSteps', () => {
  it('permissionSteps_orden_planManualAceptarAutoOmitir', () => {
    expect(permissionSteps.map((step) => step.label)).toEqual(['Plan', 'Manual', 'Aceptar ediciones', 'Auto', 'Omitir permisos']);
  });

  it('permissionSteps_cubreExactamenteLosModosDelCiclo', () => {
    expect([...permissionSteps.map((step) => step.value)].sort()).toEqual([...PERMISSION_MODES].sort());
  });

  it('defaultPermissionSteps_ofreceLosCincoModosTrasDeLaCuenta', () => {
    expect(defaultPermissionSteps.map((step) => step.value)).toEqual(['', 'plan', 'default', 'acceptEdits', 'auto', 'bypassPermissions']);
  });
});

describe('stepIndexOf / stepValueAt', () => {
  it('stepIndexOf_valorPresente_devuelveSuPosicion', () => {
    expect(stepIndexOf(permissionSteps, 'acceptEdits')).toBe(2);
  });

  it('stepIndexOf_modoDesconocido_devuelveMenosUno', () => {
    expect(stepIndexOf(permissionSteps, 'dontAsk')).toBe(-1);
  });

  it('stepValueAt_posicionValida_devuelveElValor', () => {
    expect(stepValueAt(permissionSteps, 4)).toBe('bypassPermissions');
    expect(stepValueAt(effortSteps(), 0)).toBe('');
  });

  it('stepValueAt_fueraDeRango_lanzaConLaPosicion', () => {
    expect(() => stepValueAt(permissionSteps, 5)).toThrow(/5/);
    expect(() => stepValueAt(permissionSteps, -1)).toThrow(/-1/);
  });
});

describe('permissionModeLabel', () => {
  it('permissionModeLabel_modoConocido_devuelveSuEtiqueta', () => {
    expect(permissionModeLabel('default')).toBe('Manual');
  });

  it('permissionModeLabel_modoDesconocido_devuelveElNombreCrudo', () => {
    expect(permissionModeLabel('dontAsk')).toBe('dontAsk');
  });
});

describe('stepSliderAnchor', () => {
  it('stepSliderAnchor_cabeDebajo_anclaPorTopBajoElChip', () => {
    expect(stepSliderAnchor({ top: 100, bottom: 120 }, 150, 900, 4)).toEqual({ top: 124 });
  });

  it('stepSliderAnchor_chipAlFondo_anclaPorBottomEncimaDelChip', () => {
    expect(stepSliderAnchor({ top: 820, bottom: 840 }, 150, 900, 4)).toEqual({ bottom: 84 });
  });

  it('stepSliderAnchor_justoEnElLimite_vaDebajo', () => {
    expect(stepSliderAnchor({ top: 726, bottom: 746 }, 150, 900, 4)).toEqual({ top: 750 });
  });
});
