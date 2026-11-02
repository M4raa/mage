import { describe, expect, it } from 'vitest';
import {
  decodeUserFacingMessage,
  foreignText,
  localized,
  localizedFromError,
  localizedWithParts,
  parseLocalizedText,
  renderForLog,
  renderLocalized,
  USER_FACING_MARK,
  UserFacingError,
  wrapError,
  type LocalizedText,
} from './localizedText';
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

const english = createTranslator('en');
const COMPACT = 'events.runtime.compactFailed';
const NOTHING = 'events.runtime.nothingToCompact';

function wrapped(): LocalizedText {
  return wrapError(COMPACT, {}, new UserFacingError(localized(NOTHING)));
}

function nested(levels: number): LocalizedText {
  let text: LocalizedText = localized(NOTHING);
  for (let i = 1; i < levels; i += 1) text = wrapError(COMPACT, {}, new UserFacingError(text));
  return text;
}

describe('wrapError y partes anidadas', () => {
  it('wrapError_errorNormal_detalleAjenoTalCual', () => {
    const text = renderLocalized(translate, wrapError(COMPACT, {}, new Error('boom')));

    expect(text).toBe(translate(COMPACT, { detail: 'boom' }));
  });

  it('wrapError_userFacingError_detalleEnElMismoIdioma', () => {
    const text = renderLocalized(english, wrapped());

    expect(text).toContain(english(NOTHING));
    expect(text).not.toContain(translate(NOTHING));
  });

  it('UserFacingError_conParts_mensajeEnCastellanoYDecodificable', () => {
    const input = wrapped();
    const { message } = new UserFacingError(input);

    expect(message.startsWith(translate(COMPACT, { detail: translate(NOTHING) }))).toBe(true);
    expect(decodeUserFacingMessage(message)).toEqual(input);
  });

  it('decodeUserFacingMessage_parteConClaveInexistente_null', () => {
    const json = JSON.stringify({ key: COMPACT, parts: { detail: { key: 'no.existe' } } });

    expect(decodeUserFacingMessage(`texto${USER_FACING_MARK}${json}`)).toBeNull();
  });

  it('localizedWithParts_dosPartes_seRenderizanAmbas', () => {
    const text = localizedWithParts('events.mcp.connectFailed', {}, { server: foreignText('srv'), detail: foreignText('caído') });

    expect(renderLocalized(translate, text)).toBe(translate('events.mcp.connectFailed', { server: 'srv', detail: 'caído' }));
  });

  it('renderForLog_textoConParts_castellano', () => {
    const text = renderForLog(wrapped());

    expect(text).toBe(translate(COMPACT, { detail: translate(NOTHING) }));
    expect(text).not.toBe(renderLocalized(english, wrapped()));
  });

  it('decodeUserFacingMessage_profundidad5_null', () => {
    const json = JSON.stringify(nested(5));

    expect(decodeUserFacingMessage(`x${USER_FACING_MARK}${json}`)).toBeNull();
  });

  it('decodeUserFacingMessage_profundidad4_decodifica', () => {
    const input = nested(4);
    const json = JSON.stringify(input);

    expect(decodeUserFacingMessage(`x${USER_FACING_MARK}${json}`)).toEqual(input);
  });
});

describe('parseLocalizedText', () => {
  it('parseLocalizedText_formaValida_devuelveElTexto', () => {
    expect(parseLocalizedText(foreignText('hola'))).toEqual(foreignText('hola'));
  });

  it('parseLocalizedText_cadena_null', () => {
    expect(parseLocalizedText('hola')).toBeNull();
  });

  it('parseLocalizedText_claveInexistente_null', () => {
    expect(parseLocalizedText({ key: 'no.existe' })).toBeNull();
  });
});
