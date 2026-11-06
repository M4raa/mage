import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { cssAttr, getUiLanguage, parseUiLangArg, setUiLanguage, ui, uiIn, uiPrefix, uiRegExp } from './uiText.mjs';

const catalog = (lang) => JSON.parse(readFileSync(new URL(`../../src/shared/i18n/catalogs/${lang}.json`, import.meta.url), 'utf8'));
const es = catalog('es');
const en = catalog('en');

describe('uiText', () => {
  afterEach(() => setUiLanguage('es'));

  it('parseUiLangArg_sinLang_null', () => {
    expect(parseUiLangArg(['node', 'verify-gui.mjs'])).toBeNull();
  });
  it('parseUiLangArg_en_en', () => {
    expect(parseUiLangArg(['--lang=en'])).toBe('en');
  });
  it('parseUiLangArg_valorInvalido_lanzaConElValor', () => {
    expect(() => parseUiLangArg(['--lang=fr'])).toThrow('"fr"');
  });

  it('uiIn_claveSinVariables_devuelveElMensaje', () => {
    expect(uiIn('es', 'settings.language.label')).toBe(es['settings.language.label']);
    expect(uiIn('en', 'settings.language.label')).toBe('LANGUAGE');
  });
  it('uiIn_conVariable_sustituye', () => {
    expect(uiIn('es', 'accounts.add.adopt.use', { alias: 'Ana' })).toBe('Usar la sesión de Ana');
    expect(uiIn('en', 'accounts.add.adopt.use', { alias: 'Ana' })).toBe(en['accounts.add.adopt.use'].replace('{alias}', 'Ana'));
  });
  it('uiIn_faltaVariable_lanza', () => {
    expect(() => uiIn('es', 'accounts.add.adopt.use')).toThrow('alias');
  });
  it('uiIn_claveDesconocida_lanzaConLaClave', () => {
    expect(() => uiIn('es', 'no.existe.clave')).toThrow('no.existe.clave');
  });
  it('uiIn_mensajePlural_lanza', () => {
    expect(() => uiIn('es', 'app.widget.pillAttention', { count: 2 })).toThrow('app.widget.pillAttention');
  });

  it('setUiLanguage_en_uiDevuelveIngles', () => {
    setUiLanguage('en');
    expect(getUiLanguage()).toBe('en');
    expect(ui('settings.language.label')).toBe('LANGUAGE');
  });
  it('setUiLanguage_invalido_lanza', () => {
    expect(() => setUiLanguage('fr')).toThrow('"fr"');
  });

  it('uiPrefix_conVariable_textoAntesDeLaLlave', () => {
    expect(uiPrefix('tabs.bar.listPaneLabel')).toBe('Conversaciones abiertas (panel');
  });
  it('uiPrefix_sinVariable_mensajeEntero', () => {
    expect(uiPrefix('accounts.add.agy.checking')).toBe(es['accounts.add.agy.checking'].trimEnd());
  });

  it('uiRegExp_metacaracteres_escapados', () => {
    const text = ui('accounts.add.agy.checking');
    expect(text).toMatch(/[…]/);
    expect(uiRegExp('accounts.add.agy.checking').test(text)).toBe(true);
    expect(uiRegExp('accounts.add.adopt.start', 'i').test(ui('accounts.add.adopt.start'))).toBe(true);
    expect(uiRegExp('accounts.add.agy.checking').test(ui('accounts.add.agy.checking').replace('…', '.'))).toBe(false);
  });
  it('cssAttr_comillasYBarra_escapadas', () => {
    expect(cssAttr('a"b\\c')).toBe('a\\"b\\\\c');
  });
});
