import { realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';

// Resuelve una ruta que manda el modelo contra el cwd y decide si cae dentro del cwd (o de un
// directorio añadido) o fuera. El modulo de rutas se elige por plataforma, asi se prueba win32 desde
// cualquier SO. En win32 se compara sin distinguir mayusculas (el FS tampoco lo hace).
//
// Con `realpath` (A3 de la revision), la clasificacion sigue enlaces simbolicos y junctions: un
// `proj/h -> ~` deja de contar como dentro. Sin ella es puramente lexica (tests).

export type PathClass = 'inside' | 'outside';

export interface PathScope {
  readonly cwd: string;
  readonly extraDirs: readonly string[];
  readonly platform: string;
  // Ruta real de algo que existe; null si no existe. Ausente = clasificacion lexica.
  readonly realpath?: (path: string) => string | null;
}

export interface ResolvedPath {
  readonly absolute: string;
  readonly pathClass: PathClass;
}

export function resolveToolPath(target: string, scope: PathScope): ResolvedPath {
  if (target.trim().length === 0) throw new Error('Ruta vacia');
  const api = scope.platform === 'win32' ? win32 : posix;
  const absolute = api.resolve(scope.cwd, target);
  const real = (path: string): string => (scope.realpath === undefined ? path : realOrAncestor(api, path, scope.realpath));
  const roots = [scope.cwd, ...scope.extraDirs].map((root) => real(api.resolve(root)));
  const resolved = real(absolute);
  const inside = roots.some((root) => isWithin(api, root, resolved, scope.platform === 'win32'));
  return { absolute, pathClass: inside ? 'inside' : 'outside' };
}

// Un destino que aun no existe (lo que va a crear `Write`) se clasifica por su ancestro existente mas
// cercano, con el resto del camino pegado detras.
function realOrAncestor(api: typeof posix, path: string, realpath: (path: string) => string | null): string {
  const found = realpath(path);
  if (found !== null) return found;
  const parent = api.dirname(path);
  if (parent === path) return path;
  return api.join(realOrAncestor(api, parent, realpath), api.basename(path));
}

function isWithin(api: typeof posix, root: string, target: string, caseInsensitive: boolean): boolean {
  const norm = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
  const relative = api.relative(norm(root), norm(target));
  // Otra unidad en win32: `relative` devuelve una ruta absoluta.
  if (api.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${api.sep}`);
}

// La `realpath` de verdad (sigue symlinks y junctions). Solo «no existe» es null: un fallo de permisos
// sube, y la herramienta lo devuelve al modelo como error.
export function nodeRealpath(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}
