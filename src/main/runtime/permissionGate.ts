import type { PreparedCall, ToolKind } from './agentLoop';
import type { GateVerdict, RuntimePermissionMode } from './runtimeSession';
import { resolveToolPath, type PathClass, type PathScope } from './tools/pathGuard';

// Que hace el runtime propio con una llamada antes de ejecutarla: permitir, preguntar o denegar.
// PURO (la `realpath` llega dentro del `scope`). Tabla de P-032 §4.6 con los cinco modos (§8.1 D9):
//
// | modo              | read  | edit  | exec                                              |
// | plan              | allow | deny  | deny                                              |
// | default (Manual)  | allow | ask   | ask                                               |
// | acceptEdits       | allow | allow | ask                                               |
// | auto              | allow | allow | allow solo si esta en la lista blanca, si no ask   |
// | bypassPermissions | allow | allow | allow                                             |
//
// Encima de la tabla: una ruta que se VE fuera del cwd (y de los directorios añadidos) pregunta en todos
// los modos, tambien en bypassPermissions; en `Bash`, los comandos que NOMBRAN rutas de fuera, HOME o una
// unidad (D4 de P-033). Es una heuristica sobre el TEXTO, no una frontera: un comando puede salir del
// proyecto sin nombrarlo (un script del proyecto, una variable propia, un programa que escribe donde
// quiere), y en bypassPermissions eso se ejecuta sin preguntar. Por eso el aviso al activar «Omitir
// permisos» no promete nada fuera del proyecto. Una peticion de fuera o de red va MARCADA (`outside`)
// para que el renderer nunca la recuerde con «Permitir siempre» (D2 de P-033).
//
// `auto` (D1 de P-033): el runtime no tiene sandbox, asi que en vez de adivinar que es peligroso solo
// ejecuta sin preguntar lo que esta en una lista blanca corta (lectura, git sin red, test y build del
// proyecto) y sin nada dinamico (variables, subcomandos, codigo en linea). El resto pregunta.
// ponytail: lista blanca de texto, no sandbox. `pnpm test` o `make` ejecutan codigo del proyecto, que el
// propio modelo puede haber escrito en Auto: lo dice el aviso al entrar en el modo. Se sube con un
// sandbox real (AppContainer en Windows, seatbelt/landlock en macOS/Linux).

export interface GateInput {
  readonly mode: RuntimePermissionMode;
  readonly kind: ToolKind;
  // null = la herramienta no toca una ruta concreta (Bash, MCP).
  readonly pathClass: PathClass | null;
  // La ruta o el patron que se clasifico (para el texto de la peticion).
  readonly target: string | null;
  // Texto del comando de `Bash`; null en el resto. Un `exec` sin comando (MCP) es opaco.
  readonly command: string | null;
  readonly scope: PathScope;
}

const PLAN_DENY_REASON = 'modo Plan: solo lectura';

// Opciones globales de git ANTES del subcomando (`git -C <dir> push`, `git -c k=v pull`,
// `git --git-dir=… fetch`): las que llevan el valor aparte (-C, -c, --git-dir, --work-tree, --namespace,
// --config-env, --super-prefix) se comen tambien su argumento, con comillas o sin ellas. El programa puede
// ir con ruta, `.exe` y entre comillas (`"C:\…\git.exe" push`).
const SHELL_WORD = String.raw`(?:"[^"]*"|'[^']*'|\S+)`;
const GIT_VALUE_OPTION = String.raw`(?:-c|--(?:git-dir|work-tree|namespace|config-env|super-prefix))`;
const GIT_GLOBAL_OPTION = String.raw`(?:${GIT_VALUE_OPTION}(?:=|\s+)${SHELL_WORD}|--?[a-z][\w-]*(?:=${SHELL_WORD})?)`;
const GIT_NETWORK = String.raw`\bgit(?:\.exe)?["']?(?:\s+${GIT_GLOBAL_OPTION})*\s+(push|pull|fetch|clone|ls-remote|submodule\s+update)\b`;

const NETWORK_COMMAND = new RegExp(
  [
    String.raw`\b(curl|wget|ssh|scp|sftp|rsync|ftp|telnet|ncat|nc|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|Start-BitsTransfer|certutil)\b`,
    GIT_NETWORK,
    String.raw`\b(npm|pnpm|yarn|bun)\s+(install|i|add|update|up|upgrade|publish|dlx|create)\b`,
    String.raw`\b(npx|pnpx|bunx|uvx)\b`,
    String.raw`\b(pip3?|uv|pipx|poetry)\s+(install|add|sync|download)\b`,
    String.raw`\b(cargo|go)\s+(install|add|get|update|fetch)\b`,
    String.raw`\bdocker\s+(pull|push|run|login)\b`,
    String.raw`\b(apt|apt-get|brew|winget|choco|scoop|gh)\s`,
    String.raw`https?://`,
  ].join('|'),
  'i',
);

