import { describe, expect, it } from 'vitest';
import { collectContext, describeArg } from './rendererLogForwarding';

describe('describeArg', () => {
  it('describeArg_string_loDevuelveTalCual', () => {
    expect(describeArg('hola')).toBe('hola');
  });

  it('describeArg_error_devuelveNombreYMensaje', () => {
    expect(describeArg(new TypeError('roto'))).toBe('TypeError: roto');
  });

  it('describeArg_objeto_loSerializa', () => {
    expect(describeArg({ a: 1 })).toBe('{"a":1}');
  });

  it('describeArg_undefined_noSePierde', () => {
    // JSON.stringify(undefined) devuelve `undefined`, no una cadena: sin el guard, esto acababa como
    // cadena VACIA en el log y se perdia justo el dato que se queria depurar.
    expect(describeArg(undefined)).toBe('undefined');
  });

  it('describeArg_funcion_noSePierde', () => {
    // Mismo caso que undefined: JSON.stringify de una funcion devuelve undefined.
    expect(describeArg(() => 1)).toContain('=>');
  });

  it('describeArg_referenciaCiclica_noLanza', () => {
    const cyclic: Record<string, unknown> = { name: 'raiz' };
    cyclic.self = cyclic;

    expect(() => describeArg(cyclic)).not.toThrow();
    expect(describeArg(cyclic)).toBe('[object Object]');
  });

  it('describeArg_null_loSerializa', () => {
    expect(describeArg(null)).toBe('null');
  });

  it('describeArg_numerosYBooleanos_seSerializan', () => {
    expect(describeArg(42)).toBe('42');
    expect(describeArg(false)).toBe('false');
  });
});

describe('collectContext', () => {
  it('collectContext_sinNadaEstructurado_devuelveUndefined', () => {
    // Solo strings/numeros: no hay nada que adjuntar como `data`.
    expect(collectContext(['hola', 42])).toBeUndefined();
  });

  it('collectContext_conError_adjuntaNombreMensajeYStack', () => {
    const error = new Error('boom');

    const context = collectContext(['fallo:', error]);

    expect(context?.errors).toEqual([{ name: 'Error', message: 'boom', stack: error.stack }]);
    expect(context?.args).toBeUndefined();
  });

  it('collectContext_conObjetos_losAdjuntaAparteDeLosErrores', () => {
    const error = new Error('boom');
    const payload = { id: 7 };

    const context = collectContext([error, payload]);

    expect(context?.args).toEqual([payload]); // el Error no se duplica en args
    expect((context?.errors as unknown[]).length).toBe(1);
  });

  it('collectContext_null_noCuentaComoObjeto', () => {
    // typeof null === 'object': sin el guard se adjuntaria un `args: [null]` inutil.
    expect(collectContext(['x', null])).toBeUndefined();
  });

  it('collectContext_variosErrores_losAdjuntaTodos', () => {
    const context = collectContext([new Error('a'), new TypeError('b')]);

    expect((context?.errors as Array<{ message: string }>).map((e) => e.message)).toEqual(['a', 'b']);
  });
});
