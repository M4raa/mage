// Qué ficheros locales puede abrir el navegador de Mage (P-040): solo los de la carpeta de trabajo de la conversación.
// Como página, solo .html/.htm; como subrecurso (css, js, imágenes…), cualquiera de dentro. Sin Electron.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FileAccessDeps {
  /** `fs.realpathSync.native`: resuelve enlaces, junctions y nombres 8.3 (medido: el temporal sale como DMARAT~1). Lanza si no existe. */
  readonly realpath: (target: string) => string;
}

export interface FileAccess {
  /** La raíz tal como llegó (para los mensajes). */
  readonly root: string;
  /** Ruta real del fichero si está dentro de la raíz; null si está fuera, no existe o la URL no es de fichero. */
  resolve(fileUrl: string): string | null;
  /** Si la URL puede abrirse como página: dentro de la raíz y .html/.htm. */
  allowsPage(fileUrl: string): boolean;
}

const PAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.html', '.htm']);

function realOrNull(deps: FileAccessDeps, target: string): string | null {
  try {
    return deps.realpath(target);
  } catch {
    // No existe o no se puede leer: para el navegador es lo mismo que estar fuera (se deniega).
    return null;
  }
}

function filePathOf(fileUrl: string): string | null {
  if (!URL.canParse(fileUrl) || new URL(fileUrl).protocol !== 'file:') return null;
  try {
    return fileURLToPath(fileUrl);
  } catch {
    // `file://host/…` en POSIX: no es un fichero local.
    return null;
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  // Por segmento, no por prefijo: «..notas.html» es un fichero de dentro.
  return !path.isAbsolute(relative) && relative.split(path.sep)[0] !== '..';
}

/** null si la conversación no tiene carpeta (o no existe): entonces no se abre ningún fichero. */
export function createFileAccess(root: string | null, deps: FileAccessDeps): FileAccess | null {
  if (root === null || root.trim().length === 0) return null;
  const realRoot = realOrNull(deps, root);
  if (realRoot === null) return null;
  const resolve = (fileUrl: string): string | null => {
    const filePath = filePathOf(fileUrl);
    const real = filePath === null ? null : realOrNull(deps, filePath);
    return real !== null && isInside(realRoot, real) ? real : null;
  };
  return {
    root,
    resolve,
    allowsPage: (fileUrl) => {
      const real = resolve(fileUrl);
      return real !== null && PAGE_EXTENSIONS.has(path.extname(real).toLowerCase());
    },
  };
}
