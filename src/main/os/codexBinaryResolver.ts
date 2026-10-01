import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { firstExistingPath } from './agentBinaryResolver';

// Localizacion del binario `codex` (CLI de OpenAI). Tercer resolutor, mismo patron que los de Claude y
// `agy`: TODA la diferencia de SO queda encapsulada aqui y ningun otro modulo conoce rutas de Codex.
//
// Hace falta poder responder "no esta instalado" (null, no una excepcion): desde el 2026-09-18 la
// seccion de Proveedores SOLO lista lo que de verdad se puede usar, y eso se decide con esta respuesta.

export interface CodexResolverDeps {
  readonly platform: NodeJS.Platform;
  readonly homedir: string;
  readonly fileExists: (path: string) => boolean;
  // ¿El comando esta en el PATH? (`where`/`which`). Separado de fileExists a proposito: son dos
  // preguntas distintas y en los tests se responden por separado.
  readonly commandInPath: (bin: string) => boolean;
  readonly binOverride?: string | undefined; // MAGE_CODEX_BIN
  readonly localAppData?: string | undefined; // %LOCALAPPDATA% (Windows; puede estar redirigido)
}

// Ruta MEDIDA en la maquina del usuario el 2026-09-18 (`where codex` ->
// C:\Users\<user>\AppData\Local\Programs\OpenAI\Codex\bin\codex.exe), con codex-cli 0.144.4.
// En POSIX el instalador deja el comando en el PATH: no se inventa ningun candidato.
const WINDOWS_LOCAL_APPDATA_PARTS = ['Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'];
const WINDOWS_HOME_PARTS = ['AppData', 'Local', ...WINDOWS_LOCAL_APPDATA_PARTS];

// Nombre del comando tal y como se invoca (y como lo busca `where`/`which`).
export function codexCommandName(osPlatform: NodeJS.Platform): string {
  return osPlatform === 'win32' ? 'codex.exe' : 'codex';
}

// Ruta con la que spawnear `codex`, o null si no se encontro NI en los candidatos NI en el PATH.
// Prioridad: override explicito -> candidato por SO -> nombre del comando si esta en el PATH.
export function findCodexBinary(deps: CodexResolverDeps = defaultCodexDeps()): string | null {
  if (deps.binOverride !== undefined && deps.binOverride.length > 0) return deps.binOverride;

  const found = firstExistingPath(platformCandidates(deps), deps.fileExists);
  if (found !== null) return found;

  const command = codexCommandName(deps.platform);
  return deps.commandInPath(command) ? command : null;
}

// Para lanzar una sesion: la ruta, o un Error que dice como arreglarlo.
export function resolveCodexBinary(deps: CodexResolverDeps = defaultCodexDeps()): string {
  const found = findCodexBinary(deps);
  if (found !== null) return found;
  throw new Error(
    `No se encontro el CLI de Codex (${codexCommandName(deps.platform)}) ni en las rutas de instalacion ni en el PATH. ` +
      'Instalalo, o fija MAGE_CODEX_BIN con su ruta.',
  );
}

// Candidatos de instalacion por SO. Windows: %LOCALAPPDATA%\Programs\OpenAI\Codex\bin (y su
// equivalente bajo HOME, por si la variable no esta definida en el entorno del proceso).
function platformCandidates(deps: CodexResolverDeps): readonly string[] {
  if (deps.platform !== 'win32') return [];
  const candidates: string[] = [];
  if (deps.localAppData !== undefined && deps.localAppData.length > 0) {
    candidates.push(join(deps.localAppData, ...WINDOWS_LOCAL_APPDATA_PARTS));
  }
  candidates.push(join(deps.homedir, ...WINDOWS_HOME_PARTS));
  return candidates;
}

function defaultCodexDeps(): CodexResolverDeps {
  return {
    platform: platform(),
    homedir: homedir(),
    fileExists: existsSync,
    commandInPath: isCommandInPath,
    binOverride: process.env.MAGE_CODEX_BIN,
    localAppData: process.env.LOCALAPPDATA,
  };
}

// `where`/`which` con timeout, igual que los otros dos resolutores. Un fallo del buscador se traduce a
// "no esta", que es la respuesta correcta para el llamante.
function isCommandInPath(bin: string): boolean {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(finder, [bin], { stdio: 'ignore', windowsHide: true, timeout: 5_000 });
  return result.status === 0;
}
