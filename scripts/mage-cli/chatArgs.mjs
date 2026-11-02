// Argumentos de `mage chat` y perfil por defecto (F7.3). Puro.
import { posix, win32 } from 'node:path';

const USAGE = 'Uso: mage chat [--user-data-dir <dir>] [--session <id> | --conversation <id> | --new --account <id> --provider claude|codex [--cwd <dir>] [--model <m>] [--effort <e>] [--permission-mode <p>]]';
const PROVIDERS = ['claude', 'codex'];
const VALUE_OPTIONS = new Map([
  ['--user-data-dir', 'userDataDir'], ['--session', 'session'], ['--conversation', 'conversation'],
  ['--account', 'account'], ['--provider', 'provider'], ['--cwd', 'cwd'],
  ['--model', 'model'], ['--effort', 'effort'], ['--permission-mode', 'permissionMode'],
]);
const NEW_ONLY = new Map([
  ['account', '--account'], ['provider', '--provider'], ['cwd', '--cwd'],
  ['model', '--model'], ['effort', '--effort'], ['permissionMode', '--permission-mode'],
]);
const NEW_OPTIONAL = ['model', 'effort', 'permissionMode'];

function readOptions(rest) {
  const options = { new: false };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flag === '--new') {
      options.new = true;
      continue;
    }
    const key = VALUE_OPTIONS.get(flag);
    if (key === undefined) throw new Error(`Opción desconocida: ${flag}. ${USAGE}`);
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`Falta el valor de ${flag}. ${USAGE}`);
    options[key] = value;
    i += 1;
  }
  return options;
}

function assertConsistent(options) {
  const chosen = ['session', 'conversation'].filter((key) => options[key] !== undefined).length + (options.new ? 1 : 0);
  if (chosen > 1) throw new Error(`Solo uno de --session, --conversation o --new (se recibieron ${chosen}). ${USAGE}`);
  if (options.new) {
    if (options.account === undefined) throw new Error(`--new necesita --account. ${USAGE}`);
    if (options.provider === undefined) throw new Error(`--new necesita --provider. ${USAGE}`);
    return;
  }
  for (const [key, flag] of NEW_ONLY) {
    if (options[key] !== undefined) throw new Error(`${flag} solo se admite con --new: ${options[key]}. ${USAGE}`);
  }
}

function buildTarget(options) {
  if (options.session !== undefined) return { kind: 'session', sessionId: options.session };
  if (options.conversation !== undefined) return { kind: 'conversation', conversationId: options.conversation };
  if (!options.new) return { kind: 'pick' };
  const target = { kind: 'new', accountId: options.account, provider: options.provider, cwd: options.cwd ?? null };
  for (const key of NEW_OPTIONAL) {
    if (options[key] !== undefined) target[key] = options[key];
  }
  return target;
}

export function parseChatArgs(argv) {
  if (argv[0] !== 'chat') throw new Error(`Uso: mage chat …; se recibió «${String(argv[0])}»`);
  const options = readOptions(argv.slice(1));
  if (options.provider !== undefined && !PROVIDERS.includes(options.provider)) {
    throw new Error(`--provider debe ser claude o codex, se recibió: ${options.provider}`);
  }
  assertConsistent(options);
  return { userDataDir: options.userDataDir ?? null, target: buildTarget(options) };
}

export function defaultUserDataDir({ platform, env, homedir }) {
  if (platform === 'win32') {
    if (env.APPDATA === undefined || env.APPDATA === '') throw new Error('Falta la variable APPDATA: no se puede localizar el perfil de Mage');
    return win32.join(env.APPDATA, 'Mage');
  }
  if (platform === 'darwin') return posix.join(homedir, 'Library', 'Application Support', 'Mage');
  const configHome = env.XDG_CONFIG_HOME;
  if (configHome !== undefined && configHome !== '') return posix.join(configHome, 'Mage');
  return posix.join(homedir, '.config', 'Mage');
}
