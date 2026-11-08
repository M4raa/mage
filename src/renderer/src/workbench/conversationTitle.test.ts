import { describe, expect, it } from 'vitest';
import { deriveTitleFromPrompt, displayTitle, isSlashCommandText, latestCustomTitle, renamedTitleFrom, typedRenameTitle } from './conversationTitle';
import { createTranslator } from '@shared/i18n/translator';
import { makeEntry } from '@testing/transcriptEntry';

describe('deriveTitleFromPrompt', () => {
  it('promptCorto_devuelveElTextoTalCual', () => {
    expect(deriveTitleFromPrompt('Arregla el bug del login')).toBe('Arregla el bug del login');
  });

  it('promptVacio_devuelveTituloVacio', () => {
    expect(deriveTitleFromPrompt('   ')).toBe('');
    expect(deriveTitleFromPrompt('')).toBe('');
  });

  it('promptMultilinea_usaLaPrimeraLineaNoVacia', () => {
    expect(deriveTitleFromPrompt('\n\n  Primera real \nSegunda')).toBe('Primera real');
  });

  it('promptMuyLargo_recortaConPuntosSuspensivos', () => {
    const long = 'x'.repeat(80);

    const title = deriveTitleFromPrompt(long);

    expect(title.length).toBe(60); // 59 chars + '…'
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('displayTitle', () => {
  const translate = createTranslator('es');

  it('displayTitle_vacio_tabsUntitledEnCastellano', () => {
    expect(displayTitle('', translate)).toBe('Nuevo chat');
  });

  it('displayTitle_marcadorAntiguo_tabsUntitled', () => {
    expect(displayTitle('Nueva conversación', translate)).toBe('Nuevo chat');
  });

  it('displayTitle_tituloReal_igual', () => {
    expect(displayTitle('Refactor del parser', translate)).toBe('Refactor del parser');
  });
});

describe('latestCustomTitle', () => {
  const titleEntry = (customTitle: unknown, index: number) => makeEntry({ kind: 'custom-title', raw: { type: 'custom-title', customTitle }, index });

  it('latestCustomTitle_sinEntradas_null', () => {
    expect(latestCustomTitle([])).toBeNull();
  });

  it('latestCustomTitle_varias_ultima', () => {
    const entries = [titleEntry('Viejo', 0), makeEntry({ kind: 'user', raw: {}, index: 1 }), titleEntry('Nuevo', 2)];

    expect(latestCustomTitle(entries)).toBe('Nuevo');
  });

  it('latestCustomTitle_ultimaVaciaOMalFormada_usaLaAnterior', () => {
    expect(latestCustomTitle([titleEntry('Bueno', 0), titleEntry('  ', 1), titleEntry(42, 2)])).toBe('Bueno');
  });
});

// P-028 (grupo C).
describe('isSlashCommandText', () => {
  it('isSlashCommandText_comandoConYSinArgs_true', () => {
    expect(isSlashCommandText('/context')).toBe(true);
    expect(isSlashCommandText('  /rename Mi nombre ')).toBe(true);
    expect(isSlashCommandText('/itb-skills:itb-core algo')).toBe(true);
  });

  it('isSlashCommandText_rutaOTextoNormal_false', () => {
    expect(isSlashCommandText('/src/app.ts falla')).toBe(false);
    expect(isSlashCommandText('mira /context')).toBe(false);
    expect(isSlashCommandText('/')).toBe(false);
    expect(isSlashCommandText('')).toBe(false);
  });
});

describe('renamedTitleFrom', () => {
  it('renamedTitleFrom_salidaMedida_usaElNombreDeLaSalida', () => {
    expect(renamedTitleFrom({ args: 'x', text: 'Session renamed to: probe-2' })).toBe('probe-2');
  });

  it('renamedTitleFrom_sinSalida_usaLosArgs', () => {
    expect(renamedTitleFrom({ args: '  Nombre ', text: '' })).toBe('Nombre');
  });

  it('renamedTitleFrom_salidaDeError_null', () => {
    expect(renamedTitleFrom({ args: 'x', text: 'Name too long' })).toBeNull();
    expect(renamedTitleFrom({ args: '', text: '' })).toBeNull();
  });
});

describe('typedRenameTitle', () => {
  it('typedRenameTitle_conNombre_devuelveElNombre', () => {
    expect(typedRenameTitle('/rename prueba')).toBe('prueba');
  });

  it('typedRenameTitle_conEspacios_recorta', () => {
    expect(typedRenameTitle('  /rename   mi nombre  ')).toBe('mi nombre');
  });

  it.each(['/rename', '/rename   ', ''])('typedRenameTitle_sinNombre_%j_null', (text) => {
    expect(typedRenameTitle(text)).toBeNull();
  });

  it.each(['/renamex foo', '/compact', 'hola /rename x'])('typedRenameTitle_noEsRename_%j_null', (text) => {
    expect(typedRenameTitle(text)).toBeNull();
  });

  it('typedRenameTitle_variasLineas_null', () => {
    expect(typedRenameTitle('/rename a\nb')).toBeNull();
  });
});
