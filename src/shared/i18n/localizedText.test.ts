import { describe, expect, it } from 'vitest';
import { decodeUserFacingMessage, foreignText, localized, localizedFromError, renderLocalized, USER_FACING_MARK, UserFacingError } from './localizedText';
import { createTranslator } from './translator';

const translate = createTranslator('es');
const IPC_PREFIX = "Error invoking remote method 'x': Error: ";

describe('localized', () => {
  it('localized_conValores_guardaClaveYValores', () => {
    expect(localized('events.detailOnly', { detail: 'x' })).toEqual({ key: 'events.detailOnly', values: { detail: 'x' } });
  });
});

describe('renderLocalized', () => {
  it('renderLocalized_detailOnly_devuelveElDetalleTalCual', () => {
    expect(renderLocalized(translate, foreignText('boom C:\\x86'))).toBe('boom C:\\x86');
  });
});

describe('UserFacingError', () => {
  it('UserFacingError_mensaje_legibleConMarcaYJson', () => {
    const message = new UserFacingError(foreignText('fallo')).message;

    expect(message.startsWith('fallo')).toBe(true);
    expect(message).toContain(USER_FACING_MARK);
  });
});

describe('decodeUserFacingMessage', () => {
  it('decodeUserFacingMessage_mensajeDeUserFacingError_devuelveElLocalizedText', () => {
    const original = foreignText('hola');
    const { message } = new UserFacingError(original);

    expect(decodeUserFacingMessage(message)).toEqual(original);
    expect(decodeUserFacingMessage(IPC_PREFIX + message)).toEqual(original);
  });

  it('decodeUserFacingMessage_sinMarca_null', () => {
    expect(decodeUserFacingMessage('un error cualquiera')).toBeNull();
  });

  it('decodeUserFacingMessage_jsonRoto_null', () => {
    expect(decodeUserFacingMessage(`texto${USER_FACING_MARK}{"key":`)).toBeNull();
  });

  it('decodeUserFacingMessage_claveInexistente_null', () => {
    expect(decodeUserFacingMessage(`texto${USER_FACING_MARK}{"key":"no.existe"}`)).toBeNull();
  });
});

describe('localizedFromError', () => {
  it('localizedFromError_userFacingError_suLocalized', () => {
    const original = foreignText('a');

    expect(localizedFromError(new UserFacingError(original))).toBe(original);
  });

  it('localizedFromError_errorNormal_foreignText', () => {
    expect(localizedFromError(new Error('boom'))).toEqual(foreignText('boom'));
  });

  it('localizedFromError_noError_foreignTextDelString', () => {
    expect(localizedFromError(42)).toEqual({ key: 'events.detailOnly', values: { detail: '42' } });
  });
});
