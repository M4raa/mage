import { posix, win32 } from 'node:path';

// Resuelve una ruta que manda el modelo contra el cwd y decide si cae dentro del cwd (o de un
// directorio añadido) o fuera. PURO: el modulo de rutas se elige por plataforma, asi se prueba win32
// desde cualquier SO. En win32 se compara sin distinguir mayusculas (el FS tampoco lo hace).

export type PathClass = 'inside' | 'outside';

export interface PathScope {
  readonly cwd: string;
  readonly extraDirs: readonly string[];
  readonly platform: string;
}

export interface ResolvedPath {
  readonly absolute: string;
  readonly pathClass: PathClass;
}

export function resolveToolPath(target: string, scope: PathScope): ResolvedPath {
  if (target.trim().length === 0) throw new Error('Ruta vacia');
  const api = scope.platform === 'win32' ? win32 : posix;
  const absolute = api.resolve(scope.cwd, target);
  const roots = [scope.cwd, ...scope.extraDirs];
  const inside = roots.some((root) => isWithin(api, api.resolve(root), absolute, scope.platform === 'win32'));
  return { absolute, pathClass: inside ? 'inside' : 'outside' };
}

function isWithin(api: typeof posix, root: string, target: string, caseInsensitive: boolean): boolean {
  const norm = (value: string) => (caseInsensitive ? value.toLowerCase() : value);
  const relative = api.relative(norm(root), norm(target));
  // Otra unidad en win32: `relative` devuelve una ruta absoluta.
  if (api.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${api.sep}`);
}
