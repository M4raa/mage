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
};

export function createMessages(language) {
  if (language === 'es') return ES;
  if (language === 'en') return EN;
  throw new Error(`Idioma no soportado: ${String(language)}`);
}
