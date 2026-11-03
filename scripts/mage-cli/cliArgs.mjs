// Argumentos del comando `mage` (F7.4): `chat`, `stop`, `account add` y la ayuda. Puro.
import { parseChatArgs } from './chatArgs.mjs';

const PROVIDERS = ['claude', 'codex'];
const STOP_USAGE = 'Uso: mage stop [--force] [--user-data-dir <dir>]';
const MCP_USAGE = 'Uso: mage mcp [--user-data-dir <dir>]';
const ACCOUNT_USAGE = 'Uso: mage account add --provider claude|codex --name <nombre> [--user-data-dir <dir>]';
const HELP_WORDS = new Set(['help', '--help', '-h']);

// Lee `--flag valor` y las opciones sin valor (`flags`); cita solo la opción en los errores, nunca lo que va detrás.
function readOptions(rest, { valueOptions, flags, usage }) {
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    if (flags.has(flag)) {
      options[flags.get(flag)] = true;
      continue;
    }
    const key = valueOptions.get(flag);
    if (key === undefined) throw new Error(`Opción desconocida: ${flag}. ${usage}`);
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`Falta el valor de ${flag}. ${usage}`);
    options[key] = value;
    i += 1;
  }
  return options;
}

function parseStop(rest) {
  const options = readOptions(rest, {
    valueOptions: new Map([['--user-data-dir', 'userDataDir']]),
    flags: new Map([['--force', 'force']]),
    usage: STOP_USAGE,
  });
  return { command: 'stop', force: options.force === true, userDataDir: options.userDataDir ?? null };
}

function parseMcp(rest) {
  const options = readOptions(rest, { valueOptions: new Map([['--user-data-dir', 'userDataDir']]), flags: new Map(), usage: MCP_USAGE });
  return { command: 'mcp', userDataDir: options.userDataDir ?? null };
}

function parseAccountAdd(rest) {
  const options = readOptions(rest, {
    valueOptions: new Map([['--provider', 'provider'], ['--name', 'name'], ['--user-data-dir', 'userDataDir']]),
    flags: new Map(),
    usage: ACCOUNT_USAGE,
  });
  if (options.provider === undefined) throw new Error(`account add necesita --provider. ${ACCOUNT_USAGE}`);
  if (!PROVIDERS.includes(options.provider)) throw new Error(`--provider debe ser claude o codex, se recibió: ${options.provider}`);
  if (options.name === undefined) throw new Error(`account add necesita --name. ${ACCOUNT_USAGE}`);
  return { command: 'accountAdd', provider: options.provider, name: options.name, userDataDir: options.userDataDir ?? null };
}

export function parseCliArgs(argv) {
  const [first, second] = argv;
  if (first === undefined || HELP_WORDS.has(first)) return { command: 'help' };
  if (first === 'chat') return { command: 'chat', ...parseChatArgs(argv) };
  if (first === 'stop') return parseStop(argv.slice(1));
  if (first === 'mcp') return parseMcp(argv.slice(1));
  if (first === 'account' && second === 'add') return parseAccountAdd(argv.slice(2));
  if (first === 'account') throw new Error(`Uso: mage account add --provider claude|codex --name <nombre>; se recibió «${String(second)}»`);
  throw new Error(`Comando desconocido: ${first}. Escribe «mage help».`);
}
