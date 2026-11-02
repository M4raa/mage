import { describe, expect, it } from 'vitest';
import { createMessages, pickLanguage } from './messages.mjs';

describe('messages', () => {
  it.each([
    [{ env: { LANG: 'es_ES.UTF-8' }, intlLocale: 'en-GB' }, 'es'],
    [{ env: { LC_ALL: 'en_US', LANG: 'es_ES' }, intlLocale: 'es-ES' }, 'en'],
    [{ env: {}, intlLocale: 'es-ES' }, 'es'],
    [{ env: {}, intlLocale: 'en-GB' }, 'en'],
  ])('pickLanguage_casos (%j)', (input, expected) => {
    expect(pickLanguage(input)).toBe(expected);
  });

  it('createMessages_mismasClavesEnLosDosIdiomas', () => {
    const es = Object.keys(createMessages('es')).sort();
    const en = Object.keys(createMessages('en')).sort();

    expect(en).toEqual(es);
    expect(es).toHaveLength(45);
  });

  it('createMessages_permissionAsk_sinDescripcion_noPoneParentesis', () => {
    const messages = createMessages('es');

    expect(messages.permissionAsk('Bash', null)).toBe('¿Permitir Bash? [s/n]');
    expect(messages.permissionAsk('Bash', 'ls')).toBe('¿Permitir Bash? (ls) [s/n]');
  });

  it.each([
    ['boolean', { type: 'boolean' }, '[s/n]'],
    ['integerConRango', { type: 'integer', minimum: 1, maximum: 10 }, '(número entre 1 y 10)'],
    ['enum', { type: 'string', enum: ['a', 'b'] }, '(1) a, 2) b)'],
    ['password', { type: 'string', format: 'password' }, '(no se verá al escribir)'],
    ['stringLibre', { type: 'string' }, ''],
  ])('fieldHint_%s', (_name, field, expected) => {
    expect(createMessages('es').fieldHint(field)).toBe(expected);
  });

  it('elicitationInvalid_motivoDesconocido_lanza', () => {
    expect(() => createMessages('es').elicitationInvalid('raro')).toThrow('Motivo de dato no válido desconocido: raro');
  });

  it('createMessages_idiomaDesconocido_lanza', () => {
    expect(() => createMessages('fr')).toThrow('fr');
  });
});
