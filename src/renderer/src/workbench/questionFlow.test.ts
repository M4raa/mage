import { describe, expect, it } from 'vitest';
import type { AskQuestion } from '@shared/askUserQuestion';
import { goTo, initialFlow, isAnswered, keyToAction, next, NO_CURSOR, prev, setOther, skip, SKIPPED_ANSWER, toAnswers, toggle } from './questionFlow';

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
  it('initialFlow_sinResaltado_ningunaOpcionMarcada', () => {
    expect(initialFlow(QUESTIONS).cursor).toBe(NO_CURSOR);
  });

  it('next_sinRespuesta_avanzaIgual', () => {
    expect(next(initialFlow(QUESTIONS)).step).toBe(1);
  });

  it('goTo_cualquierPaso_saltaSinContestar', () => {
    const state = goTo(initialFlow(QUESTIONS), 2);

    expect(state.step).toBe(2);
    expect(state.cursor).toBe(NO_CURSOR);
  });

  it('goTo_fueraDeRango_noSeMueve', () => {
    const state = initialFlow(QUESTIONS);

    expect(goTo(state, 3)).toBe(state);
    expect(goTo(state, -1)).toBe(state);
    expect(goTo(state, 1.5)).toBe(state);
  });

  it('next_enLaUltima_noPasa', () => {
    const last = goTo(initialFlow(QUESTIONS), 2);

    expect(next(last)).toBe(last);
  });

  it('toggle_unaSolaRespuesta_sustituyeLaAnterior', () => {
    const state = toggle(toggle(initialFlow(QUESTIONS), single, 'Rojo'), single, 'Azul');

    expect(state.chosen[0]).toEqual(['Azul']);
  });

  it('toggle_unaSola_borraOtraCosa', () => {
    const state = toggle(setOther(initialFlow(QUESTIONS), single, 'verde'), single, 'Rojo');

    expect(state.chosen[0]).toEqual(['Rojo']);
    expect(state.other[0]).toBe('');
  });

  it('setOther_unaSola_quitaLaOpcionElegida', () => {
    const state = setOther(toggle(initialFlow(QUESTIONS), single, 'Rojo'), single, 'verde');

    expect(state.chosen[0]).toEqual([]);
    expect(isAnswered(state, 0)).toBe(true);
  });

  it('toggle_multiseleccion_acumulaYQuita', () => {
    let state = next(initialFlow(QUESTIONS));
    state = toggle(toggle(state, multi, 'Rojo'), multi, 'Azul');
    expect(state.chosen[1]).toEqual(['Rojo', 'Azul']);

    expect(toggle(state, multi, 'Rojo').chosen[1]).toEqual(['Azul']);
  });

  it('setOther_multiseleccion_conservaLasOpciones', () => {
    const state = setOther(toggle(next(initialFlow(QUESTIONS)), multi, 'Rojo'), multi, 'verde');

    expect(state.chosen[1]).toEqual(['Rojo']);
    expect(state.other[1]).toBe('verde');
  });

  it('toggle_trasOmitir_sustituyeElOmitido', () => {
    const skipped = { ...skip(initialFlow(QUESTIONS)), step: 0 };

    expect(toggle(skipped, single, 'Rojo').chosen[0]).toEqual(['Rojo']);
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
    state = next(setOther(toggle(state, multi, 'Azul'), multi, 'verde'));
    state = skip(state);

    expect(toAnswers(state, QUESTIONS)).toEqual({
      '¿Rojo o azul?': 'Rojo',
      '¿Cuales te valen?': 'Azul, verde',
      '¿Y el tamaño?': SKIPPED_ANSWER,
    });
  });

  it('toAnswers_sinContestar_salenComoOmitidas', () => {
    const state = toggle(initialFlow(QUESTIONS), single, 'Azul');

    expect(toAnswers(state, QUESTIONS)).toEqual({
      '¿Rojo o azul?': 'Azul',
      '¿Cuales te valen?': SKIPPED_ANSWER,
      '¿Y el tamaño?': SKIPPED_ANSWER,
    });
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

    expect(keyToAction('ArrowDown', state, single)).toEqual({ type: 'cursor', index: 0 });
    expect(keyToAction('ArrowUp', state, single)).toEqual({ type: 'cursor', index: 0 });
    expect(keyToAction('ArrowRight', state, single)).toEqual({ type: 'next' });
    expect(keyToAction('ArrowLeft', state, single)).toEqual({ type: 'prev' });
    expect(keyToAction('Escape', state, single)).toEqual({ type: 'close' });
    expect(keyToAction('a', state, single)).toBeNull();
  });

  it('keyToAction_espacioSinResaltado_null', () => {
    expect(keyToAction(' ', initialFlow(QUESTIONS), single)).toBeNull();
  });

  it('keyToAction_flechaAbajoEnLaUltimaOpcion_llegaAOtraCosaYNoPasa', () => {
    const last = { ...initialFlow([single]), cursor: single.options.length - 1 };
    const other = { ...last, cursor: single.options.length };

    expect(keyToAction('ArrowDown', last, single)).toEqual({ type: 'cursor', index: single.options.length });
    expect(keyToAction('ArrowDown', other, single)).toEqual({ type: 'cursor', index: single.options.length });
  });

  it('keyToAction_enterOEspacioEnOtraCosa_enfocaSuInput', () => {
    const other = { ...initialFlow([single]), cursor: single.options.length };

    expect(keyToAction('Enter', other, single)).toEqual({ type: 'focus-other' });
    expect(keyToAction(' ', other, single)).toEqual({ type: 'focus-other' });
  });
});
