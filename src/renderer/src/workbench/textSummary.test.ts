import { describe, expect, it } from 'vitest';
import { firstSentence } from './textSummary';

describe('firstSentence', () => {
  it('firstSentence_endsAtPeriod', () => {
    expect(firstSentence('Revisa el codigo. Despues propone cambios.')).toBe('Revisa el codigo.');
  });

  it('firstSentence_newlineFirst', () => {
    expect(firstSentence('Primera linea\nSegunda linea. Tercera')).toBe('Primera linea');
  });

  it('firstSentence_longWithoutPeriod_cutsAtSpaceWithEllipsis', () => {
    const text = 'palabra '.repeat(30).trim();

    const result = firstSentence(text, 20);

    expect(result).toBe('palabra palabra…');
    expect(result.length).toBeLessThanOrEqual(21);
  });

  it('firstSentence_empty_returnsEmpty', () => {
    expect(firstSentence('')).toBe('');
    expect(firstSentence('   ')).toBe('');
  });

  it('firstSentence_shortText_unchanged', () => {
    expect(firstSentence('Texto corto sin punto')).toBe('Texto corto sin punto');
    expect(firstSentence('Una sola frase.')).toBe('Una sola frase.');
  });

  it('firstSentence_invalidMax_throwsWithValue', () => {
    expect(() => firstSentence('x', 0)).toThrow('0');
  });
});
