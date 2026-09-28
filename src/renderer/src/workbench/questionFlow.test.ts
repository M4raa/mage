import { describe, expect, it } from 'vitest';
import type { AskQuestion } from '@shared/askUserQuestion';
import { canAdvance, initialFlow, keyToAction, next, prev, setOther, skip, SKIPPED_ANSWER, toAnswers, toggle } from './questionFlow';

const single: AskQuestion = {
  question: '¿Rojo o azul?',
  header: 'Color',
  options: [
    { label: 'Rojo', description: '' },
    { label: 'Azul', description: '' },
  ],
  multiSelect: false,
};
const multi: AskQuestion = { ...single, question: '¿Cuales te valen?', header: 'Varios', multiSelect: true };
const third: AskQuestion = { ...single, question: '¿Y el tamaño?', header: 'Tamaño' };
const QUESTIONS = [single, multi, third];

describe('questionFlow', () => {
  it('next_sinRespuesta_bloqueado', () => {
    const state = initialFlow(QUESTIONS);

    expect(canAdvance(state)).toBe(false);
    expect(next(state)).toBe(state);
  });

  it('toggle_unaSolaRespuesta_sustituyeLaAnterior', () => {
    const state = toggle(toggle(initialFlow(QUESTIONS), single, 'Rojo'), single, 'Azul');

    expect(state.chosen[0]).toEqual(['Azul']);
  });

  it('toggle_multiseleccion_acumulaYQuita', () => {
    let state = next(toggle(initialFlow(QUESTIONS), single, 'Rojo'));
    state = toggle(toggle(state, multi, 'Rojo'), multi, 'Azul');
    expect(state.chosen[1]).toEqual(['Rojo', 'Azul']);

    expect(toggle(state, multi, 'Rojo').chosen[1]).toEqual(['Azul']);
  });

  it('setOther_otraCosaSola_vale', () => {
    const state = setOther(initialFlow(QUESTIONS), 'verde');

    expect(canAdvance(state)).toBe(true);
    expect(next(state).step).toBe(1);
  });

  it('skip_contestaElTextoFijoYAvanza', () => {
    const state = skip(initialFlow(QUESTIONS));

    expect(state.step).toBe(1);
    expect(state.chosen[0]).toEqual([SKIPPED_ANSWER]);
  });

  it('prev_enElPaso0_noHaceNada', () => {
    const state = initialFlow(QUESTIONS);

    expect(prev(state)).toBe(state);
  });

  it('toAnswers_todasContestadas_usaElTextoDeCadaPregunta', () => {
    let state = next(toggle(initialFlow(QUESTIONS), single, 'Rojo'));
    state = next(setOther(toggle(state, multi, 'Azul'), 'verde'));
    state = skip(state);

    expect(toAnswers(state, QUESTIONS)).toEqual({
      '¿Rojo o azul?': 'Rojo',
      '¿Cuales te valen?': 'Azul, verde',
      '¿Y el tamaño?': SKIPPED_ANSWER,
    });
  });

  it('toAnswers_faltaUna_lanza', () => {
    expect(() => toAnswers(initialFlow(QUESTIONS), QUESTIONS)).toThrow(/vacia/i);
  });

  it('keyToAction_numeroFueraDeRango_null', () => {
    // '3' con dos opciones no hace nada.
    expect(keyToAction('3', initialFlow(QUESTIONS), single)).toBeNull();
    expect(keyToAction('2', initialFlow(QUESTIONS), single)).toEqual({ type: 'toggle', label: 'Azul' });
  });

  it('keyToAction_enterEnLaUltima_contesta', () => {
    const inLast = { ...initialFlow(QUESTIONS), step: 2 };

    expect(keyToAction('Enter', initialFlow(QUESTIONS), single)).toEqual({ type: 'next' });
    expect(keyToAction('Enter', inLast, third)).toEqual({ type: 'submit' });
  });

  it('keyToAction_flechasYEscape', () => {
    const state = initialFlow(QUESTIONS);

    expect(keyToAction('ArrowDown', state, single)).toEqual({ type: 'cursor', index: 1 });
    expect(keyToAction('ArrowUp', state, single)).toEqual({ type: 'cursor', index: 0 });
    expect(keyToAction('ArrowRight', state, single)).toEqual({ type: 'next' });
    expect(keyToAction('ArrowLeft', state, single)).toEqual({ type: 'prev' });
    expect(keyToAction('Escape', state, single)).toEqual({ type: 'close' });
    expect(keyToAction('a', state, single)).toBeNull();
  });
});
