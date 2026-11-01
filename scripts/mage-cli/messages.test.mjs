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
    expect(es).toHaveLength(29);
  });

  it('createMessages_permissionAsk_sinDescripcion_noPoneParentesis', () => {
    const messages = createMessages('es');

    expect(messages.permissionAsk('Bash', null)).toBe('¿Permitir Bash? [s/n]');
    expect(messages.permissionAsk('Bash', 'ls')).toBe('¿Permitir Bash? (ls) [s/n]');
  });

  it('createMessages_idiomaDesconocido_lanza', () => {
    expect(() => createMessages('fr')).toThrow('fr');
  });
});
