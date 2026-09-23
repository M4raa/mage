import { describe, expect, it } from 'vitest';
import {  parseJsonc } from './vsixJson';

describe('parseJsonc', () => {
  it('parseJsonc_jsonLimpio_loParsea', () => {
    expect(parseJsonc('{"a":1}')).toEqual({ a: 1 });
  });

  it('parseJsonc_comentarioDeLinea_loIgnora', () => {
    expect(parseJsonc('{\n  // comentario\n  "a": 1\n}')).toEqual({ a: 1 });
  });

  it('parseJsonc_comentarioDeBloque_loIgnora', () => {
    expect(parseJsonc('{ /* c */ "a": 1 }')).toEqual({ a: 1 });
  });

  it('parseJsonc_comaColgante_laTolera', () => {
    expect(parseJsonc('{ "a": 1, "b": [1, 2,], }')).toEqual({ a: 1, b: [1, 2] });
  });

  it('parseJsonc_barrasDentroDeString_noSeTocan', () => {
    // Una URL con // dentro de un valor NO debe tratarse como comentario.
    expect(parseJsonc('{ "url": "https://x.dev/a" }')).toEqual({ url: 'https://x.dev/a' });
  });

  it('parseJsonc_comillaEscapadaEnString_noRompeElParseo', () => {
    expect(parseJsonc('{ "a": "di \\"hola\\" //x" }')).toEqual({ a: 'di "hola" //x' });
  });

  it('parseJsonc_invalido_lanzaConDetalle', () => {
    expect(() => parseJsonc('{ no es json')).toThrow(/tema no valido/i);
  });
});
