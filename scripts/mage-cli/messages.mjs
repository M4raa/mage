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

const HELP_ES = [
  'Uso: mage <comando>',
  '',
  '  mage chat [opciones]        conversa con una sesión de Mage desde la terminal («mage chat --help» no existe: mira las opciones abajo)',
  '  mage stop [--force]         cierra el Mage sin ventanas de este perfil (con trabajo activo pide confirmación)',
  '  mage account add --provider claude|codex --name <nombre>',
  '                              da de alta una cuenta de API; la clave se pide sin eco o se lee de la entrada estándar',
  '  mage mcp [--user-data-dir <dir>]  servidor MCP de Mage por stdio (lo lanzan Claude y Codex)',
  '  mage help                   esta ayuda',
  '',
  'Opciones de chat: --session <id> | --conversation <id> | --new --account <id> --provider claude|codex [--cwd <dir>] [--model <m>] [--effort <e>] [--permission-mode <p>]',
  'En el chat: /rewind [--files] [--copy]  rebobina la conversación desde un mensaje tuyo',
  'Todos los comandos admiten --user-data-dir <dir> para otro perfil de Mage.',
].join('\n');

const HELP_EN = [
  'Usage: mage <command>',
  '',
  '  mage chat [options]         talk to a Mage session from the terminal ("mage chat --help" does not exist: see the options below)',
  "  mage stop [--force]         closes this profile's windowless Mage (asks for confirmation if there is active work)",
  '  mage account add --provider claude|codex --name <name>',
  '                              adds an API account; the key is asked without echo or read from standard input',
  '  mage mcp [--user-data-dir <dir>]  Mage MCP server over stdio (launched by Claude and Codex)',
  '  mage help                   this help',
  '',
  'Chat options: --session <id> | --conversation <id> | --new --account <id> --provider claude|codex [--cwd <dir>] [--model <m>] [--effort <e>] [--permission-mode <p>]',
  'In chat: /rewind [--files] [--copy]  rewinds the conversation from a message of yours',
  'Every command accepts --user-data-dir <dir> for another Mage profile.',
].join('\n');

const REWIND_REASON_ES = {
  unsupported: 'Este proveedor no permite rebobinar.',
  background: 'La conversación está en segundo plano: ábrela en Mage para rebobinarla.',
  legacy: 'Esta conversación de Codex usa el historial antiguo y no se puede rebobinar.',
  notFound: 'No se encuentra ese mensaje en la conversación.',
  midTurn: 'Ese mensaje está a mitad de un turno de Codex: elige otro.',
  busy: 'Hay un turno en marcha: espera a que termine.',
};
const REWIND_REASON_EN = {
  unsupported: 'This provider cannot be rewound.',
  background: 'The conversation is in the background: open it in Mage to rewind it.',
  legacy: 'This Codex conversation uses the old history and cannot be rewound.',
  notFound: 'That message is not in the conversation.',
  midTurn: 'That message is in the middle of a Codex turn: pick another one.',
  busy: 'A turn is running: wait for it to end.',
};
const REWIND_SUMMARY_ES = {
  discarded: (n) => `Se descartarán ${n} mensajes.`,
  running: 'Se parará el turno en marcha.',
  queued: (n) => `Los ${n} mensajes de la cola vuelven a ti.`,
};
const REWIND_SUMMARY_EN = {
  discarded: (n) => `${n} messages will be discarded.`,
  running: 'The running turn will be stopped.',
  queued: (n) => `The ${n} queued messages come back to you.`,
};
const REWIND_DONE_ES = { done: 'Conversación rebobinada.', files: 'Ficheros restaurados.', copy: (id) => `Copia guardada en el hilo ${id}.` };
const REWIND_DONE_EN = { done: 'Conversation rewound.', files: 'Files restored.', copy: (id) => `Copy saved in thread ${id}.` };

function rewindReasonWith(table, reason) {
  if (!Object.hasOwn(table, reason)) throw new Error(`Motivo de rebobinado desconocido: ${String(reason)}`);
  return table[reason];
}

function rewindSummaryWith(words, plan) {
  const lines = [words.discarded(plan.discardedMessages)];
  if (plan.turnRunning) lines.push(words.running);
  if (plan.queuedCount > 0) lines.push(words.queued(plan.queuedCount));
  return lines.join('\n');
}

function rewindDoneWith(words, filesRestored, copyThreadId) {
  const parts = [words.done];
  if (filesRestored) parts.push(words.files);
  if (copyThreadId !== null) parts.push(words.copy(copyThreadId));
  return parts.join(' ');
}

