import { describe, expect, it } from 'vitest';
import { buildAnswers, buildUpdatedInput, parseAskUserQuestion } from '../../src/shared/askUserQuestion.ts';
import { buildQuestionDecision, parseQuestionReply, parseQuestions } from './questions.mjs';

const INPUT = { questions: [{ question: '¿Rojo o azul?', header: 'Color', options: [{ label: 'Rojo', description: 'cálido' }, { label: 'Azul' }], multiSelect: false }, { question: '¿Qué frutas?', header: 'Frutas', options: [{ label: 'Pera', description: '' }, { label: 'Uva', description: '' }, { label: 'Kiwi', description: '' }], multiSelect: true }] };

describe('questions', () => {
  it.each([
    [INPUT],
    [{}],
    [{ questions: [] }],
    [{ questions: [{ question: ' ', header: 'H', options: [{ label: 'a' }] }] }],
    [{ questions: [{ question: 'q', header: 'H', options: [] }] }],
    [{ questions: [{ question: 'q', header: 'H', options: [{ label: '' }] }] }],
    [{ questions: [INPUT.questions[0], 'no-objeto'] }],
  ])('parseQuestions_igualQueElContratoCompartido_%j', (x) => {
    expect(parseQuestions(x)).toEqual(parseAskUserQuestion(x));
  });

  it('parseQuestionReply_unNumero_suEtiqueta', () => {
    expect(parseQuestionReply('2', INPUT.questions[0])).toEqual({ kind: 'labels', labels: ['Azul'] });
  });

  it('parseQuestionReply_variosEnSimple_invalid', () => {
    expect(parseQuestionReply('1,2', INPUT.questions[0])).toEqual({ kind: 'invalid' });
  });

  it('parseQuestionReply_variosEnMultiple_enSuOrdenSinRepetir', () => {
    expect(parseQuestionReply('3, 1,3', INPUT.questions[1])).toEqual({ kind: 'labels', labels: ['Kiwi', 'Pera'] });
  });

  it('parseQuestionReply_fueraDeRango_invalid', () => {
    expect(parseQuestionReply('0', INPUT.questions[1])).toEqual({ kind: 'invalid' });
    expect(parseQuestionReply('4', INPUT.questions[1])).toEqual({ kind: 'invalid' });
  });

  it('parseQuestionReply_textoLibre_unaEtiqueta', () => {
    expect(parseQuestionReply('  verde  ', INPUT.questions[0])).toEqual({ kind: 'labels', labels: ['verde'] });
  });

  it('parseQuestionReply_vacio_invalid', () => {
    expect(parseQuestionReply('   ', INPUT.questions[0])).toEqual({ kind: 'invalid' });
  });

  it('parseQuestionReply_cancelar_cancel', () => {
    expect(parseQuestionReply('/cancelar', INPUT.questions[0])).toEqual({ kind: 'cancel' });
    expect(parseQuestionReply('/cancel', INPUT.questions[0])).toEqual({ kind: 'cancel' });
  });

  it('buildQuestionDecision_igualQueElContratoCompartido', () => {
    const chosen = [['Azul'], ['Pera', 'Kiwi']];

    const decision = buildQuestionDecision(INPUT, parseQuestions(INPUT), chosen);

    expect(decision.behavior).toBe('allow');
    expect(decision.updatedInput).toEqual(buildUpdatedInput(INPUT, buildAnswers(parseAskUserQuestion(INPUT), chosen)));
    expect(decision.updatedInput.answers).toEqual({ '¿Rojo o azul?': 'Azul', '¿Qué frutas?': 'Pera, Kiwi' });
  });

  it('buildQuestionDecision_faltaUnaRespuesta_lanza', () => {
    expect(() => buildQuestionDecision(INPUT, parseQuestions(INPUT), [['Azul']])).toThrow('Se esperaban 2 respuestas y llegaron 1');
  });

  it('buildQuestionDecision_listaVacia_lanza', () => {
    expect(() => buildQuestionDecision(INPUT, parseQuestions(INPUT), [['Azul'], []])).toThrow('no tiene respuesta');
  });
});
