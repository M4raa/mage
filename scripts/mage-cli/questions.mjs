// Preguntas del agente (AskUserQuestion) en la terminal (F7). Puro. Copia mínima del contrato de `src/shared/askUserQuestion.ts`, que un `.mjs` sin dependencias no puede importar; `questions.test.mjs` vigila que no se separen.

export const ASK_ANSWERS_KEY = 'answers';

const CANCEL_WORDS = new Set(['/cancelar', '/cancel']);
const INDEX_LIST = /^\d+(\s*,\s*\d+)*$/;

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

function toOption(raw) {
  if (!isRecord(raw) || !isNonEmptyString(raw.label)) return null;
  return { label: raw.label, description: typeof raw.description === 'string' ? raw.description : '' };
}

function toQuestion(raw) {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.question) || !isNonEmptyString(raw.header)) return null;
  if (!Array.isArray(raw.options) || raw.options.length === 0) return null;
  const options = raw.options.map(toOption);
  if (options.includes(null)) return null;
  return { question: raw.question, header: raw.header, options, multiSelect: raw.multiSelect === true };
}

// Las preguntas normalizadas, o `null` si el input no es una pregunta válida (una mal formada invalida todo).
export function parseQuestions(input) {
  const raw = input?.questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const questions = raw.map(toQuestion);
  if (questions.includes(null)) return null;
  return questions;
}

function labelsFromIndexes(t, question) {
  const indexes = [...new Set(t.split(',').map((part) => Number(part.trim())))];
  if (indexes.some((n) => n < 1 || n > question.options.length)) return { kind: 'invalid' };
  if (!question.multiSelect && indexes.length > 1) return { kind: 'invalid' };
  return { kind: 'labels', labels: indexes.map((n) => question.options[n - 1].label) };
}

export function parseQuestionReply(text, question) {
  const t = text.trim();
  if (t === '') return { kind: 'invalid' };
  if (CANCEL_WORDS.has(t)) return { kind: 'cancel' };
  if (INDEX_LIST.test(t)) return labelsFromIndexes(t, question);
  return { kind: 'labels', labels: [t] };
}

export function buildQuestionDecision(input, questions, chosen) {
  if (chosen.length !== questions.length) {
    throw new Error(`Se esperaban ${questions.length} respuestas y llegaron ${chosen.length}`);
  }
  const answers = {};
  for (const [i, q] of questions.entries()) {
    if (chosen[i].length === 0) throw new Error(`La pregunta ${JSON.stringify(q.question)} no tiene respuesta`);
    answers[q.question] = chosen[i].join(', ');
  }
  return { behavior: 'allow', updatedInput: { ...input, [ASK_ANSWERS_KEY]: answers } };
}
