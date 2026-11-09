import { describe, expect, it } from 'vitest';
import { composerLayout, popoverAnchor } from './composerLayout';

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

describe('popoverAnchor', () => {
  const row = { left: 100, right: 700, top: 500, bottom: 560 };

  it('popoverAnchor_caracterEnMedio_encimaDelCaracter', () => {
    expect(popoverAnchor({ left: 340, right: 348, top: 520, bottom: 538 }, row, 300)).toEqual({ left: 240, bottom: 46 });
  });

  it('popoverAnchor_cercaDelBordeDerecho_seRecorta', () => {
    expect(popoverAnchor({ left: 680, right: 688, top: 520, bottom: 538 }, row, 300).left).toBe(300);
  });

  it('popoverAnchor_popoverMasAnchoQueLaFila_pegadoAlaIzquierda', () => {
    expect(popoverAnchor({ left: 400, right: 408, top: 520, bottom: 538 }, row, 900).left).toBe(0);
  });

  it('popoverAnchor_anchoNegativo_lanza', () => {
    expect(() => popoverAnchor({ left: 0, right: 0, top: 0, bottom: 0 }, row, -1)).toThrow(/-1/);
  });
});
