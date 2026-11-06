// Elegir o crear la sesión a la que se une `mage chat` (F7.3). La E/S llega por parámetro (`rpc`, `ask`, `write`),
// así que se prueba sin terminal. Sin dependencias: solo `node:*`.

const TRUST_REQUIRED_CODE = -32007;
const MAX_CHOICE_ATTEMPTS = 3;
const NEW_CONVERSATION_ANSWER = 'n';
const TERMINAL_PROVIDERS = ['claude', 'codex'];
const EXIT_TRUST_REQUIRED = 3;
const EXIT_BAD_ARGUMENTS = 2;

function withExitCode(message, exitCode, cause) {
  return Object.assign(new Error(message, { cause }), { exitCode });
}

// Carpeta sin confianza: la decide el host, el cliente no la puede autorizar.
async function createSession({ rpc, newCommandId }, { provider, accountId, cwd, optional }) {
  const params = { commandId: newCommandId(), provider, accountId, cwd, trust: { acknowledged: false }, ...optional };
  try {
    return (await rpc.call('session.create', params)).sessionId;
  } catch (error) {
    if (error?.code === TRUST_REQUIRED_CODE) throw withExitCode(error.message, EXIT_TRUST_REQUIRED, error);
    throw error;
  }
}

function pickedOptions(target) {
  const optional = {};
  for (const key of ['model', 'effort', 'permissionMode']) {
    if (target[key] !== undefined) optional[key] = target[key];
  }
  return optional;
}

// Pregunta hasta 3 veces un número entre 1 y `size` (o «n», si `allowNew`). Devuelve el índice, o 'new'.
async function askChoice({ ask, write, messages }, { prompt, size, allowNew }) {
  let lastAnswer = '';
  for (let attempt = 0; attempt < MAX_CHOICE_ATTEMPTS; attempt += 1) {
    lastAnswer = (await ask(prompt)).trim();
    if (allowNew && lastAnswer.toLowerCase() === NEW_CONVERSATION_ANSWER) return 'new';
    const number = Number(lastAnswer);
    if (Number.isInteger(number) && number >= 1 && number <= size) return number - 1;
    write(`${messages.invalidChoice(lastAnswer)}\n`);
  }
  throw withExitCode(messages.invalidChoice(lastAnswer), EXIT_BAD_ARGUMENTS);
}

// `--account` admite el id (la ruta del config dir), el nombre que imprime `mage account add` o el que se le dio con
// `--name`, sin el prefijo de carpeta (`.claude-`/`.codex-`), dentro del proveedor pedido. Varios con ese nombre: error
// con las rutas. Ninguno: el texto va tal cual y el host contesta «cuenta desconocida».
async function resolveAccountId({ rpc, messages }, { provider, accountId }) {
  const { accounts } = await rpc.call('accounts.list');
  const ofProvider = accounts.filter((account) => account.provider === provider);
  if (ofProvider.some((account) => account.id === accountId)) return accountId;
  const folderName = `.${provider}-${accountId}`;
  const named = ofProvider.filter((account) => account.name === accountId || account.name === folderName);
  if (named.length > 1) throw withExitCode(messages.ambiguousAccount(accountId, named.map((account) => account.id)), EXIT_BAD_ARGUMENTS);
  if (named.length === 1) return named[0].id;
  return accountId;
}

async function pickAccount(context, cwd) {
  const { rpc, write, messages } = context;
  const { accounts } = await rpc.call('accounts.list');
  const usable = accounts.filter((account) => TERMINAL_PROVIDERS.includes(account.provider));
  if (usable.length === 0) throw withExitCode('No hay cuentas de claude ni de codex en Mage', 1);
  write(`${messages.accountsHeader()}\n`);
  usable.forEach((account, index) => write(`${messages.accountItem(index + 1, account)}\n`));
  const index = await askChoice(context, { prompt: messages.chooseAccount(), size: usable.length, allowNew: false });
  const account = usable[index];
  return createSession(context, { provider: account.provider, accountId: account.id, cwd, optional: {} });
}

async function pickSession(context, cwd) {
  const { rpc, write, messages } = context;
  const { sessions } = await rpc.call('sessions.list');
  if (sessions.length === 0) return pickAccount(context, cwd);
  write(`${messages.sessionsHeader()}\n`);
  sessions.forEach((snapshot, index) => write(`${messages.sessionItem(index + 1, snapshot)}\n`));
  const choice = await askChoice(context, { prompt: messages.chooseSession(), size: sessions.length, allowNew: true });
  if (choice === 'new') return pickAccount(context, cwd);
  return sessions[choice].sessionId;
}

export async function resolveTarget({ rpc, target, cwd, ask, write, messages, newCommandId }) {
  const context = { rpc, ask, write, messages, newCommandId };
  if (target.kind === 'session') return target.sessionId;
  if (target.kind === 'conversation') return (await rpc.call('session.resume', { conversationId: target.conversationId })).sessionId;
  if (target.kind === 'new') {
    const accountId = await resolveAccountId(context, target);
    return createSession(context, { provider: target.provider, accountId, cwd: target.cwd ?? cwd, optional: pickedOptions(target) });
  }
  if (target.kind === 'pick') return pickSession(context, cwd);
  throw new Error(`Objetivo de chat desconocido: ${JSON.stringify(target)}`);
}
