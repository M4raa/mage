import { describe, expect, it } from 'vitest';
import {
  ANSWER_PERMISSION_SCHEMA,
  MAX_ID_CHARS,
  PERMISSION_DECISION_SCHEMA,
  parseSessionInput,
  SEND_MESSAGE_SCHEMA,
  SESSION_ID_SCHEMA,
} from './sessionInput';

describe('PERMISSION_DECISION_SCHEMA', () => {
  it('parse_allowConUpdatedInput_loConserva', () => {
    expect(PERMISSION_DECISION_SCHEMA.parse({ behavior: 'allow', updatedInput: { command: 'ls' } })).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
  });

  it('parse_denyConMensaje_valido', () => {
    expect(PERMISSION_DECISION_SCHEMA.parse({ behavior: 'deny', message: 'no' })).toEqual({ behavior: 'deny', message: 'no' });
  });

  it.each([
    ['behaviorDesconocido', { behavior: 'maybe' }],
    ['denySinMensaje', { behavior: 'deny' }],
    ['allowConCampoDeMas', { behavior: 'allow', extra: 1 }],
    ['updatedInputQueNoEsObjeto', { behavior: 'allow', updatedInput: 'rm -rf' }],
    ['updatedInputArray', { behavior: 'allow', updatedInput: ['x'] }],
    ['null', null],
  ])('parse_%s_rechaza', (_name, value) => {
    expect(PERMISSION_DECISION_SCHEMA.safeParse(value).success).toBe(false);
  });
});

describe('SEND_MESSAGE_SCHEMA', () => {
  it('parse_mensajeMinimo_valido', () => {
    expect(SEND_MESSAGE_SCHEMA.parse({ sessionId: 's1', text: 'hola' })).toEqual({ sessionId: 's1', text: 'hola' });
  });

  it('parse_textoVacio_valido', () => {
    expect(SEND_MESSAGE_SCHEMA.safeParse({ sessionId: 's1', text: '', attachments: [{ mediaType: 'image/png', data: 'AAAA' }] }).success).toBe(true);
  });

  it.each([
    ['sinSessionId', { text: 'x' }],
    ['sessionIdVacio', { sessionId: '', text: 'x' }],
    ['sessionIdDemasiadoLargo', { sessionId: 'a'.repeat(MAX_ID_CHARS + 1), text: 'x' }],
    ['textoNoCadena', { sessionId: 's', text: 5 }],
    ['adjuntoConTipoRaro', { sessionId: 's', text: 'x', attachments: [{ mediaType: 'image/svg+xml', data: 'x' }] }],
    ['campoDeMas', { sessionId: 's', text: 'x', cwd: '/' }],
  ])('parse_%s_rechaza', (_name, value) => {
    expect(SEND_MESSAGE_SCHEMA.safeParse(value).success).toBe(false);
  });
});

describe('parseSessionInput', () => {
  it('parseSessionInput_valido_devuelveElDato', () => {
    expect(parseSessionInput(SESSION_ID_SCHEMA, 'abc', 'session:stop')).toBe('abc');
  });

  it('parseSessionInput_invalido_lanzaConElCanalYElCampoSinElValor', () => {
    const attempt = () => parseSessionInput(ANSWER_PERMISSION_SCHEMA, { sessionId: 's', requestId: 'r', decision: { behavior: 'deny', message: 7, secreto: 'X-SECRETO' } }, 'session:answerPermission');

    expect(attempt).toThrow(/session:answerPermission/);
    expect(attempt).toThrow(/decision/);
    expect(attempt).not.toThrow(/X-SECRETO/);
  });
});
