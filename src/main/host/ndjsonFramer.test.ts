import { describe, expect, it } from 'vitest';
import { NdjsonFramer } from './ndjsonFramer';

const bytes = (text: string): Buffer => Buffer.from(text, 'utf8');

describe('NdjsonFramer', () => {
  it('push_unaLineaCompleta_laDevuelve', () => {
    const framer = new NdjsonFramer(100);

    expect(framer.push(bytes('{"a":1}\n'))).toEqual([{ kind: 'line', text: '{"a":1}' }]);
  });

  it('push_lineaPartidaEnVariosTrozos_laUneAlCerrarse', () => {
    const framer = new NdjsonFramer(100);

    expect(framer.push(bytes('{"a"'))).toEqual([]);
    expect(framer.push(bytes(':1}\n{"b"'))).toEqual([{ kind: 'line', text: '{"a":1}' }]);
    expect(framer.push(bytes(':2}\n'))).toEqual([{ kind: 'line', text: '{"b":2}' }]);
  });

  it('push_variasLineasEnUnTrozo_lasDevuelveEnOrden', () => {
    const framer = new NdjsonFramer(100);

    expect(framer.push(bytes('a\nb\nc\n')).map((e) => (e.kind === 'line' ? e.text : e.kind))).toEqual(['a', 'b', 'c']);
  });

  it('push_lineasVaciasYRetornoDeCarro_seIgnoranOSeQuitan', () => {
    const framer = new NdjsonFramer(100);

    expect(framer.push(bytes('\n\r\nhola\r\n'))).toEqual([{ kind: 'line', text: 'hola' }]);
  });

  it('push_caracterMultibytePartidoEntreTrozos_seDecodificaEntero', () => {
    const framer = new NdjsonFramer(100);
    const encoded = bytes('ñ\n');

    expect(framer.push(encoded.subarray(0, 1))).toEqual([]);
    expect(framer.push(encoded.subarray(1))).toEqual([{ kind: 'line', text: 'ñ' }]);
  });

  it('push_lineaCerradaMayorQueElTope_overflow', () => {
    const framer = new NdjsonFramer(5);

    expect(framer.push(bytes('123456\n'))).toEqual([{ kind: 'overflow', limit: 5 }]);
  });

  it('push_lineaSinCerrarMayorQueElTope_overflowSinEsperarAlSalto', () => {
    const framer = new NdjsonFramer(5);

    expect(framer.push(bytes('123456'))).toEqual([{ kind: 'overflow', limit: 5 }]);
  });

  it('push_lineaDeExactamenteElTope_seAcepta', () => {
    const framer = new NdjsonFramer(5);

    expect(framer.push(bytes('12345\n'))).toEqual([{ kind: 'line', text: '12345' }]);
  });

  it('constructor_topeNoPositivoONoEntero_lanzaConElValor', () => {
    expect(() => new NdjsonFramer(0)).toThrow(/0/);
    expect(() => new NdjsonFramer(-1)).toThrow(/-1/);
    expect(() => new NdjsonFramer(1.5)).toThrow(/1\.5/);
  });
});