// Lo que hace que un comando no se pueda juzgar por su texto: variables, sustitucion de comandos,
// subexpresiones, bloques, codigo codificado o evaluado.
const DYNAMIC_CODE = /[$`(){}]|%[^%\s]+%|-enc(odedcommand)?\b|-ec\b|\biex\b|invoke-expression/i;
// Variables que apuntan fuera del proyecto (HOME y carpetas del sistema), en bash, PowerShell y cmd.
// ponytail: lista de las conocidas; una variable propia que apunte fuera (`$X`) pasa en bypass.
const OUTSIDE_VARIABLE =
  /\$\{?(HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|TMPDIR|TEMP|TMP|OLDPWD|APPDATA|LOCALAPPDATA|PROGRAMDATA|SYSTEMROOT|WINDIR|XDG_\w+)\b|\$env:|%[A-Za-z_][\w()]*%/i;
// `C:` o `C:algo`: relativo a la unidad (su directorio actual, no el cwd). `C:\…` se resuelve normal.
const DRIVE_RELATIVE = /^[a-z]:([^\\/]|$)/i;
const URL_TOKEN = /^[a-z][a-z0-9+.-]*:\/\//i;
const SEGMENT_SEPARATOR = /&&|\|\||[;|&\n\r]/;
const FD_REDIRECT = /\d*>&\d+/g;

// Lista blanca de Auto (D1 de P-033). En minusculas: PowerShell no distingue.
const READ_PROGRAMS = new Set([
  'ls', 'dir', 'cat', 'type', 'head', 'tail', 'wc', 'pwd', 'echo', 'grep', 'rg', 'tree', 'which', 'where',
  'sort', 'uniq', 'diff', 'file', 'stat', 'du', 'find',
  'get-childitem', 'gci', 'get-content', 'gc', 'get-location', 'get-item', 'select-string', 'sls', 'test-path',
  'resolve-path', 'measure-object', 'select-object', 'sort-object',
]);
// Opciones que convierten un programa de lectura en uno que ejecuta o borra.
const FORBIDDEN_FLAGS = new Set(['-exec', '-execdir', '-delete', '-ok', '-okdir', '-fprint', '-fprintf', '-fls', '--pre']);
const SUBCOMMANDS = new Map<string, ReadonlySet<string>>([
  ['git', new Set(['status', 'diff', 'log', 'show', 'add', 'commit', 'branch', 'rev-parse', 'ls-files', 'blame', 'grep'])],
  ...['npm', 'pnpm', 'yarn', 'bun'].map((pm): [string, ReadonlySet<string>] => [pm, new Set(['test', 't', 'run', 'build', 'lint', 'typecheck', 'check'])]),
  ['cargo', new Set(['build', 'test', 'check', 'clippy', 'fmt'])],
  ['go', new Set(['build', 'test', 'vet', 'fmt'])],
  ['dotnet', new Set(['build', 'test'])],
]);
const BUILD_TOOLS = new Set(['tsc', 'eslint', 'prettier', 'vitest', 'jest', 'pytest', 'make']);
const CD_PROGRAMS = new Set(['cd', 'chdir', 'set-location', 'sl', 'pushd', 'popd']);

export function decidePermission(input: GateInput): GateVerdict {
  const outside = outsideReason(input);
  if (outside !== null) {
    return input.mode === 'plan' && input.kind !== 'read' ? { verdict: 'deny', reason: PLAN_DENY_REASON } : { verdict: 'ask', outside };
  }
  if (input.kind === 'read') return { verdict: 'allow' };
  const ask = askVerdict(input.command);
  switch (input.mode) {
    case 'plan':
      return { verdict: 'deny', reason: PLAN_DENY_REASON };
    case 'default':
      return ask;
    case 'acceptEdits':
      return input.kind === 'edit' ? { verdict: 'allow' } : ask;
    case 'auto':
      return input.kind === 'edit' || isContainedCommand(input.command, input.scope) ? { verdict: 'allow' } : ask;
    case 'bypassPermissions':
      return { verdict: 'allow' };
  }
}

function outsideReason(input: GateInput): string | null {
  if (input.pathClass === 'outside') return `Fuera del proyecto: ${input.target ?? input.command ?? ''}`;
  if (input.command !== null && referencesOutside(input.command, input.scope)) return `Fuera del proyecto: ${input.command}`;
  return null;
}

// Un comando de red pregunta marcado: «Permitir siempre Bash» nunca cubre la red.
function askVerdict(command: string | null): GateVerdict {
  return command !== null && NETWORK_COMMAND.test(command) ? { verdict: 'ask', outside: `Red: ${command}` } : { verdict: 'ask' };
}

// ¿Se puede ejecutar este comando sin preguntar en Auto? Solo si no tiene nada dinamico, no sale del
// proyecto y CADA trozo (`a && b | c`) empieza por un programa de la lista blanca.
export function isContainedCommand(command: string | null, scope: PathScope): boolean {
  if (command === null || DYNAMIC_CODE.test(command)) return false;
  if (NETWORK_COMMAND.test(command) || referencesOutside(command, scope)) return false;
  return commandSegments(command).every(isWhitelistedSegment);
}

// ¿Nombra el comando algo fuera del proyecto? Rutas que salen del cwd, `~`, HOME y carpetas del
// sistema por variable, una unidad suelta (`C:`) o un `cd` sin argumento (va a HOME).
export function referencesOutside(command: string, scope: PathScope): boolean {
  if (OUTSIDE_VARIABLE.test(command)) return true;
  if (commandSegments(command).some((words) => CD_PROGRAMS.has(words[0]!.toLowerCase()) && words.length === 1)) return true;
  return shellTokens(command).some(
    (token) => token.startsWith('~') || DRIVE_RELATIVE.test(token) || (looksLikePath(token) && resolveToolPath(token, scope).pathClass === 'outside'),
  );
}

function isWhitelistedSegment(words: readonly string[]): boolean {
  const [program, ...args] = words;
  const name = program!.toLowerCase();
  if (CD_PROGRAMS.has(name)) return name !== 'popd' && args.length === 1 && args[0] !== '-';
  if (READ_PROGRAMS.has(name)) return !args.some((arg) => FORBIDDEN_FLAGS.has(arg.toLowerCase()));
  const subcommands = SUBCOMMANDS.get(name);
  if (subcommands !== undefined) return args.length > 0 && subcommands.has(args[0]!.toLowerCase());
  return BUILD_TOOLS.has(name);
}

// Los trozos del comando, cada uno como lista de palabras (sin comillas). `2>&1` no parte nada.
function commandSegments(command: string): string[][] {
  return command
    .replace(FD_REDIRECT, ' ')
    .split(SEGMENT_SEPARATOR)
    .map((segment) => segment.split(/[\s'"]+/).filter((word) => word.length > 0))
    .filter((words) => words.length > 0);
}

// Trozos del comando que pueden ser rutas (sin las URL: la red se juzga aparte).
function shellTokens(command: string): string[] {
  return command.split(/[\s'"`;|&<>()=,]+/).filter((token) => token.length > 0 && !URL_TOKEN.test(token));
}

