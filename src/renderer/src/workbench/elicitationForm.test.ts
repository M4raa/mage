import { describe, expect, it } from 'vitest';
import { validateElicitationAnswer, type ElicitationFormSchema } from '@shared/elicitation';
import { formErrors, initialValues, toContent } from './elicitationForm';

const schema: ElicitationFormSchema = {
  type: 'object',
  required: ['name', 'age'],
  properties: {
    name: { type: 'string', minLength: 2 },
    age: { type: 'integer', minimum: 18, maximum: 99 },
    ok: { type: 'boolean', default: true },
    note: { type: 'string' },
    color: { type: 'string', enum: ['red', 'blue'] },
  },
};

describe('initialValues', () => {
  it('initialValues_conDefaultsYEnum_losAplica', () => {
    expect(initialValues(schema)).toEqual({ name: '', age: '', ok: 'true', note: '', color: 'red' });
  });
});

describe('formErrors', () => {
  it('formErrors_obligatoriosVacios_losSeñala', () => {
    const errors = formErrors(schema, initialValues(schema));
    expect(Object.keys(errors).sort()).toEqual(['age', 'name']);
  });
  it('formErrors_fueraDeRangoOEnteroInvalido_error', () => {
    const base = { ...initialValues(schema), name: 'Ana' };
    expect(formErrors(schema, { ...base, age: '17' }).age).toBeDefined();
    expect(formErrors(schema, { ...base, age: '20.5' }).age).toBeDefined();
    expect(formErrors(schema, { ...base, age: 'abc' }).age).toBeDefined();
    expect(formErrors(schema, { ...base, age: '30' })).toEqual({});
  });
  it('formErrors_cadenaCorta_error', () => {
    expect(formErrors(schema, { ...initialValues(schema), name: 'A', age: '30' }).name).toBeDefined();
  });
});

describe('toContent', () => {
  it('toContent_valoresValidos_tiposCorrectosYOpcionalesVaciosOmitidos', () => {
    const content = toContent(schema, { ...initialValues(schema), name: 'Ana', age: '30' });
    expect(content).toEqual({ name: 'Ana', age: 30, ok: true, color: 'red' });
    expect(validateElicitationAnswer({ requestId: 'r', server: 's', message: 'm', mode: 'form', schema }, { sessionId: 'x', requestId: 'r', action: 'accept', content })).toBe(true);
  });
});
