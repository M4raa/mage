// Formulario de una elicitation de MCP en la terminal (F7): un campo por línea. Puro. main vuelve a validar la respuesta entera (`validateElicitationAnswer`).
import { decidePermissionAnswer } from './signals.mjs';

const CANCEL_WORDS = new Set(['/cancelar', '/cancel']);
const DECLINE_WORDS = new Set(['/rechazar', '/decline']);
const NUMBER_FORMAT = /^-?\d+(\.\d+)?$/;
const INDEX_FORMAT = /^\d+$/;

export function formFields(request) {
  if (request.mode !== 'form') return [];
  const required = request.schema.required ?? [];
  return Object.entries(request.schema.properties).map(([name, field]) => ({ name, field, required: required.includes(name) }));
}

export function isSecretField(entry) {
  return entry.field.type === 'string' && entry.field.format === 'password';
}

const invalid = (reason) => ({ kind: 'invalid', reason });
const value = (v) => ({ kind: 'value', value: v });

function parseBoolean(t) {
  const answer = decidePermissionAnswer(t);
  if (answer === null) return invalid('boolean');
  return value(answer === 'allow');
}

function parseNumber(t, field) {
  if (!NUMBER_FORMAT.test(t)) return invalid('number');
  const n = Number(t);
  if (field.type === 'integer' && !Number.isInteger(n)) return invalid('integer');
  if (field.minimum !== undefined && n < field.minimum) return invalid('range');
  if (field.maximum !== undefined && n > field.maximum) return invalid('range');
  return value(n);
}

function parseEnum(t, options) {
  if (INDEX_FORMAT.test(t) && Number(t) >= 1 && Number(t) <= options.length) return value(options[Number(t) - 1]);
  if (options.includes(t)) return value(t);
  return invalid('enum');
}

function parseString(t, field) {
  if (field.enum !== undefined) return parseEnum(t, field.enum);
  if (field.minLength !== undefined && t.length < field.minLength) return invalid('length');
  if (field.maxLength !== undefined && t.length > field.maxLength) return invalid('length');
  return value(t);
}

function parseTyped(t, field) {
  if (field.type === 'boolean') return parseBoolean(t);
  if (field.type === 'string') return parseString(t, field);
  return parseNumber(t, field);
}

export function parseFieldReply(text, entry) {
  const t = text.trim();
  if (CANCEL_WORDS.has(t)) return { kind: 'cancel' };
  if (DECLINE_WORDS.has(t)) return { kind: 'decline' };
  if (t !== '') return parseTyped(t, entry.field);
  if (entry.field.default !== undefined) return value(entry.field.default);
  if (!entry.required) return { kind: 'skip' };
  return invalid('required');
}
