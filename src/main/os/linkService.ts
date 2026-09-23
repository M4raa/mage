import { existsSync, lstatSync, mkdirSync, realpathSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { platform as osPlatform } from 'node:os';
import { pathEquals } from './pathUtils';

// Clasificacion de una carpeta compartida: enlace (symlink/junction), dir privado real, o ausente.
export type LinkKind = 'link' | 'private' | 'missing';

// Info minima de lstat que necesita el servicio (facilita el mock en tests).
export interface LinkStat {
  isSymbolicLink(): boolean;
  isDirectory(): boolean;
}

// Log inyectado: subconjunto de LogFn (debug/logBus) para no acoplar este servicio al LogBus. Su
// razon de ser es que una divergencia de enlaces NUNCA sea silenciosa (ver createDirLink).
export type LinkLogFn = (level: 'warn' | 'error', message: string) => void;

// Dependencias inyectables -> testable sin tocar el FS/SO real.
export interface LinkDeps {
  readonly platform: NodeJS.Platform;
  readonly symlink: (target: string, link: string, type: 'junction' | 'dir') => void;
  readonly lstat: (path: string) => LinkStat;
  readonly realpath: (path: string) => string;
  readonly exists: (path: string) => boolean;
  readonly mkdir: (path: string) => void;
  readonly unlink: (path: string) => void; // borra un symlink (POSIX)
  readonly rmdir: (path: string) => void; // borra un junction/dir vacio (Windows) SIN recursar al target
  readonly log: LinkLogFn;
}

// Encapsula la diferencia de SO para enlaces de directorio: junction en Windows (NO requiere admin),
// symlink 'dir' en POSIX. Ningun otro modulo conoce esta diferencia (invariante multiplataforma).
export class LinkService {
  constructor(private readonly deps: LinkDeps) {}

  // Crea un enlace de directorio link -> target. Crea `target` si falta. Idempotente. Devuelve el
  // estado en que queda `link` para que el llamador pueda decidir.
  //
  // CRITICO: clasifica con classifyLink, NO con `exists`. `existsSync` SIGUE el enlace, asi que
  // devuelve true tanto para un junction vivo como para el directorio REAL que lo reemplazo — y una
  // sesion del CLI en marcha convierte estos enlaces en directorios reales (fallo observado y
  // reproducible). Con `exists` ese estado no se detectaba NUNCA y la carpeta dejaba de compartirse
  // en silencio para siempre.
  //
  // Ante un dir real NO se converge automaticamente (mover contenido bajo una sesion viva que esta
  // escribiendo ahi es peor que la divergencia): se hace OBSERVABLE con las dos rutas y se devuelve
  // el veredicto. La convergencia es una decision explicita del llamador o del usuario.
  createDirLink(target: string, link: string): LinkKind {
    if (target.length === 0 || link.length === 0) {
      throw new Error(`Enlace invalido: target="${target}" link="${link}"`);
    }
    if (!this.deps.exists(target)) this.deps.mkdir(target);

    const kind = this.classifyLink(link);
    if (kind === 'link') {
      this.warnIfWrongTarget(target, link);
      return 'link';
    }
    if (kind === 'private') {
      this.deps.log(
        'warn',
        `Carpeta compartida divergida: "${link}" es un directorio real, no un enlace a "${target}". ` +
          'Deja de compartirse hasta que se converja (posible causa: una sesion del CLI la recreo).',
      );
      return 'private';
    }
    // 'missing' cubre dos cosas: ausente de verdad, o presente pero NO directorio (classifyLink solo
    // reconoce dirs). Un fichero donde deberia ir la carpeta compartida es un estado corrupto: se
    // lanza con la ruta en vez de dejar que el symlink falle con un EEXIST sin contexto.
    if (this.deps.exists(link)) {
      throw new Error(`La ruta del enlace existe y no es un directorio: "${link}" (target "${target}")`);
    }
    const type = this.deps.platform === 'win32' ? 'junction' : 'dir';
    this.deps.symlink(target, link, type);
    return 'link';
  }

  // Borra un enlace de directorio SIN seguir al target: symlink -> unlink; junction (dir en Windows)
  // -> rmdir (quita solo el enlace, no el contenido compartido). Idempotente: si no existe, no hace
  // nada. CRITICO en dos sentidos: (1) no borrar por error los datos compartidos (projects/sessions/
  // ...); (2) si la carpeta NO es un enlace sino un directorio PRIVADO real (el junction nunca se creo
  // o fue reemplazado por datos propios de la cuenta), NO tocarla: un `rmdir` sobre un dir poblado da
  // ENOTEMPTY. Se deja para que el borrado recursivo de la cuenta (rmrf) la elimine con lo demas.
  removeDirLink(link: string): void {
    if (this.classifyLink(link) !== 'link') return; // 'missing' o 'private': no es un enlace, no tocar
    let stat: LinkStat;
    try {
      stat = this.deps.lstat(link);
    } catch {
      return; // desaparecio entre la clasificacion y ahora: nada que borrar
    }
    if (stat.isSymbolicLink()) {
      this.deps.unlink(link); // symlink POSIX
      return;
    }
    // Junction de Windows (aparece como directorio, pero classifyLink ya confirmo que es un enlace):
    // rmdir elimina el reparse-point sin recursar al target compartido.
    this.deps.rmdir(link);
  }

  // Un enlace VIVO puede apuntar al sitio equivocado (p.ej. quedo de una version anterior del
  // layout): classifyLink lo daria por bueno. Misma clase de fallo que el dir real, asi que tampoco
  // puede ser silencioso. No se re-enlaza aqui: solo se reporta con las dos rutas.
  private warnIfWrongTarget(target: string, link: string): void {
    let resolvedLink: string;
    let resolvedTarget: string;
    try {
      resolvedLink = this.deps.realpath(link);
      resolvedTarget = this.deps.realpath(target);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.deps.log('warn', `No se pudo verificar el destino del enlace "${link}" -> "${target}": ${detail}`);
      return;
    }
    if (pathEquals(resolvedLink, resolvedTarget)) return;
    this.deps.log(
      'warn',
      `Enlace compartido apuntando al sitio equivocado: "${link}" resuelve a "${resolvedLink}" ` +
        `en vez de "${resolvedTarget}".`,
    );
  }

  // Clasifica una ruta: symlink/junction -> 'link'; dir real -> 'private'; ausente -> 'missing'.
  classifyLink(path: string): LinkKind {
    let stat: LinkStat;
    try {
      stat = this.deps.lstat(path);
    } catch {
      return 'missing';
    }
    if (stat.isSymbolicLink()) return 'link';
    if (!stat.isDirectory()) return 'missing';
    // Un junction de Windows aparece como directorio; se detecta por realpath distinto de la ruta.
    try {
      return pathEquals(this.deps.realpath(path), path) ? 'private' : 'link';
    } catch {
      return 'private';
    }
  }
}

// Deps con el FS/SO real. El log se INYECTA (no hay default silencioso): el llamador decide por
// donde sale una divergencia — en la app, el LogBus.
export function defaultLinkDeps(log: LinkLogFn): LinkDeps {
  return {
    log,
    platform: osPlatform(),
    symlink: (target, link, type) => symlinkSync(target, link, type),
    lstat: (path) => lstatSync(path),
    realpath: (path) => realpathSync(path),
    exists: existsSync,
    mkdir: (path) => mkdirSync(path, { recursive: true }),
    unlink: (path) => unlinkSync(path),
    rmdir: (path) => rmdirSync(path),
  };
}
