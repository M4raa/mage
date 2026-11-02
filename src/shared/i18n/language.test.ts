import { describe, expect, it } from 'vitest';
import { resolveFormatLocale, resolveUiLanguage, resolveUiLanguageWithFormat } from './language';

// Las seis entradas son las MEDIDAS con Electron 44.4.5 real (INFORME-033 §2): Windows y cinco combinaciones de
// LANG/LANGUAGE en WSL Ubuntu, tal como las devuelve `app.getPreferredSystemLanguages()`.
describe('resolveUiLanguage — sistema (medido)', () => {
  it.each([
    ['windows es-ES', ['es-ES', 'en-US'], 'es', 'es-ES'],
    ['linux LANG=es_ES.UTF-8', ['es-ES', 'es-ES', 'es', 'es'], 'es', 'es-ES'],
    ['linux LANG=en_US.UTF-8', ['en-US'], 'en', 'en-US'],
    ['linux LANG=C.UTF-8 (no es una etiqueta)', ['c'], 'en', 'en-US'],
    ['linux LANG=en_US + LANGUAGE=es:en', ['es', 'en'], 'es', 'es-ES'],
    ['linux LANG=fr_FR (respaldo U1)', ['fr-FR'], 'en', 'en-US'],
  ])('resolveUiLanguageWithFormat_%s', (_name, preferredSystemLanguages, language, formatLocale) => {
    expect(resolveUiLanguageWithFormat({ preference: 'system', preferredSystemLanguages })).toEqual({ language, systemLanguage: language, formatLocale });
  });

  it('resolveUiLanguageWithFormat_preferenciaDistintaDelSistema_diceAmbos', () => {
    expect(resolveUiLanguageWithFormat({ preference: 'en', preferredSystemLanguages: ['es-ES'] })).toEqual({ language: 'en', systemLanguage: 'es', formatLocale: 'en-US' });
  });
});

describe('resolveUiLanguage — límites', () => {
  it('resolveUiLanguage_preferenciaExplicita_ganaAlSistema', () => {
    expect(resolveUiLanguage({ preference: 'en', preferredSystemLanguages: ['es-ES'] })).toBe('en');
    expect(resolveUiLanguage({ preference: 'es', preferredSystemLanguages: ['en-US'] })).toBe('es');
  });

  it('resolveUiLanguage_sistemaSinEtiquetas_respaldoIngles', () => {
    expect(resolveUiLanguage({ preference: 'system', preferredSystemLanguages: [] })).toBe('en');
  });

  it('resolveUiLanguage_basuraAntesDeUnaEtiquetaValida_saltaLaBasura', () => {
    expect(resolveUiLanguage({ preference: 'system', preferredSystemLanguages: ['', 'c', '-', 'fr-FR', 'es_MX'] })).toBe('es');
  });

  it('resolveFormatLocale_regionDelMismoIdioma_laConserva', () => {
    expect(resolveFormatLocale('es', ['es-MX', 'en-US'])).toBe('es-MX');
    expect(resolveFormatLocale('en', ['es-ES', 'en-GB'])).toBe('en-GB');
    expect(resolveFormatLocale('es', ['es_ar'])).toBe('es-AR');
  });

  it('resolveFormatLocale_sinRegionDelIdioma_laDeDefecto', () => {
    expect(resolveFormatLocale('en', ['es-ES'])).toBe('en-US');
    expect(resolveFormatLocale('es', ['es'])).toBe('es-ES');
  });
});
