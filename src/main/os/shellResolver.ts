import { posix, win32 } from 'node:path';
import { RUNTIME_SHELLS, type RuntimeShell } from '@shared/settings';

// Que shell ejecuta la herramienta `Bash` del runtime propio (ficha D4, cerrada en §8.1 de P-032): por
// defecto Git Bash si existe y si no PowerShell, configurable en Ajustes. Toda la diferencia de SO vive
// aqui, junto a los otros resolutores. Los modelos escriben bash mucho mejor que PowerShell; el prompt
// de sistema dice cual es (`name`) para que no mezclen.

export type ShellPreference = RuntimeShell;

export interface ResolvedShell {
  readonly name: string; // literal para el prompt: «Git Bash», «PowerShell», «bash»…
  readonly command: string;
  readonly argsFor: (commandLine: string) => readonly string[];
}

export interface ShellResolverDeps {
  readonly platform: NodeJS.Platform;
  readonly preference: ShellPreference;
  readonly fileExists: (path: string) => boolean;
  readonly commandInPath: (bin: string) => boolean;
  readonly programFiles: string | undefined; // %ProgramFiles%
  readonly gitBinary: string | null; // git.exe ya resuelto (gitBinaryResolver)
  readonly envShell: string | undefined; // $SHELL
}

const POSIX_SHELLS = new Set(['bash', 'zsh', 'sh', 'dash', 'ksh']);
const bashArgs = (commandLine: string) => ['-c', commandLine];
const powershellArgs = (commandLine: string) => ['-NoProfile', '-NonInteractive', '-Command', commandLine];

export function resolveShell(deps: ShellResolverDeps): ResolvedShell {
  if (deps.platform === 'win32') return resolveWindows(deps);
  if (deps.preference === 'powershell' && deps.commandInPath('pwsh')) return { name: 'PowerShell', command: 'pwsh', argsFor: powershellArgs };
  const shell = deps.envShell !== undefined && POSIX_SHELLS.has(posix.basename(deps.envShell)) ? deps.envShell : '/bin/sh';
  return { name: posix.basename(shell), command: shell, argsFor: bashArgs };
}

function resolveWindows(deps: ShellResolverDeps): ResolvedShell {
  const gitBash = deps.preference === 'powershell' ? null : findGitBash(deps);
  if (gitBash !== null) return { name: 'Git Bash', command: gitBash, argsFor: bashArgs };
  if (deps.commandInPath('pwsh.exe')) return { name: 'PowerShell', command: 'pwsh.exe', argsFor: powershellArgs };
  return { name: 'Windows PowerShell', command: 'powershell.exe', argsFor: powershellArgs };
}

// `bash.exe` de Git for Windows: junto al git que ya se resolvio (`<Git>\cmd\git.exe` -> `<Git>\bin`) o
// en su sitio de instalacion por defecto.
function findGitBash(deps: ShellResolverDeps): string | null {
  const candidates: string[] = [];
  if (deps.gitBinary !== null && deps.gitBinary.toLowerCase().endsWith('git.exe')) {
    candidates.push(win32.join(win32.dirname(win32.dirname(deps.gitBinary)), 'bin', 'bash.exe'));
  }
  if (deps.programFiles !== undefined && deps.programFiles.length > 0) candidates.push(win32.join(deps.programFiles, 'Git', 'bin', 'bash.exe'));
  return candidates.find((path) => deps.fileExists(path)) ?? null;
}

export function isShellPreference(value: unknown): value is ShellPreference {
  return typeof value === 'string' && (RUNTIME_SHELLS as readonly string[]).includes(value);
}