// Primera línea y una por sesión, sin salto final.
function stopActiveWith(title, sessions) {
  const lines = sessions.map((s) => `  ${s.provider} · ${s.state} · ${s.conversationId ?? s.sessionId}`);
  return [title, ...lines].join('\n');
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
  help: () => HELP_ES,
  rewindUsage: () => 'Uso: /rewind [--files] [--copy]',
  rewindUnknownOption: (word) => `Opción desconocida: ${word}`,
  rewindNoPoints: () => 'Esta conversación no tiene mensajes tuyos que rebobinar.',
  rewindPointLine: (n, text, rewindable) => `  ${n}) ${text}${rewindable ? '' : ' (no rebobinable)'}`,
  rewindAskNumber: () => 'Número del mensaje desde el que rebobinar (vacío = cancelar): ',
  rewindInvalidNumber: () => 'Escribe el número de uno de los mensajes de la lista.',
  rewindNotRewindable: () => 'Ese mensaje está a mitad de un turno de Codex: elige otro.',
  rewindCancelled: () => '[rebobinado cancelado]',
  rewindUnavailable: (reason) => rewindReasonWith(REWIND_REASON_ES, reason),
  rewindPlanSummary: (plan) => rewindSummaryWith(REWIND_SUMMARY_ES, plan),
  rewindFilesUnavailable: () => 'No se pueden restaurar los ficheros desde ese punto: se rebobina solo la conversación.',
  rewindCopyUnavailable: () => 'No se puede guardar una copia en esta conversación: se rebobina sin copia.',
  rewindConfirm: () => '¿Rebobinar? (s/n) ',
  rewindDone: (filesRestored, copyThreadId) => rewindDoneWith(REWIND_DONE_ES, filesRestored, copyThreadId),
  rewindReturnedQueue: (count) => `Los ${count} mensajes de la cola vuelven a ti.`,
  startingHeadless: () => '[no había ningún Mage con este perfil: lo arranco sin ventanas]',
  startedHeadless: () => '[Mage corre sin ventanas para esta terminal. Mientras siga así, el acceso directo no abrirá la ventana: ciérralo con «mage stop» cuando termines]',
  stopping: () => 'Mage se está cerrando.',
  stopGui: () => 'Este Mage tiene ventana: ciérralo desde la ventana o desde el icono de la bandeja. «mage stop» solo cierra el Mage sin ventanas.',
  stopActive: (sessions) => stopActiveWith('Hay trabajo en marcha en estas sesiones:', sessions),
  stopConfirm: () => '¿Cerrar Mage igualmente y detenerlas? [s/n]',
  stopUseForce: () => 'No se cierra. Para cerrarlo igualmente: mage stop --force',
  nothingToStop: () => 'No hay ningún Mage en marcha con este perfil.',
  mcpNoHost: () => 'Mage no está abierto: `mage mcp` solo funciona desde una sesión de Mage.',
  mcpConnectFailed: (detail) => `No se pudo conectar con Mage: ${detail}`,
  mcpBadLine: () => 'Línea de entrada que no es JSON: se ignora.',
  mcpHostClosed: () => 'Mage cerró la conexión.',
  accountKeyPrompt: () => 'Clave de API (no se verá al escribir):',
  accountAdded: (account) => `Cuenta dada de alta: ${account.provider} · ${account.name} · ${account.billing}`,
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
  help: () => HELP_EN,
  rewindUsage: () => 'Usage: /rewind [--files] [--copy]',
  rewindUnknownOption: (word) => `Unknown option: ${word}`,
  rewindNoPoints: () => 'This conversation has no messages of yours to rewind.',
  rewindPointLine: (n, text, rewindable) => `  ${n}) ${text}${rewindable ? '' : ' (not rewindable)'}`,
  rewindAskNumber: () => 'Number of the message to rewind from (empty = cancel): ',
  rewindInvalidNumber: () => 'Type the number of one of the listed messages.',
  rewindNotRewindable: () => 'That message is in the middle of a Codex turn: pick another one.',
  rewindCancelled: () => '[rewind cancelled]',
  rewindUnavailable: (reason) => rewindReasonWith(REWIND_REASON_EN, reason),
  rewindPlanSummary: (plan) => rewindSummaryWith(REWIND_SUMMARY_EN, plan),
  rewindFilesUnavailable: () => 'Files cannot be restored from that point: only the conversation is rewound.',
  rewindCopyUnavailable: () => 'A copy cannot be saved for this conversation: it is rewound without a copy.',
  rewindConfirm: () => 'Rewind? (y/n) ',
  rewindDone: (filesRestored, copyThreadId) => rewindDoneWith(REWIND_DONE_EN, filesRestored, copyThreadId),
  rewindReturnedQueue: (count) => `The ${count} queued messages are back with you.`,
  startingHeadless: () => '[no Mage was running with this profile: starting it without windows]',
  startedHeadless: () => '[Mage is running without windows for this terminal. While it does, the shortcut will not open the window: close it with "mage stop" when you are done]',
  stopping: () => 'Mage is shutting down.',
  stopGui: () => 'This Mage has a window: close it from the window or the tray icon. "mage stop" only closes the windowless Mage.',
  stopActive: (sessions) => stopActiveWith('There is work in progress in these sessions:', sessions),
  stopConfirm: () => 'Close Mage anyway and stop them? [y/n]',
  stopUseForce: () => 'Not closing. To close it anyway: mage stop --force',
  nothingToStop: () => 'No Mage is running with this profile.',
  mcpNoHost: () => 'Mage is not open: `mage mcp` only works from a Mage session.',
  mcpConnectFailed: (detail) => `Could not connect to Mage: ${detail}`,
  mcpBadLine: () => 'Input line is not JSON: ignored.',
  mcpHostClosed: () => 'Mage closed the connection.',
  accountKeyPrompt: () => 'API key (hidden while typing):',
  accountAdded: (account) => `Account added: ${account.provider} · ${account.name} · ${account.billing}`,
};

export function createMessages(language) {
  if (language === 'es') return ES;
  if (language === 'en') return EN;
  throw new Error(`Idioma no soportado: ${String(language)}`);
}
