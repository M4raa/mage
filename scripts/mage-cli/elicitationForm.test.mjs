import { describe, expect, it } from 'vitest';
import { validateElicitationAnswer } from '../../src/shared/elicitation.ts';
import { formFields, isSecretField, parseFieldReply } from './elicitationForm.mjs';

const entry = (field, required = true) => ({ name: 'campo', field, required });

describe('elicitationForm', () => {
  it('formFields_form_enOrdenConRequired', () => {
    const properties = { nombre: { type: 'string' }, edad: { type: 'integer' } };

    const fields = formFields({ mode: 'form', schema: { type: 'object', properties, required: ['edad'] } });

    expect(fields).toEqual([{ name: 'nombre', field: properties.nombre, required: false }, { name: 'edad', field: properties.edad, required: true }]);
  });

  it('formFields_url_vacio', () => {
    expect(formFields({ mode: 'url', url: 'https://x.test', elicitationId: 'u' })).toEqual([]);
  });

  it('parseFieldReply_cancelarYRechazar', () => {
    const e = entry({ type: 'string' });
    expect(parseFieldReply('/cancelar', e)).toEqual({ kind: 'cancel' });
    expect(parseFieldReply('/cancel', e)).toEqual({ kind: 'cancel' });
    expect(parseFieldReply('/rechazar', e)).toEqual({ kind: 'decline' });
    expect(parseFieldReply('/decline', e)).toEqual({ kind: 'decline' });
  });

  it('parseFieldReply_vacioConDefault_elDefault', () => {
    expect(parseFieldReply('', entry({ type: 'string', default: 'x' }))).toEqual({ kind: 'value', value: 'x' });
  });

  it('parseFieldReply_vacioOpcional_skip', () => {
    expect(parseFieldReply('', entry({ type: 'string' }, false))).toEqual({ kind: 'skip' });
  });

  it('parseFieldReply_vacioObligatorio_invalidRequired', () => {
    expect(parseFieldReply('', entry({ type: 'string' }))).toEqual({ kind: 'invalid', reason: 'required' });
  });

  it.each([
    ['s', { kind: 'value', value: true }],
    ['sí', { kind: 'value', value: true }],
    ['yes', { kind: 'value', value: true }],
    ['n', { kind: 'value', value: false }],
    ['quizá', { kind: 'invalid', reason: 'boolean' }],
  ])('parseFieldReply_boolean_%s', (text, expected) => {
    expect(parseFieldReply(text, entry({ type: 'boolean' }))).toEqual(expected);
  });

  it('parseFieldReply_integer', () => {
    const e = entry({ type: 'integer' });
    expect(parseFieldReply('42', e)).toEqual({ kind: 'value', value: 42 });
    expect(parseFieldReply('4.5', e)).toEqual({ kind: 'invalid', reason: 'integer' });
    expect(parseFieldReply('abc', e)).toEqual({ kind: 'invalid', reason: 'number' });
    expect(parseFieldReply('11', entry({ type: 'integer', minimum: 1, maximum: 10 }))).toEqual({ kind: 'invalid', reason: 'range' });
  });

  it('parseFieldReply_number_decimal', () => {
    expect(parseFieldReply('-2.5', entry({ type: 'number' }))).toEqual({ kind: 'value', value: -2.5 });
  });

  it('parseFieldReply_enum', () => {
    const e = entry({ type: 'string', enum: ['a', 'b'] });
    expect(parseFieldReply('2', e)).toEqual({ kind: 'value', value: 'b' });
    expect(parseFieldReply('a', e)).toEqual({ kind: 'value', value: 'a' });
    expect(parseFieldReply('3', e)).toEqual({ kind: 'invalid', reason: 'enum' });
    expect(parseFieldReply('c', e)).toEqual({ kind: 'invalid', reason: 'enum' });
  });

  it('parseFieldReply_stringLongitud', () => {
    const e = entry({ type: 'string', minLength: 3 });
    expect(parseFieldReply('ab', e)).toEqual({ kind: 'invalid', reason: 'length' });
    expect(parseFieldReply('abc', e)).toEqual({ kind: 'value', value: 'abc' });
  });

  it('isSecretField_password_true', () => {
    expect(isSecretField(entry({ type: 'string', format: 'password' }))).toBe(true);
  });

  it('isSecretField_email_false', () => {
    expect(isSecretField(entry({ type: 'string', format: 'email' }))).toBe(false);
  });

  it('parseFieldReply_respuestaValida_laAceptaElValidadorCompartido', () => {
    const request = { requestId: 'r', server: 'srv', message: 'm', mode: 'form', schema: { type: 'object', properties: { nombre: { type: 'string' }, edad: { type: 'integer', minimum: 0 }, acepta: { type: 'boolean' } }, required: ['nombre'] } };
    const replies = { nombre: 'Ana', edad: '30', acepta: 's' };
    const content = {};

    for (const fieldEntry of formFields(request)) content[fieldEntry.name] = parseFieldReply(replies[fieldEntry.name], fieldEntry).value;

    expect(content).toEqual({ nombre: 'Ana', edad: 30, acepta: true });
    expect(validateElicitationAnswer(request, { sessionId: 's', requestId: 'r', action: 'accept', content })).toBe(true);
  });
});
