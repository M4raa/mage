import { existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { win32 } from 'node:path';
import { localized, UserFacingError } from '@shared/i18n/localizedText';
import type { LogFn } from '../debug/logBus';
import { firstExistingPath } from './agentBinaryResolver';
import { isCommandOnPath } from './commandOnPath';

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
  throw new UserFacingError(localized('errors.os.codexNotFound', { command: codexCommandName(deps.platform) }));
}

// Cómo lanzar `codex <args>`: el comando, sus argumentos y lo que hay que AÑADIR al entorno ya saneado.
export interface CodexSpawnCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface CodexSpawnDeps {
  readonly isPackaged: boolean; // app.isPackaged
  readonly execPath: string; // process.execPath: el binario de Electron
  readonly log: LogFn;
  readonly resolver?: CodexResolverDeps; // por defecto, el entorno real
}

// Un MAGE_CODEX_BIN con estas extensiones es un script de Node (el app-server falso de verify:gui).
const NODE_SCRIPT_EXTENSIONS: readonly string[] = ['.mjs', '.js'];

// Con la app SIN empaquetar, un MAGE_CODEX_BIN que es un script de Node se lanza con el Node de Electron
// (`ELECTRON_RUN_AS_NODE`): así verify:gui pone un app-server falso. Con la app EMPAQUETADA se ignora con aviso y se usa
// el resolvedor normal: una variable de entorno nunca hace que el Mage instalado ejecute un script.
export function codexSpawnCommand(args: readonly string[], deps: CodexSpawnDeps): CodexSpawnCommand {
  const resolver = deps.resolver ?? defaultCodexDeps();
  const override = resolver.binOverride ?? '';
  if (!isNodeScript(override)) return { command: resolveCodexBinary(resolver), args, env: {} };
  if (deps.isPackaged) {
    deps.log('warn', 'MAGE_CODEX_BIN apunta a un script y la app esta empaquetada: se ignora', { binOverride: override });
    return { command: resolveCodexBinary({ ...resolver, binOverride: undefined }), args, env: {} };
  }
  return { command: deps.execPath, args: [override, ...args], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function isNodeScript(path: string): boolean {
  const lower = path.toLowerCase();
  return NODE_SCRIPT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

// Candidatos de instalacion por SO. Windows: %LOCALAPPDATA%\Programs\OpenAI\Codex\bin (y su
// equivalente bajo HOME, por si la variable no esta definida en el entorno del proceso).
function platformCandidates(deps: CodexResolverDeps): readonly string[] {
  if (deps.platform !== 'win32') return [];
  const candidates: string[] = [];
  if (deps.localAppData !== undefined && deps.localAppData.length > 0) {
    candidates.push(win32.join(deps.localAppData, ...WINDOWS_LOCAL_APPDATA_PARTS));
  }
  candidates.push(win32.join(deps.homedir, ...WINDOWS_HOME_PARTS));
  return candidates;
}

function defaultCodexDeps(): CodexResolverDeps {
  return {
    platform: platform(),
    homedir: homedir(),
    fileExists: existsSync,
    commandInPath: isCommandOnPath,
    binOverride: process.env.MAGE_CODEX_BIN,
    localAppData: process.env.LOCALAPPDATA,
  };
}
