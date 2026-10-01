import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { firstExistingPath } from './agentBinaryResolver';

// Localizacion del binario `gh` (GitHub CLI). Mismo patron que `codexBinaryResolver`: TODA la diferencia
// de SO queda aqui, y `null` (no una excepcion) cuando no esta, que es lo que decide el aviso «instala gh».
//
// MEDIDO el 2026-09-30 con gh 2.102.0: el instalador deja `<ProgramFiles>\GitHub CLI\gh.exe`, y un proceso
// que ya estaba abierto NO lo ve en su PATH (Electron hereda el del arranque). Por eso la ruta de Program
// Files va antes que el PATH: sin ella, quien instala gh con Mage abierta no lo veria hasta reiniciar.

export interface GhResolverDeps {
  readonly platform: NodeJS.Platform;
  readonly fileExists: (path: string) => boolean;
  readonly commandInPath: (bin: string) => boolean;
  readonly binOverride?: string | undefined; // MAGE_GH_BIN
  readonly programFiles?: string | undefined; // %ProgramFiles% (Windows)
  readonly localAppData?: string | undefined; // %LOCALAPPDATA% (instalacion por usuario)
}

const WINDOWS_PROGRAM_FILES_PARTS = ['GitHub CLI', 'gh.exe'];
const WINDOWS_LOCAL_APPDATA_PARTS = ['Programs', 'GitHub CLI', 'gh.exe'];

export function ghCommandName(osPlatform: NodeJS.Platform): string {
  return osPlatform === 'win32' ? 'gh.exe' : 'gh';
}

// Prioridad: override explicito -> candidatos por SO -> nombre del comando si esta en el PATH -> null.
export function findGhBinary(deps: GhResolverDeps = defaultGhDeps()): string | null {
  if (deps.binOverride !== undefined && deps.binOverride.length > 0) return deps.binOverride;
  const found = firstExistingPath(platformCandidates(deps), deps.fileExists);
  if (found !== null) return found;
  const command = ghCommandName(deps.platform);
  return deps.commandInPath(command) ? command : null;
}

function platformCandidates(deps: GhResolverDeps): readonly string[] {
  if (deps.platform !== 'win32') return [];
  const candidates: string[] = [];
  if (deps.programFiles !== undefined && deps.programFiles.length > 0) candidates.push(join(deps.programFiles, ...WINDOWS_PROGRAM_FILES_PARTS));
  if (deps.localAppData !== undefined && deps.localAppData.length > 0) candidates.push(join(deps.localAppData, ...WINDOWS_LOCAL_APPDATA_PARTS));
  return candidates;
}

function defaultGhDeps(): GhResolverDeps {
  return {
    platform: platform(),
    fileExists: existsSync,
    commandInPath: isCommandInPath,
    binOverride: process.env.MAGE_GH_BIN,
    programFiles: process.env.ProgramFiles,
    localAppData: process.env.LOCALAPPDATA,
  };
}

const FINDER_TIMEOUT_MS = 5_000;

// `where`/`which` con timeout, como los otros resolutores: un fallo del buscador es «no esta».
function isCommandInPath(bin: string): boolean {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(finder, [bin], { stdio: 'ignore', windowsHide: true, timeout: FINDER_TIMEOUT_MS });
  return result.status === 0;
}
