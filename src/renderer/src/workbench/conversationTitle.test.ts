import { describe, expect, it } from 'vitest';
import { deriveTitleFromPrompt, isPlaceholderTitle, NEW_CONVERSATION_TITLE } from './conversationTitle';

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

  it('tituloReal_false', () => {
    expect(isPlaceholderTitle('Refactor del parser')).toBe(false);
  });
});
