import type { PreparedCall, ToolKind } from './agentLoop';
import type { GateVerdict, RuntimePermissionMode } from './runtimeSession';
import { resolveToolPath, type PathClass, type PathScope } from './tools/pathGuard';

// Que hace el runtime propio con una llamada antes de ejecutarla: permitir, preguntar o denegar.
// PURO. Tabla de P-032 §4.6 con los cinco modos que pidio el usuario (§8.1 D9):
//
// | modo              | read  | edit  | exec                                         |
// | plan              | allow | deny  | deny                                         |
// | default (Manual)  | allow | ask   | ask                                          |
// | acceptEdits       | allow | allow | ask                                          |
// | auto              | allow | allow | allow, salvo red o rutas fuera -> ask         |
// | bypassPermissions | allow | allow | allow                                        |
//
// Encima de la tabla: una ruta FUERA del cwd (y de los directorios añadidos) pregunta SIEMPRE, en
// todos los modos, tambien en bypassPermissions.
//
// `auto` imita el preset «Auto» de Codex (escribir y ejecutar dentro del workspace sin preguntar;
// preguntar fuera y para red). Codex lo apoya en un sandbox del SO y el runtime NO tiene ninguno, asi
// que aqui es una HEURISTICA sobre el texto del comando.
// ponytail: heuristica de texto, no sandbox. Un comando ofuscado (variables, scripts que hacen red)
// pasa sin preguntar. Techo conocido y escrito en el aviso del modo; se sube con un sandbox real
// (AppContainer en Windows, seatbelt/landlock en macOS/Linux) si el modo Auto se usa en serio.

export interface GateInput {
  readonly mode: RuntimePermissionMode;
  readonly kind: ToolKind;
  // null = la herramienta no toca una ruta concreta (Bash, MCP).
  readonly pathClass: PathClass | null;
  // Texto del comando de `Bash`; null en el resto. Un `exec` sin comando (MCP) es opaco.
  readonly command: string | null;
  readonly scope: PathScope;
}

const PLAN_DENY_REASON = 'modo Plan: solo lectura';

const NETWORK_COMMAND = new RegExp(
  [
    String.raw`\b(curl|wget|ssh|scp|sftp|rsync|ftp|telnet|ncat|nc|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|Start-BitsTransfer)\b`,
    String.raw`\bgit\s+(push|pull|fetch|clone|ls-remote|submodule\s+update)\b`,
    String.raw`\b(npm|pnpm|yarn|bun)\s+(install|i|add|update|up|upgrade|publish|dlx|create)\b`,
    String.raw`\b(npx|pnpx|bunx|uvx)\b`,
    String.raw`\b(pip3?|uv|pipx|poetry)\s+(install|add|sync|download)\b`,
    String.raw`\b(cargo|go)\s+(install|add|get|update|fetch)\b`,
    String.raw`\bdocker\s+(pull|push|run|login)\b`,
    String.raw`\b(apt|apt-get|brew|winget|choco|scoop|gh)\s`,
  ].join('|'),
  'i',
);

export function decidePermission(input: GateInput): GateVerdict {
  if (input.pathClass === 'outside') {
    return input.mode === 'plan' && input.kind !== 'read' ? { verdict: 'deny', reason: PLAN_DENY_REASON } : { verdict: 'ask' };
  }
  if (input.kind === 'read') return { verdict: 'allow' };
  switch (input.mode) {
    case 'plan':
      return { verdict: 'deny', reason: PLAN_DENY_REASON };
    case 'default':
      return { verdict: 'ask' };
    case 'acceptEdits':
      return input.kind === 'edit' ? { verdict: 'allow' } : { verdict: 'ask' };
    case 'auto':
      return input.kind === 'edit' || isContainedCommand(input.command, input.scope) ? { verdict: 'allow' } : { verdict: 'ask' };
    case 'bypassPermissions':
      return { verdict: 'allow' };
  }
}

// ¿Se puede ejecutar este comando sin preguntar en Auto? Solo si es un comando de texto conocido, no
// parece hacer red y no nombra rutas fuera del workspace.
export function isContainedCommand(command: string | null, scope: PathScope): boolean {
  if (command === null) return false;
  if (NETWORK_COMMAND.test(command)) return false;
  return !pathTokens(command).some((token) => token.startsWith('~') || resolveToolPath(token, scope).pathClass === 'outside');
}

// Trozos del comando que parecen rutas: llevan separador, empiezan por `~` o son `..`.
function pathTokens(command: string): string[] {
  return command
    .split(/[\s'"`;|&<>()=]+/)
    .filter((token) => token.length > 0 && !/^[a-z][a-z0-9+.-]*:\/\//i.test(token))
    .filter((token) => token.includes('/') || token.includes('\\') || token.startsWith('~') || token === '..');
}

// La puerta de UNA sesion: saca de la llamada la ruta (file_path/path) y el comando, y decide.
export function createRuntimeGate(scope: PathScope): (call: PreparedCall, mode: RuntimePermissionMode) => GateVerdict {
  return (call, mode) => {
    const target = pathOf(call.input);
    const pathClass = target === null ? null : resolveToolPath(target, scope).pathClass;
    const command = typeof call.input.command === 'string' && call.name === 'Bash' ? call.input.command : null;
    return decidePermission({ mode, kind: call.kind, pathClass, command, scope });
  };
}

function pathOf(input: Readonly<Record<string, unknown>>): string | null {
  const value = input.file_path ?? input.path;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}
