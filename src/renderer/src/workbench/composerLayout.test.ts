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

  it('composerLayout_inlineSinEnvolver_sigueInline', () => {
    expect(composerLayout('inline', { wraps: false, empty: false })).toBe('inline');
    expect(composerLayout('inline', { wraps: false, empty: true })).toBe('inline');
  });
});
