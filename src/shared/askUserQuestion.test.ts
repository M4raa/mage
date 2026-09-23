import { describe, expect, it } from 'vitest';
import { buildAnswers, buildUpdatedInput, parseAskUserQuestion } from './askUserQuestion';

// El input LITERAL medido en el control_request del CLI (PLAN-NO-TOCAR.md §2.3). Un fixture inventado
// no probaria el contrato: probaria lo que uno cree que manda el CLI.
const MEASURED_INPUT: Readonly<Record<string, unknown>> = {
  questions: [
    {
      question: '¿Prefieres el color rojo o el azul?',
      header: 'Preferencia de color',
      options: [
        { label: 'Rojo', description: 'El color del fuego' },
        { label: 'Azul', description: 'El color del cielo' },
      ],
      multiSelect: false,
    },
  ],
};

describe('parseAskUserQuestion', () => {
  it('parseAskUserQuestion_inputMedidoDelCli_devuelveLasPreguntas', () => {
    const questions = parseAskUserQuestion(MEASURED_INPUT);

    expect(questions).toEqual([
      {
        question: '¿Prefieres el color rojo o el azul?',
        header: 'Preferencia de color',
        options: [
          { label: 'Rojo', description: 'El color del fuego' },
          { label: 'Azul', description: 'El color del cielo' },
        ],
        multiSelect: false,
      },
    ]);
  });

  it('parseAskUserQuestion_multiSelectTrue_seConserva', () => {
    const input = { questions: [{ ...(MEASURED_INPUT.questions as unknown[])[0] as object, multiSelect: true }] };

    expect(parseAskUserQuestion(input)?.[0]?.multiSelect).toBe(true);
  });

  it('parseAskUserQuestion_campoDesconocidoEnLaOpcion_noInvalidaLaPregunta', () => {
    // El CLI puede añadir campos (p.ej. `preview`): eso no puede tumbar la tarjeta.
    const input = {
      questions: [{ question: 'q', header: 'h', options: [{ label: 'A', description: 'd', preview: '...' }] }],
    };

    expect(parseAskUserQuestion(input)).toHaveLength(1);
  });

  it('parseAskUserQuestion_inputSinQuestions_devuelveNull', () => {
    expect(parseAskUserQuestion({ command: 'ls -la' })).toBeNull();
  });

  it('parseAskUserQuestion_questionsVacio_devuelveNull', () => {
    expect(parseAskUserQuestion({ questions: [] })).toBeNull();
  });

  it('parseAskUserQuestion_opcionSinLabel_devuelveNull', () => {
    const input = { questions: [{ question: 'q', header: 'h', options: [{ description: 'sin etiqueta' }] }] };

    expect(parseAskUserQuestion(input)).toBeNull();
  });

  it('parseAskUserQuestion_preguntaSinOpciones_devuelveNull', () => {
    expect(parseAskUserQuestion({ questions: [{ question: 'q', header: 'h', options: [] }] })).toBeNull();
  });

  it('parseAskUserQuestion_unaPreguntaMalFormadaDeDos_invalidaElConjunto', () => {
    // Media tarjeta es peor que ninguna: el usuario contestaria a algo que no es lo que le preguntaron.
    const input = {
      questions: [
        { question: 'q1', header: 'h1', options: [{ label: 'A' }] },
        { question: '', header: 'h2', options: [{ label: 'B' }] },
      ],
    };

    expect(parseAskUserQuestion(input)).toBeNull();
  });

  it('parseAskUserQuestion_inputDeUnaToolNormal_devuelveNull', () => {
    expect(parseAskUserQuestion({ command: 'pnpm test', description: 'corre los tests' })).toBeNull();
  });
});

describe('buildAnswers / buildUpdatedInput', () => {
  const questions = parseAskUserQuestion(MEASURED_INPUT) ?? [];

  it('buildAnswers_unaPregunta_claveEsElTextoDeLaPregunta', () => {
    // Con el `header` como clave el modelo recibe un mapa que no reconoce y responde como si no le
    // hubieran contestado: exactamente el sintoma que 2.3 arregla.
    expect(buildAnswers(questions, [['Rojo']])).toEqual({ '¿Prefieres el color rojo o el azul?': 'Rojo' });
  });

  it('buildAnswers_multiSelect_uneConComas', () => {
    expect(buildAnswers(questions, [['Rojo', 'Azul']])).toEqual({ '¿Prefieres el color rojo o el azul?': 'Rojo, Azul' });
  });

  it('buildAnswers_respuestaVacia_lanzaConElValorRecibido', () => {
    expect(() => buildAnswers(questions, [[]])).toThrow(/respuesta vacia.*color rojo o el azul/i);
    expect(() => buildAnswers(questions, [['   ']])).toThrow(/respuesta vacia/i);
  });

  it('buildAnswers_numeroDeRespuestasDistinto_lanza', () => {
    expect(() => buildAnswers(questions, [])).toThrow(/se esperaban 1 respuestas y llegaron 0/i);
    expect(() => buildAnswers(questions, [['Rojo'], ['Azul']])).toThrow(/llegaron 2/i);
  });

  it('buildUpdatedInput_conservaElInputOriginalYAnadeAnswers', () => {
    const answers = buildAnswers(questions, [['Azul']]);

    const updated = buildUpdatedInput(MEASURED_INPUT, answers);

    expect(updated.questions).toBe(MEASURED_INPUT.questions); // la tool relee el input entero
    expect(updated.answers).toEqual(answers);
  });
});
