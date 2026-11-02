// Textos de `mage chat` en castellano e inglés (F7.3). Puro: el idioma se decide con el entorno que llega por
// parámetro.

// Castellano si la primera variable de locale definida empieza por `es`; sin ninguna, el locale de Intl.
export function pickLanguage({ env, intlLocale }) {
  const defined = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find((value) => value !== undefined && value !== '');
  const locale = defined ?? intlLocale;
  return locale.startsWith('es') ? 'es' : 'en';
}

function behaviorWord(behavior, words) {
  if (behavior === 'allow') return words.allowed;
  return words.denied;
}

function parenthesized(description) {
  if (description === null) return '';
  return ` (${description})`;
}

// Pista de formato de un campo de elicitation; `''` si no hace falta ninguna.
function numberHint(field, words) {
  if (field.minimum !== undefined && field.maximum !== undefined) return words.range(field.minimum, field.maximum);
  return words.number;
}

function stringHint(field, words) {
  if (field.enum !== undefined) return `(${field.enum.map((v, i) => `${i + 1}) ${v}`).join(', ')})`;
  if (field.format === 'password') return words.hidden;
  return '';
}

function fieldHintWith(field, words) {
  if (field.type === 'boolean') return words.yesNo;
  if (field.type === 'number' || field.type === 'integer') return numberHint(field, words);
  if (field.type === 'string') return stringHint(field, words);
  return '';
}

function invalidReasonWith(table, reason) {
  if (!Object.hasOwn(table, reason)) throw new Error(`Motivo de dato no válido desconocido: ${reason}`);
  return table[reason];
}

const INVALID_ES = { required: 'Este dato es obligatorio.', boolean: 'Contesta «s» o «n».', number: 'Escribe un número.', integer: 'Escribe un número entero.', range: 'El número está fuera del rango permitido.', enum: 'Elige una de las opciones.', length: 'La longitud no es la permitida.' };
const INVALID_EN = { required: 'This field is required.', boolean: 'Answer "y" or "n".', number: 'Type a number.', integer: 'Type a whole number.', range: 'The number is out of the allowed range.', enum: 'Pick one of the options.', length: 'The length is not allowed.' };
const HINT_ES = { yesNo: '[s/n]', number: '(número)', range: (min, max) => `(número entre ${min} y ${max})`, hidden: '(no se verá al escribir)' };
const HINT_EN = { yesNo: '[y/n]', number: '(number)', range: (min, max) => `(number from ${min} to ${max})`, hidden: '(hidden while typing)' };

function optionalSuffix(required, text) {
  if (required) return '';
  return text;
}

function spaced(hint) {
  if (hint === '') return '';
  return ` ${hint}`;
}

function optionLine(n, label, description) {
  if (description === '') return `  ${n}) ${label}`;
  return `  ${n}) ${label} — ${description}`;
}

function questionHintWith(multiSelect, texts) {
  if (multiSelect) return texts.multiple;
  return texts.single;
}

const ES = {
  connected: (hostVersion, mode) => `Conectado a Mage ${hostVersion} (${mode}).`,
  sessionsHeader: () => 'Sesiones abiertas:',
  sessionItem: (n, snapshot) => `  ${n}) ${snapshot.provider} · ${snapshot.state} · ${snapshot.conversationId ?? snapshot.sessionId}`,
  chooseSession: () => 'Elige un número, o «n» para una conversación nueva:',
  accountsHeader: () => 'Cuentas:',
  accountItem: (n, account) => `  ${n}) ${account.provider} · ${account.name} · ${account.billing}`,
  chooseAccount: () => 'Elige la cuenta (número):',
  invalidChoice: (text) => `Opción no válida: ${text}`,
  attached: (id) => `Conversación ${id}. Escribe y pulsa Enter; «exit» o Ctrl+D para salir sin cancelar; Ctrl+C para detener el turno.`,
  queued: () => '[en cola: saldrá al terminar el turno]',
  interrupted: (count) => `[turno detenido; ${count} mensaje(s) devueltos de la cola]`,
  interruptAgainToExit: () => '[pulsa Ctrl+C otra vez en 2 s para salir sin cancelar nada]',
  leaving: () => 'Saliendo. La sesión sigue en Mage.',
  permissionAsk: (name, description) => `¿Permitir ${name}?${parenthesized(description)} [s/n]`,
  permissionAnswered: (behavior) => `[permiso: ${behaviorWord(behavior, { allowed: 'permitido', denied: 'denegado' })}]`,
  answerInMage: () => '[hay una pregunta pendiente: contéstala en la ventana de Mage]',
  answerYesNo: () => 'Contesta «s» o «n».',
  connectionLost: () => '[se perdió la conexión con Mage; reintentando…]',
  retrying: (attempt, ms) => `[intento ${attempt} de 3 en ${ms / 1000} s]`,
  reconnected: (missed) => `[reconectado; ${missed} evento(s) que no se vieron]`,
  resendAsk: (text) => `No se sabe si llegó: «${text}». ¿Enviar de nuevo? [s/n]`,
  turnEnded: (subtype) => `[fin del turno: ${subtype}]`,
  toolUse: (name) => `[herramienta: ${name}]`,
  notice: (text) => `[aviso] ${text}`,
  error: (text) => `[error] ${text}`,
  queueSize: (n) => `[cola: ${n}]`,
  queuedFailed: (text) => `[no se pudo enviar desde la cola: ${text}]`,
  expired: () => '[la sesión caducó en segundo plano]',
  sessionClosed: () => '[la sesión terminó en Mage]',
  questionAsk: (n, total, header, question) => `[pregunta ${n} de ${total}] ${header}: ${question}`,
  questionOption: optionLine,
  questionHint: (multiSelect) => questionHintWith(multiSelect, {
    multiple: 'Escribe uno o varios números separados por comas, o tu propia respuesta; «/cancelar» para no contestar.',
    single: 'Escribe un número, o tu propia respuesta; «/cancelar» para no contestar.',
  }),
  questionInvalid: () => 'Respuesta no válida para esta pregunta.',
  elicitationHeader: (server, message) => `[${server} pide datos] ${message}`,
  elicitationCancelHint: () => '(«/rechazar» para no darlos, «/cancelar» para cancelar)',
  elicitationField: (label, description, hint, required) => `${label}${parenthesized(description)}${spaced(hint)}${optionalSuffix(required, ' [opcional: Enter para omitir]')}:`,
  fieldHint: (field) => fieldHintWith(field, HINT_ES),
  elicitationInvalid: (reason) => invalidReasonWith(INVALID_ES, reason),
  elicitationUrl: (url) => `Abre esta dirección en el navegador: ${url}`,
  elicitationUrlAsk: () => '¿Lo has completado? [s/n] («/cancelar» para cancelar)',
  elicitationEmptyForm: () => 'No pide ningún dato: pulsa Enter para aceptar.',
  notSentOffline: () => '[sin conexión: este mensaje NO se ha enviado; te lo ofreceré al reconectar]',
  unsentDuringReconnect: (count) => `[${count} mensaje(s) escritos sin conexión no se enviaron]`,
  resendUnsentAsk: (text) => `No se envió: «${text}». ¿Enviarlo ahora? [s/n]`,
  answeredElsewhere: () => '[ya contestada en otro sitio]',
};

