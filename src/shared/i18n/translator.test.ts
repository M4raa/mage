import { describe, expect, it } from 'vitest';
import { createTranslator } from './translator';

describe('createTranslator', () => {
  it('createTranslator_esYEn_traducenLaMismaClave', () => {
    expect(createTranslator('es')('settings.language.system')).toBe('Sistema');
    expect(createTranslator('en')('settings.language.system')).toBe('System');
  });

  it('createTranslator_conVariables_lasSustituye', () => {
    expect(createTranslator('es')('settings.language.systemHint', { language: 'English' })).toBe('Sigue el idioma del sistema operativo (English).');
  });

  it('createTranslator_valorConSecuenciasDeEscape_saleIntacto', () => {
    // Lingui decodifica \xHH y \uHHHH en el resultado: una ruta de Windows no puede cambiar al pintarla.
    const path = 'C:\\x86tools\\u0041b\\Users';

    expect(createTranslator('es')('settings.language.systemHint', { language: path })).toBe(`Sigue el idioma del sistema operativo (${path}).`);
  });

  it('createTranslator_catalogoPropio_loUsaEnVezDelCompilado', () => {
    expect(createTranslator('en', { 'settings.language.system': 'Ŝýšţéɱ' })('settings.language.system')).toBe('Ŝýšţéɱ');
  });
});

// Prueba de TIPOS (la ejecuta `pnpm typecheck`): si alguna de estas llamadas compilara, `@ts-expect-error` fallaría.
describe('Translate — tipos', () => {
  it('translate_claveInexistenteOVariableQueFalta_noCompila', () => {
    const t = createTranslator('es');
    // @ts-expect-error clave que no está en es.json
    expect(t('no.existe')).toBe('no.existe');
    // @ts-expect-error falta la variable `language`
    expect(typeof t('settings.language.systemHint')).toBe('string');
    // @ts-expect-error variable con otro nombre
    expect(typeof t('settings.language.systemHint', { lang: 'x' })).toBe('string');
    // @ts-expect-error un mensaje sin variables no acepta valores
    expect(t('settings.language.system', { x: 1 })).toBe('Sistema');
  });
});
