import { spawnSync } from 'node:child_process';
import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

// ¿Está este comando en el PATH? Un solo sitio para todo main (editores, shells, CLI de agentes, gh, git, el llavero).
// En POSIX se recorre el PATH a mano: `which` no viene en todas las distribuciones (Arch no lo trae, medido en F2.7) y
// sin él todo salía «no está», incluida la detección de los CLI (H2 de la devolución 17). En Windows se usa `where`,
// que ya resuelve PATHEXT (`code` → `code.cmd`).

const WHERE_TIMEOUT_MS = 5_000;

export interface PathLookupDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  // ¿Existe y es ejecutable?
  readonly isExecutableFile: (path: string) => boolean;
}

export function isOnPath(bin: string, deps: PathLookupDeps): boolean {
  const dirs = (deps.env['PATH'] ?? '').split(delimiter).filter((dir) => dir.length > 0);
  return dirs.some((dir) => deps.isExecutableFile(join(dir, bin)));
}

// Comprobación real de «existe y es ejecutable». Solo «no existe» o «sin permiso» significan que no; cualquier otro
// error se propaga.
const ABSENT_CODES: readonly string[] = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'];
export interface ExecutableFs {
  readonly accessSync: (path: string, mode: number) => void;
  readonly statSync: (path: string) => { isFile(): boolean };
  readonly executableMode: number;
}

export function executableFileCheck(fs: ExecutableFs): (path: string) => boolean {
  return (path) => {
    try {
      fs.accessSync(path, fs.executableMode);
      return fs.statSync(path).isFile();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== undefined && ABSENT_CODES.includes(code)) return false;
      throw err;
    }
  };
}

export interface CommandLookupDeps extends PathLookupDeps {
  readonly platform: NodeJS.Platform;
  // `where <bin>` en Windows: true si lo encuentra.
  readonly where: (bin: string) => boolean;
}

export function commandOnPathCheck(deps: CommandLookupDeps): (bin: string) => boolean {
  return (bin) => {
    if (bin.length === 0) throw new Error('Comando vacío: no se puede buscar en el PATH');
    if (deps.platform === 'win32') return deps.where(bin);
    // Con barra es una ruta, no un nombre que buscar (como hace `which`).
    if (bin.includes('/')) return deps.isExecutableFile(bin);
    return isOnPath(bin, deps);
  };
}

export const isExecutableFile = executableFileCheck({ accessSync, statSync, executableMode: fsConstants.X_OK });

// La de verdad, con el PATH y el sistema de ficheros de este proceso. Síncrona y rápida: se consulta en acciones
// puntuales (listar editores, resolver un binario), no en caliente.
export const isCommandOnPath = commandOnPathCheck({
  platform: process.platform,
  env: process.env,
  isExecutableFile,
  where: (bin) => spawnSync('where', [bin], { stdio: 'ignore', windowsHide: true, timeout: WHERE_TIMEOUT_MS }).status === 0,
});
