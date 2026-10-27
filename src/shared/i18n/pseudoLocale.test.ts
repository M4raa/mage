import { describe, expect, it } from 'vitest';
import type { Messages } from '@lingui/core';
import { pseudoLocalizeCatalog } from './pseudoLocale';
import { createTranslator } from './translator';

describe('pseudoLocalizeCatalog', () => {
  it('pseudoLocalizeCatalog_textoYPlural_acentuaYAlargaSinTocarVariables', () => {
    const compiled = { k: ['Hola ', ['name'], ', ', ['count', 'plural', { one: ['#', ' paso'], other: ['#', ' pasos'] }]] } as unknown as Messages;

    const pseudo = pseudoLocalizeCatalog(compiled);

    expect(JSON.stringify(pseudo.k)).toContain('["name"]');
    expect(JSON.stringify(pseudo.k)).toContain('"#"');
    expect(JSON.stringify(pseudo.k)).toContain('Hólá');
  });

  it('pseudoLocalizeCatalog_catalogoReal_todosLosMensajesSonMasLargos', () => {
    const es = createTranslator('es');
    const pseudo = createTranslator('en', pseudoLocalizeCatalog({ 'settings.language.system': 'Sistema' }));

    expect(pseudo('settings.language.system').length).toBeGreaterThan(es('settings.language.system').length * 1.3);
    expect(pseudo('settings.language.system')).toBe('Šíštémá···');
  });
});