function looksLikePath(token: string): boolean {
  return token.includes('/') || token.includes('\\') || token === '..';
}

// La puerta de UNA sesion: saca de la llamada la ruta (file_path/path, y el patron de Glob/Grep) y el
// comando, y decide.
export function createRuntimeGate(scope: PathScope): (call: PreparedCall, mode: RuntimePermissionMode) => GateVerdict {
  return (call, mode) => {
    const targets = targetsOf(call);
    const outside = targets.find((target) => classifyTarget(target, scope) === 'outside');
    const pathClass = targets.length === 0 ? null : outside === undefined ? 'inside' : 'outside';
    const command = typeof call.input.command === 'string' && call.name === 'Bash' ? call.input.command : null;
    return decidePermission({ mode, kind: call.kind, pathClass, target: outside ?? targets[0] ?? null, command, scope });
  };
}

function targetsOf(call: PreparedCall): string[] {
  const fields = [call.input.file_path ?? call.input.path];
  // C2: el patron de Glob y el filtro de Grep tambien pueden salir del proyecto (`../**`, absolutos).
  if (call.name === 'Glob') fields.push(call.input.pattern);
  if (call.name === 'Grep') fields.push(call.input.glob);
  return fields.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

// Un patron se clasifica por su parte fija (hasta el primer comodin): `../**/*.txt` -> `..`.
function classifyTarget(target: string, scope: PathScope): PathClass {
  if (target.startsWith('~')) return 'outside';
  const wildcard = target.search(/[*?[{]/);
  const fixed = wildcard === -1 ? target : target.slice(0, wildcard);
  if (fixed.split(/[\\/]/).includes('..')) return 'outside';
  return fixed.trim().length === 0 ? 'inside' : resolveToolPath(fixed, scope).pathClass;
}
