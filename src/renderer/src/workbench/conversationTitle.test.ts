import { describe, expect, it } from 'vitest';
import { deriveTitleFromPrompt, isPlaceholderTitle, latestCustomTitle, NEW_CONVERSATION_TITLE } from './conversationTitle';
import { makeEntry } from '@testing/transcriptEntry';

describe('deriveTitleFromPrompt', () => {
  it('promptCorto_devuelveElTextoTalCual', () => {
    expect(deriveTitleFromPrompt('Arregla el bug del login')).toBe('Arregla el bug del login');
  });

  it('promptVacio_devuelveElPlaceholder', () => {
    expect(deriveTitleFromPrompt('   ')).toBe(NEW_CONVERSATION_TITLE);
    expect(deriveTitleFromPrompt('')).toBe(NEW_CONVERSATION_TITLE);
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

describe('isPlaceholderTitle', () => {
  it('placeholderOVacio_true', () => {
    expect(isPlaceholderTitle(NEW_CONVERSATION_TITLE)).toBe(true);
    expect(isPlaceholderTitle('   ')).toBe(true);
  });

  it('isPlaceholderTitle_placeholderAnteriorPersistido_true', () => {
    // Pestañas guardadas antes de P-026 (D19) siguen auto-titulandose con su primer mensaje.
    expect(isPlaceholderTitle('Nueva conversación')).toBe(true);
  });

  it('tituloReal_false', () => {
    expect(isPlaceholderTitle('Refactor del parser')).toBe(false);
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
