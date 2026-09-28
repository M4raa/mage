import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { firstExistingPath } from './agentBinaryResolver';

// Localizacion del binario `git` (P-026 3.5). Mismo patron que `codexBinaryResolver`: TODA la
// diferencia de SO queda aqui, y `null` (no una excepcion) cuando no hay git, que es lo que decide que
// la fila del chat no enseñe nada de git.

export interface GitResolverDeps {
  readonly platform: NodeJS.Platform;
  readonly fileExists: (path: string) => boolean;
  readonly commandInPath: (bin: string) => boolean;
  readonly binOverride?: string | undefined; // MAGE_GIT_BIN
  readonly programFiles?: string | undefined; // %ProgramFiles% (Windows)
}

// Git for Windows deja su lanzador en `<ProgramFiles>\Git\cmd\git.exe`; en POSIX va en el PATH.
const WINDOWS_PROGRAM_FILES_PARTS = ['Git', 'cmd', 'git.exe'];

export function gitCommandName(osPlatform: NodeJS.Platform): string {
  return osPlatform === 'win32' ? 'git.exe' : 'git';
}

// Prioridad: override explicito -> candidato por SO -> nombre del comando si esta en el PATH -> null.
export function findGitBinary(deps: GitResolverDeps = defaultGitDeps()): string | null {
  if (deps.binOverride !== undefined && deps.binOverride.length > 0) return deps.binOverride;
  const found = firstExistingPath(platformCandidates(deps), deps.fileExists);
  if (found !== null) return found;
  const command = gitCommandName(deps.platform);
  return deps.commandInPath(command) ? command : null;
}

function platformCandidates(deps: GitResolverDeps): readonly string[] {
  if (deps.platform !== 'win32' || deps.programFiles === undefined || deps.programFiles.length === 0) return [];
  return [join(deps.programFiles, ...WINDOWS_PROGRAM_FILES_PARTS)];
}

function defaultGitDeps(): GitResolverDeps {
  return {
    platform: platform(),
    fileExists: existsSync,
    commandInPath: isCommandInPath,
    binOverride: process.env.MAGE_GIT_BIN,
    programFiles: process.env.ProgramFiles,
  };
}

const FINDER_TIMEOUT_MS = 5_000;

// `where`/`which` con timeout, como los otros resolutores: un fallo del buscador es «no esta».
function isCommandInPath(bin: string): boolean {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(finder, [bin], { stdio: 'ignore', windowsHide: true, timeout: FINDER_TIMEOUT_MS });
  return result.status === 0;
}
