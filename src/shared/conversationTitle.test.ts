import { describe, expect, it } from 'vitest';
import { isPlaceholderTitle } from './conversationTitle';

describe('isPlaceholderTitle', () => {
  it('isPlaceholderTitle_vacioYEspacios_true', () => {
    expect(isPlaceholderTitle('')).toBe(true);
    expect(isPlaceholderTitle('   ')).toBe(true);
  });

  it('isPlaceholderTitle_marcadoresDe012_true', () => {
    expect(isPlaceholderTitle('Nuevo chat')).toBe(true);
    expect(isPlaceholderTitle('Nueva conversación')).toBe(true);
  });

  it('isPlaceholderTitle_tituloReal_false', () => {
    expect(isPlaceholderTitle('Refactor del parser')).toBe(false);
  });
});
