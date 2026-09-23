import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { firstExistingPath } from './agentBinaryResolver';

// Localizacion del binario `agy` (CLI de Antigravity, E3). Mismo patron que claudeBinaryResolver:
// TODA la diferencia de SO queda encapsulada aqui y ningun otro modulo conoce rutas de `agy`.
// Diferencia con el de Claude: `agy` no tiene shims .cmd y su instalador (`agy install`) configura el
// PATH, asi que el PATH es una fuente legitima —no un ultimo recurso— y hace falta poder responder
// "no esta instalado" (la UI no debe ofrecer un proveedor que no puede funcionar).

// Dependencias inyectables -> testable sin tocar el FS/SO real.
export interface AgyResolverDeps {
  readonly platform: NodeJS.Platform;
  readonly homedir: string;
  readonly fileExists: (path: string) => boolean;
  // ¿El comando esta en el PATH? (`where`/`which`). Separado de fileExists a proposito: son dos
  // preguntas distintas y en los tests se responden por separado.
  readonly commandInPath: (bin: string) => boolean;
  readonly binOverride?: string | undefined; // MAGE_AGY_BIN
  readonly localAppData?: string | undefined; // %LOCALAPPDATA% (Windows; puede estar redirigido)
}

// Ruta MEDIDA en la maquina del usuario el 2026-08-11 (`where agy` ->
// C:\Users\<user>\AppData\Local\agy\bin\agy.exe). En POSIX no hay candidato medido: no se inventa
// ninguno, se resuelve por PATH (que es lo que configura `agy install`).
const WINDOWS_LOCAL_APPDATA_PARTS = ['agy', 'bin', 'agy.exe'];
const WINDOWS_HOME_PARTS = ['AppData', 'Local', ...WINDOWS_LOCAL_APPDATA_PARTS];

// Nombre del comando tal y como se invoca (y como lo busca `where`/`which`).
export function agyCommandName(osPlatform: NodeJS.Platform): string {
  return osPlatform === 'win32' ? 'agy.exe' : 'agy';
}

// Ruta con la que spawnear `agy`, o null si no se encontro NI en los candidatos NI en el PATH.
// Prioridad: override explicito -> candidato por SO -> nombre del comando si esta en el PATH.
export function findAgyBinary(deps: AgyResolverDeps = defaultAgyDeps()): string | null {
  if (deps.binOverride !== undefined && deps.binOverride.length > 0) return deps.binOverride;

  const found = firstExistingPath(platformCandidates(deps), deps.fileExists);
  if (found !== null) return found;

  const command = agyCommandName(deps.platform);
  return deps.commandInPath(command) ? command : null;
}

// Igual que findAgyBinary pero LANZA con el motivo. Lo usa el adapter al construir el plan de spawn:
// sin binario no hay plan posible, y un `spawn ENOENT` a secas no explica que hay que instalar `agy`.
export function resolveAgyBinary(deps: AgyResolverDeps = defaultAgyDeps()): string {
  const found = findAgyBinary(deps);
  if (found !== null) return found;
  throw new Error(
    `No se encontro el CLI de Antigravity (${agyCommandName(deps.platform)}) ni en las rutas de ` +
      `instalacion ni en el PATH. Instalalo y ejecuta \`agy install\`, o fija MAGE_AGY_BIN con su ruta.`,
  );
}

// Candidatos de instalacion por SO. Windows: %LOCALAPPDATA%\agy\bin (y su equivalente bajo HOME, por
// si la variable no esta definida en el entorno del proceso). POSIX: ninguno medido.
function platformCandidates(deps: AgyResolverDeps): readonly string[] {
  if (deps.platform !== 'win32') return [];
  const candidates: string[] = [];
  if (deps.localAppData !== undefined && deps.localAppData.length > 0) {
    candidates.push(join(deps.localAppData, ...WINDOWS_LOCAL_APPDATA_PARTS));
  }
  candidates.push(join(deps.homedir, ...WINDOWS_HOME_PARTS));
  return candidates;
}

function defaultAgyDeps(): AgyResolverDeps {
  return {
    platform: platform(),
    homedir: homedir(),
    fileExists: existsSync,
    commandInPath: isCommandInPath,
    binOverride: process.env.MAGE_AGY_BIN,
    localAppData: process.env.LOCALAPPDATA,
  };
}

// `where`/`which` con timeout: es la misma tecnica que ya usa la deteccion de editores. Un fallo del
// buscador se traduce a "no esta", que es la respuesta correcta para el llamante.
function isCommandInPath(bin: string): boolean {
  const finder = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(finder, [bin], { stdio: 'ignore', windowsHide: true, timeout: 5_000 });
  return result.status === 0;
}
