import { describe, expect, it } from 'vitest';
import { extractMessageArgs } from './icuArgs.mjs';

const args = (message) => Object.fromEntries(extractMessageArgs(message, 'k'));

describe('extractMessageArgs', () => {
  it('extractMessageArgs_sinVariables_vacio', () => {
    expect(args('Idioma')).toEqual({});
    expect(args('')).toEqual({});
  });

  it('extractMessageArgs_simpleYTipadas_clasificaCadaUna', () => {
    expect(args('{name} tiene {n, number} y {when, date, short}')).toEqual({ name: 'simple', n: 'number', when: 'date' });
  });

  it('extractMessageArgs_pluralYSelectAnidados_recorreLasOpciones', () => {
    const message = '{count, plural, =0 {nada} one {# paso de {who}} other {{kind, select, a {A} other {# pasos}}}}';

    expect(args(message)).toEqual({ count: 'number', who: 'simple', kind: 'string' });
  });

  it('extractMessageArgs_llavesEscapadasConApostrofo_noSonVariables', () => {
    expect(args("Usa '{'nombre'}' y l''apóstrofo {x}")).toEqual({ x: 'simple' });
  });

  it('extractMessageArgs_mismaVariableSimpleYNumero_quedaNumero', () => {
    expect(args('{n} y {n, plural, other {#}}')).toEqual({ n: 'number' });
  });

  it.each([
    ['llave sin cerrar', 'Hola {name'],
    ['llave sin abrir', 'Hola }'],
    ['tipo desconocido', '{n, moneda}'],
    ['nombre no válido', '{mi nombre}'],
    ['clases incompatibles', '{n, plural, other {#}} {n, select, other {x}}'],
  ])('extractMessageArgs_%s_lanzaConLaClave', (_name, message) => {
    expect(() => extractMessageArgs(message, 'clave.x')).toThrow('clave.x');
  });
});