const EN = {
  ...ES,
  connected: (hostVersion, mode) => `Connected to Mage ${hostVersion} (${mode}).`,
  sessionsHeader: () => 'Open sessions:',
  chooseSession: () => 'Pick a number, or "n" for a new conversation:',
  accountsHeader: () => 'Accounts:',
  chooseAccount: () => 'Pick the account (number):',
  invalidChoice: (text) => `Invalid choice: ${text}`,
  attached: (id) => `Conversation ${id}. Type and press Enter; "exit" or Ctrl+D to leave without cancelling; Ctrl+C to stop the turn.`,
  queued: () => '[queued: it will go out when the turn ends]',
  interrupted: (count) => `[turn stopped; ${count} message(s) taken back from the queue]`,
  interruptAgainToExit: () => '[press Ctrl+C again within 2 s to leave without cancelling anything]',
  leaving: () => 'Leaving. The session keeps running in Mage.',
  permissionAsk: (name, description) => `Allow ${name}?${parenthesized(description)} [y/n]`,
  permissionAnswered: (behavior) => `[permission: ${behaviorWord(behavior, { allowed: 'allowed', denied: 'denied' })}]`,
  answerInMage: () => '[there is a pending question: answer it in the Mage window]',
  answerYesNo: () => 'Answer "y" or "n".',
  connectionLost: () => '[connection to Mage lost; retrying…]',
  retrying: (attempt, ms) => `[attempt ${attempt} of 3 in ${ms / 1000} s]`,
  reconnected: (missed) => `[reconnected; ${missed} event(s) not seen]`,
  resendAsk: (text) => `Unknown whether it arrived: "${text}". Send again? [y/n]`,
  turnEnded: (subtype) => `[turn ended: ${subtype}]`,
  toolUse: (name) => `[tool: ${name}]`,
  notice: (text) => `[notice] ${text}`,
  queueSize: (n) => `[queue: ${n}]`,
  queuedFailed: (text) => `[could not send from the queue: ${text}]`,
  expired: () => '[the session expired in the background]',
  sessionClosed: () => '[the session ended in Mage]',
  questionAsk: (n, total, header, question) => `[question ${n} of ${total}] ${header}: ${question}`,
  questionHint: (multiSelect) => questionHintWith(multiSelect, {
    multiple: 'Type one or more numbers separated by commas, or your own answer; "/cancel" to skip answering.',
    single: 'Type a number, or your own answer; "/cancel" to skip answering.',
  }),
  questionInvalid: () => 'Not a valid answer for this question.',
  elicitationHeader: (server, message) => `[${server} asks for input] ${message}`,
  elicitationCancelHint: () => '("/decline" to refuse, "/cancel" to cancel)',
  elicitationField: (label, description, hint, required) => `${label}${parenthesized(description)}${spaced(hint)}${optionalSuffix(required, ' [optional: Enter to skip]')}:`,
  fieldHint: (field) => fieldHintWith(field, HINT_EN),
  elicitationInvalid: (reason) => invalidReasonWith(INVALID_EN, reason),
  elicitationUrl: (url) => `Open this address in your browser: ${url}`,
  elicitationUrlAsk: () => 'Done? [y/n] ("/cancel" to cancel)',
  elicitationEmptyForm: () => 'It asks for no data: press Enter to accept.',
  notSentOffline: () => '[offline: this message was NOT sent; you will be offered to send it on reconnect]',
  unsentDuringReconnect: (count) => `[${count} message(s) typed while offline were not sent]`,
  resendUnsentAsk: (text) => `Not sent: "${text}". Send it now? [y/n]`,
  answeredElsewhere: () => '[already answered elsewhere]',
};

export function createMessages(language) {
  if (language === 'es') return ES;
  if (language === 'en') return EN;
  throw new Error(`Idioma no soportado: ${String(language)}`);
}
