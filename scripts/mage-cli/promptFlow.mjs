// Una petición pendiente contestada desde la terminal (F7): permiso, pregunta o elicitation, paso a paso. Puro: el controlador muestra `promptText`, pasa cada línea a `replyToPrompt` y ejecuta lo que devuelve.
import { formFields, isSecretField, parseFieldReply } from './elicitationForm.mjs';
import { buildQuestionDecision, parseQuestionReply, parseQuestions } from './questions.mjs';
import { decidePermissionAnswer } from './signals.mjs';

export const DENIED_FROM_TERMINAL = 'Denegado desde la terminal';
export const QUESTION_CANCELLED = 'El usuario canceló la pregunta desde la terminal';

const CANCEL_WORDS = new Set(['/cancelar', '/cancel']);

function promptFromPermission(request) {
  if (!request.requiresUserInteraction) {
    return { kind: 'permission', requestId: request.requestId, name: request.displayName ?? request.toolName, description: request.description };
  }
  const questions = parseQuestions(request.input);
  if (questions === null) return null;
  return { kind: 'question', requestId: request.requestId, input: request.input, questions, step: 0, chosen: [] };
}

function promptFromElicitation(request) {
  const { requestId, server, message } = request;
  if (request.mode === 'url') return { kind: 'elicitationUrl', requestId, server, message, url: request.url };
  return { kind: 'elicitationForm', requestId, server, message, fields: formFields(request), step: 0, content: {} };
}

// `null` = la terminal no sabe pintarlo: «contéstala en la ventana».
export function promptFromPending(pending) {
  if (pending.kind === 'permission') return promptFromPermission(pending.request);
  return promptFromElicitation(pending.request);
}

const invalid = (reason) => ({ kind: 'invalid', reason });

function replyToPermission(text) {
  const answer = decidePermissionAnswer(text);
  if (answer === null) return invalid('yesNo');
  if (answer === 'allow') return { kind: 'answerPermission', decision: { behavior: 'allow' } };
  return { kind: 'answerPermission', decision: { behavior: 'deny', message: DENIED_FROM_TERMINAL } };
}

function replyToQuestion(prompt, text) {
  const reply = parseQuestionReply(text, prompt.questions[prompt.step]);
  if (reply.kind === 'invalid') return invalid('question');
  if (reply.kind === 'cancel') return { kind: 'answerPermission', decision: { behavior: 'deny', message: QUESTION_CANCELLED } };
  const chosen = [...prompt.chosen, reply.labels];
  if (chosen.length < prompt.questions.length) return { kind: 'continue', prompt: { ...prompt, step: prompt.step + 1, chosen } };
  return { kind: 'answerPermission', decision: buildQuestionDecision(prompt.input, prompt.questions, chosen) };
}

function replyToUrl(text) {
  const t = text.trim();
  if (CANCEL_WORDS.has(t)) return { kind: 'answerElicitation', action: 'cancel' };
  const answer = decidePermissionAnswer(t);
  if (answer === null) return invalid('yesNo');
  return { kind: 'answerElicitation', action: answer === 'allow' ? 'accept' : 'decline' };
}

function advanceForm(prompt, content) {
  if (prompt.step + 1 < prompt.fields.length) return { kind: 'continue', prompt: { ...prompt, step: prompt.step + 1, content } };
  return { kind: 'answerElicitation', action: 'accept', content };
}

function replyToForm(prompt, text) {
  if (prompt.fields.length === 0) return { kind: 'answerElicitation', action: 'accept', content: {} };
  const entry = prompt.fields[prompt.step];
  const reply = parseFieldReply(text, entry);
  if (reply.kind === 'invalid') return invalid(reply.reason);
  if (reply.kind === 'cancel') return { kind: 'answerElicitation', action: 'cancel' };
  if (reply.kind === 'decline') return { kind: 'answerElicitation', action: 'decline' };
  const content = reply.kind === 'value' ? { ...prompt.content, [entry.name]: reply.value } : prompt.content;
  return advanceForm(prompt, content);
}

const REPLIES = {
  permission: (prompt, text) => replyToPermission(text),
  question: replyToQuestion,
  elicitationUrl: (prompt, text) => replyToUrl(text),
  elicitationForm: replyToForm,
};

export function replyToPrompt(prompt, text) {
  if (!Object.hasOwn(REPLIES, prompt.kind)) throw new Error(`Tipo de petición desconocido: ${String(prompt.kind)}`);
  return REPLIES[prompt.kind](prompt, text);
}

function questionText(prompt, messages) {
  const q = prompt.questions[prompt.step];
  const options = q.options.map((option, i) => messages.questionOption(i + 1, option.label, option.description));
  return [messages.questionAsk(prompt.step + 1, prompt.questions.length, q.header, q.question), ...options, messages.questionHint(q.multiSelect)].join('\n');
}

function formText(prompt, messages) {
  const header = messages.elicitationHeader(prompt.server, prompt.message);
  if (prompt.fields.length === 0) return `${header}\n${messages.elicitationEmptyForm()}`;
  const entry = prompt.fields[prompt.step];
  const ask = messages.elicitationField(entry.field.title ?? entry.name, entry.field.description ?? null, messages.fieldHint(entry.field), entry.required);
  if (prompt.step > 0) return ask;
  return [header, messages.elicitationCancelHint(), ask].join('\n');
}

const TEXTS = {
  permission: (prompt, m) => m.permissionAsk(prompt.name, prompt.description),
  question: questionText,
  elicitationUrl: (prompt, m) => [m.elicitationHeader(prompt.server, prompt.message), m.elicitationUrl(prompt.url), m.elicitationUrlAsk()].join('\n'),
  elicitationForm: formText,
};

export function promptText(prompt, messages) {
  if (!Object.hasOwn(TEXTS, prompt.kind)) throw new Error(`Tipo de petición desconocido: ${String(prompt.kind)}`);
  return TEXTS[prompt.kind](prompt, messages);
}

export function promptIsSecret(prompt) {
  return prompt.kind === 'elicitationForm' && prompt.fields.length > 0 && isSecretField(prompt.fields[prompt.step]);
}
