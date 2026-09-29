import { describe, expect, it } from 'vitest';
import { composerLayout } from './composerLayout';

describe('composerLayout', () => {
  it('composerLayout_inlineYEnvuelve_pasaAApilado', () => {
    expect(composerLayout('inline', { wraps: true, empty: false })).toBe('stacked');
  });

  it('composerLayout_apiladoYNoVacio_sigueApilado', () => {
    // La histeresis: apilado el editor es mas ancho y el texto puede caber en una linea; no se vuelve.
    expect(composerLayout('stacked', { wraps: false, empty: false })).toBe('stacked');
  });

  it('composerLayout_apiladoYVacio_vuelveAInline', () => {
    expect(composerLayout('stacked', { wraps: false, empty: true })).toBe('inline');
  });

  it('composerLayout_apiladoYTextoCabeConMargen_vuelveAInline', () => {
    expect(composerLayout('stacked', { wraps: false, empty: false, textWidth: 300, inlineWidth: 400 })).toBe('inline');
  });

  it('composerLayout_apiladoYTextoJustoEnElBorde_sigueApilado', () => {
    // Sin margen de sobra volveria a envolver al instante: la histeresis lo impide.
    expect(composerLayout('stacked', { wraps: false, empty: false, textWidth: 390, inlineWidth: 400 })).toBe('stacked');
  });

  it('composerLayout_apiladoYEditorEnLineaMuyEstrecho_sigueApilado', () => {
    expect(composerLayout('stacked', { wraps: false, empty: false, textWidth: 10, inlineWidth: 120 })).toBe('stacked');
  });

  it('composerLayout_apiladoYSinMedidas_sigueApilado', () => {
    expect(composerLayout('stacked', { wraps: false, empty: false, textWidth: null, inlineWidth: 400 })).toBe('stacked');
    expect(composerLayout('stacked', { wraps: false, empty: false, textWidth: 100, inlineWidth: null })).toBe('stacked');
  });

  it('composerLayout_apiladoYEnvuelve_sigueApiladoAunqueLasMedidasCuadren', () => {
    expect(composerLayout('stacked', { wraps: true, empty: false, textWidth: 100, inlineWidth: 400 })).toBe('stacked');
  });

  it('composerLayout_inlineSinEnvolver_sigueInline', () => {
    expect(composerLayout('inline', { wraps: false, empty: false })).toBe('inline');
    expect(composerLayout('inline', { wraps: false, empty: true })).toBe('inline');
  });
});
