import { describe, expect, it } from 'vitest';
import { classifyTextFit } from './textFit.mjs';

const root = { left: 0, right: 300, top: 0, bottom: 100 };
const el = (overrides = {}) => ({
  id: 0, text: 'x', rect: { left: 10, right: 100, top: 0, bottom: 20 }, scrollWidth: 90, clientWidth: 90,
  overflowX: 'visible', textOverflow: 'clip', lineClamp: 'none', clippedByAncestor: false, ...overrides,
});
const measure = (elements, siblingPairs = []) => ({ root, elements, siblingPairs });
const rect = (left, right, top, bottom) => ({ left, right, top, bottom });
const hidden = { overflowX: 'hidden', scrollWidth: 200, clientWidth: 90 };

describe('classifyTextFit', () => {
  it('classifyTextFit_todoDentro_sinProblemas', () => {
    expect(classifyTextFit(measure([el()]))).toEqual([]);
  });
  it('classifyTextFit_sobresalePorLaDerecha_desborde', () => {
    const r = classifyTextFit(measure([el({ id: 3, rect: rect(10, 320, 0, 20) })]));
    expect(r.map((p) => [p.kind, p.id])).toEqual([['desborde', 3]]);
  });
  it('classifyTextFit_sobresalePeroLoRecortaUnAntecesor_noEsDesborde', () => {
    expect(classifyTextFit(measure([el({ rect: rect(10, 320, 0, 20), clippedByAncestor: true })]))).toEqual([]);
  });
  it('classifyTextFit_unPixelDeRedondeo_noEsDesborde', () => {
    expect(classifyTextFit(measure([el({ rect: rect(10, 301, 0, 20) })]))).toEqual([]);
  });
  it('classifyTextFit_ocultoSinElipsis_corteSinElipsis', () => {
    expect(classifyTextFit(measure([el(hidden)])).map((p) => p.kind)).toEqual(['corteSinElipsis']);
  });
  it('classifyTextFit_ocultoConElipsis_noEsCorte', () => {
    expect(classifyTextFit(measure([el({ ...hidden, textOverflow: 'ellipsis' })]))).toEqual([]);
  });
  it('classifyTextFit_ocultoConLineClamp_noEsCorte', () => {
    expect(classifyTextFit(measure([el({ ...hidden, lineClamp: '2' })]))).toEqual([]);
  });
  it('classifyTextFit_hermanosMontados_solape', () => {
    const els = [el({ id: 0, text: 'a' }), el({ id: 1, text: 'b', rect: rect(90, 180, 5, 25) })];
    const r = classifyTextFit(measure(els, [{ a: 0, b: 1 }]));
    expect(r).toEqual([{ kind: 'solape', id: 0, text: 'a', other: 'b' }]);
  });
  it('classifyTextFit_hermanosTocandose_noEsSolape', () => {
    const els = [el({ id: 0 }), el({ id: 1, rect: rect(100, 180, 0, 20) })];
    expect(classifyTextFit(measure(els, [{ a: 0, b: 1 }]))).toEqual([]);
  });
  it('classifyTextFit_sinRaiz_sinZona', () => {
    expect(classifyTextFit({ root: null, elements: [], siblingPairs: [] })).toEqual([{ kind: 'sinZona', id: -1, text: '' }]);
  });
});
