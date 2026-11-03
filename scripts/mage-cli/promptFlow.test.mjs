import { describe, expect, it } from 'vitest';
import { createMessages } from './messages.mjs';
import { DENIED_FROM_TERMINAL, promptFromPending, promptIsSecret, promptText, QUESTION_CANCELLED, replyToPrompt } from './promptFlow.mjs';

const messages = createMessages('es');
const INPUT = { questions: [{ question: '¿Rojo o azul?', header: 'Color', options: [{ label: 'Rojo', description: 'cálido' }, { label: 'Azul' }], multiSelect: false }, { question: '¿Qué frutas?', header: 'Frutas', options: [{ label: 'Pera', description: '' }, { label: 'Uva', description: '' }, { label: 'Kiwi', description: '' }], multiSelect: true }] };

const permissionPending = (overrides = {}) => ({ kind: 'permission', request: { requestId: 'r1', toolName: 'Bash', displayName: null, description: 'ls', input: {}, requiresUserInteraction: false, ...overrides } });
const formPrompt = (properties, required = []) => promptFromPending({ kind: 'elicitation', request: { requestId: 'e1', server: 'srv', message: 'Datos', mode: 'form', schema: { type: 'object', properties, required } } });
const urlPrompt = () => promptFromPending({ kind: 'elicitation', request: { requestId: 'u1', server: 'srv', message: 'Entra', mode: 'url', url: 'https://x.test/a', elicitationId: 'u1' } });
const questionPrompt = () => promptFromPending(permissionPending({ requiresUserInteraction: true, input: INPUT }));

describe('promptFromPending', () => {
  it('promptFromPending_permisoNormal_permission', () => {
    expect(promptFromPending(permissionPending())).toEqual({ kind: 'permission', requestId: 'r1', name: 'Bash', description: 'ls' });
  });

  it('promptFromPending_preguntaValida_question', () => {
    const prompt = questionPrompt();

    expect(prompt.kind).toBe('question');
    expect(prompt.step).toBe(0);
    expect(prompt.chosen).toEqual([]);
    expect(prompt.questions).toHaveLength(2);
  });

  it('promptFromPending_interaccionSinPreguntas_null', () => {
    expect(promptFromPending(permissionPending({ requiresUserInteraction: true, input: {} }))).toBeNull();
  });

  it('promptFromPending_elicitationUrl', () => {
    expect(urlPrompt()).toEqual({ kind: 'elicitationUrl', requestId: 'u1', server: 'srv', message: 'Entra', url: 'https://x.test/a' });
  });

  it('promptFromPending_elicitationForm', () => {
    const prompt = formPrompt({ nombre: { type: 'string' } });

    expect(prompt).toMatchObject({ kind: 'elicitationForm', requestId: 'e1', step: 0, content: {} });
    expect(prompt.fields).toHaveLength(1);
  });
});

describe('replyToPrompt', () => {
  it.each([
    ['s', { kind: 'answerPermission', decision: { behavior: 'allow' } }],
    ['n', { kind: 'answerPermission', decision: { behavior: 'deny', message: DENIED_FROM_TERMINAL } }],
    ['tal vez', { kind: 'invalid', reason: 'yesNo' }],
  ])('reply_permiso_%s', (text, expected) => {
    expect(replyToPrompt(promptFromPending(permissionPending()), text)).toEqual(expected);
  });

  it('reply_pregunta_dosPasos_contestaConAnswers', () => {
    const prompt = questionPrompt();

    const first = replyToPrompt(prompt, '2');
    const second = replyToPrompt(first.prompt, '1,3');

    expect(first.kind).toBe('continue');
    expect(first.prompt.step).toBe(1);
    expect(first.prompt.chosen).toEqual([['Azul']]);
    expect(prompt.step).toBe(0);
    expect(second.kind).toBe('answerPermission');
    expect(second.decision.updatedInput.answers).toEqual({ '¿Rojo o azul?': 'Azul', '¿Qué frutas?': 'Pera, Kiwi' });
  });

  it('reply_pregunta_cancelar_deniegaConMotivo', () => {
    expect(replyToPrompt(questionPrompt(), '/cancelar')).toEqual({ kind: 'answerPermission', decision: { behavior: 'deny', message: QUESTION_CANCELLED } });
  });

  it('reply_pregunta_invalida_reasonQuestion', () => {
    expect(replyToPrompt(questionPrompt(), '9')).toEqual({ kind: 'invalid', reason: 'question' });
  });

  it.each([
    ['s', 'accept'],
    ['n', 'decline'],
    ['/cancelar', 'cancel'],
  ])('reply_url_%s', (text, action) => {
    const result = replyToPrompt(urlPrompt(), text);

    expect(result).toEqual({ kind: 'answerElicitation', action });
    expect('content' in result).toBe(false);
  });

  it('reply_url_x_invalidYesNo', () => {
    expect(replyToPrompt(urlPrompt(), 'x')).toEqual({ kind: 'invalid', reason: 'yesNo' });
  });

  it('reply_form_completo_acceptConContent', () => {
    const prompt = formPrompt({ nombre: { type: 'string' }, apodo: { type: 'string' } }, ['nombre']);

    const first = replyToPrompt(prompt, 'Ana');
    const second = replyToPrompt(first.prompt, '');

    expect(first.kind).toBe('continue');
    expect(second).toEqual({ kind: 'answerElicitation', action: 'accept', content: { nombre: 'Ana' } });
  });

  it('reply_form_invalido_noAvanza', () => {
    expect(replyToPrompt(formPrompt({ nombre: { type: 'string' } }, ['nombre']), '')).toEqual({ kind: 'invalid', reason: 'required' });
  });

  it('reply_form_rechazar_decline', () => {
    const result = replyToPrompt(formPrompt({ nombre: { type: 'string' } }), '/rechazar');

    expect(result).toEqual({ kind: 'answerElicitation', action: 'decline' });
    expect('content' in result).toBe(false);
  });

  it('reply_form_sinCampos_acceptVacio', () => {
    expect(replyToPrompt(formPrompt({}), 'lo que sea')).toEqual({ kind: 'answerElicitation', action: 'accept', content: {} });
  });
});

describe('promptText', () => {
  it('promptText_pregunta_listaLasOpciones', () => {
    const text = promptText(questionPrompt(), messages);

    expect(text).toContain('[pregunta 1 de 2] Color: ¿Rojo o azul?');
    expect(text).toContain('  1) Rojo — cálido');
    expect(text).toContain('  2) Azul');
    expect(text).toContain(messages.questionHint(false));
  });

  it('promptText_formPaso0_llevaCabeceraYPista', () => {
    const text = promptText(formPrompt({ nombre: { type: 'string' } }, ['nombre']), messages);

    expect(text).toBe(`${messages.elicitationHeader('srv', 'Datos')}\n${messages.elicitationCancelHint()}\nnombre:`);
  });

  it('promptText_formPaso1_sinCabecera', () => {
    const prompt = formPrompt({ nombre: { type: 'string' }, edad: { type: 'integer' } }, ['nombre', 'edad']);

    const text = promptText(replyToPrompt(prompt, 'Ana').prompt, messages);

    expect(text).toBe('edad (número):');
  });
});

describe('promptIsSecret', () => {
  it('promptIsSecret_campoPassword_true', () => {
    expect(promptIsSecret(formPrompt({ clave: { type: 'string', format: 'password' } }, ['clave']))).toBe(true);
  });

  it('promptIsSecret_permiso_false', () => {
    expect(promptIsSecret(promptFromPending(permissionPending()))).toBe(false);
  });
});
