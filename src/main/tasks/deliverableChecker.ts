// Comprobación de entregables de una tarea (F8): Mage no se fía de que el modelo diga «hecho»; mira que cada
// fichero anunciado existe, es un fichero, se puede leer y cae dentro de las carpetas autorizadas.
// Puro: el sistema de ficheros llega inyectado.
import { extname, isAbsolute, resolve, sep } from 'node:path';
import type { DeliverableCheck } from '@shared/tasks';

export interface DeliverableFs {
  readonly stat: (path: string) => { readonly isFile: boolean; readonly size: number; readonly mtimeMs: number } | null; // null = no existe
  readonly canRead: (path: string) => boolean; // abre y lee 1 byte; false si falla
}

export interface DeliverableScope {
  readonly folders: readonly string[];
  readonly caseInsensitive: boolean;
}

// Clave de comparación de una ruta: normalizada y, si el sistema no distingue mayúsculas, en minúsculas.
export function comparablePath(path: string, caseInsensitive: boolean): string {
  const resolved = resolve(path);
  return caseInsensitive ? resolved.toLowerCase() : resolved;
}

// Ambas claves vienen de `comparablePath` (resueltas, sin `..`): basta el prefijo con separador. No se usa
// `path.relative` porque en Windows ignora siempre las mayúsculas y aquí la regla la manda `caseInsensitive`.
function isInsideFolder(folderKey: string, pathKey: string): boolean {
  const prefix = folderKey.endsWith(sep) ? folderKey : `${folderKey}${sep}`;
  return pathKey === folderKey || pathKey.startsWith(prefix);
}

function assertScope(scope: DeliverableScope): void {
  const ok = scope.folders.length > 0 && scope.folders.every((folder) => isAbsolute(folder));
  if (!ok) throw new Error(`checkDeliverables: se necesita al menos una carpeta y todas absolutas, recibido ${JSON.stringify(scope.folders)}`);
}

function checkInScope(declared: string, path: string, fs: DeliverableFs): DeliverableCheck {
  const kind = extname(path).slice(1).toLowerCase();
  const empty = { declared, path, kind, bytes: null, modifiedAtMs: null } as const;
  const stat = fs.stat(path);
  if (stat === null) return { ...empty, status: 'missing' };
  if (!stat.isFile) return { ...empty, status: 'notFile' };
  const found = { ...empty, bytes: Math.trunc(stat.size), modifiedAtMs: Math.trunc(stat.mtimeMs) };
  return fs.canRead(path) ? { ...found, status: 'ok' } : { ...found, status: 'unreadable' };
}

export function checkDeliverables(declared: readonly string[], scope: DeliverableScope, fs: DeliverableFs): readonly DeliverableCheck[] {
  assertScope(scope);
  const base = scope.folders[0] as string;
  const folderKeys = scope.folders.map((folder) => comparablePath(folder, scope.caseInsensitive));
  const seen = new Set<string>();
  const checks: DeliverableCheck[] = [];
  for (const item of declared) {
    const path = resolve(base, item);
    const key = comparablePath(path, scope.caseInsensitive);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!folderKeys.some((folderKey) => isInsideFolder(folderKey, key))) {
      checks.push({ declared: item, path, status: 'outsideScope', bytes: null, modifiedAtMs: null, kind: extname(path).slice(1).toLowerCase() });
      continue;
    }
    checks.push(checkInScope(item, path, fs));
  }
  return checks;
}
