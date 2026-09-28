import type { GitSnapshot } from '@shared/git';
import type { IconName } from './components/Icon';
// Modelo de vista de las etiquetas de informacion del chat (la fila que va encima del input). PURO:
// datos -> etiquetas.
//
// Peticion del usuario: "encima de la barra de input deberian salir etiquetas de informacion del chat,
// como el directorio del chat (que al darle clic te de acceso directo, y asi ver los archivos que
// genera o acceder al scratchpad), proyecto abierto, etc, cosas interesantes de ver de un vistazo".

export interface ChatChip {
  // Nombre del icono del set propio (components/Icon.tsx), NO un caracter: un emoji de color no
  // hereda `currentColor` y con un tema claro importado se queda como una mancha ajena a la paleta.
  readonly icon: IconName;
  readonly label: string;
  // Texto largo del tooltip y del nombre accesible. Nunca es solo decorativo: es donde va el dato
  // completo que la etiqueta corta no puede enseñar (la ruta entera, el modelo resuelto).
  readonly title: string;
}

// Ultimo segmento de una ruta, con separadores de los DOS mundos: el cwd viene del SO y en Windows
// llega con barras invertidas, pero un proyecto abierto desde WSL o una ruta escrita a mano puede
// traer barras normales. Cadena vacia si no hay ningun segmento.
export function lastPathSegment(path: string): string {
  const segments = path.split(/[\\/]+/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? '';
}

// ¿Esta `path` dentro de `parent` (o es `parent`)? Comparacion por SEGMENTOS, no por prefijo de
// cadena: `C:/tmp/scratchpad-viejo` empieza por `C:/tmp/scratchpad` y no esta dentro. En Windows
// ademas no distingue mayusculas.
export function isInside(path: string, parent: string): boolean {
  const a = path.split(/[\\/]+/).filter((s) => s.length > 0).map((s) => s.toLowerCase());
  const b = parent.split(/[\\/]+/).filter((s) => s.length > 0).map((s) => s.toLowerCase());
  if (b.length === 0 || b.length > a.length) return false;
  return b.every((segment, i) => segment === a[i]);
}

// Etiqueta de la carpeta de trabajo. Una conversacion "sin friccion" arranca en un subdirectorio del
// scratchpad con nombre de UUID, y ahi el ultimo segmento no dice NADA (es lo que se veia: `aa691438-
// 9c76-4efe-…`). En ese caso la etiqueta es "Scratchpad", y la ruta entera sigue en el tooltip.
export function folderChip(cwd: string, scratchDir: string | null): ChatChip | null {
  if (cwd.trim().length === 0) return null;
  const enScratch = scratchDir !== null && scratchDir.length > 0 && isInside(cwd, scratchDir);
  const segment = lastPathSegment(cwd);
  return {
    icon: enScratch ? 'note' : 'folder',
    label: enScratch ? 'Scratchpad' : segment.length > 0 ? segment : cwd,
    title: `${cwd} · abrir la carpeta`,
  };
}

export function privacyChip(privacy: 'shared' | 'private'): ChatChip {
  return privacy === 'private'
    ? { icon: 'lock', label: 'Privado', title: 'Conversación privada: usa el perfil mage-private de la cuenta' }
    : { icon: 'diamond', label: 'Compartido', title: 'Conversación compartida: usa el pozo común de la cuenta' };
}

// Etiqueta de la rama (P-026 3.5). Sin repo, sin git o sin confianza, no hay etiqueta. Con la HEAD
// suelta se enseña el commit, que es lo unico que la identifica.
export function gitChip(snapshot: GitSnapshot | undefined): ChatChip | null {
  if (snapshot?.kind !== 'repo') return null;
  const label = snapshot.branch ?? snapshot.headShort ?? 'HEAD';
  const sync =
    snapshot.upstream === null
      ? 'sin rama remota'
      : `${snapshot.ahead} por delante y ${snapshot.behind} por detrás de ${snapshot.upstream}`;
  return { icon: 'branch', label, title: `${snapshot.detached ? 'HEAD suelta en' : 'Rama'} ${label} · ${sync}` };
}

export interface DiffChip {
  readonly added: string; // "+3520"
  readonly removed: string; // "−231"
  readonly title: string;
}

// Cambios sin confirmar, como en la captura del punto 12: `+N −M` en verde y rojo. Solo con el arbol
// sucio; los ficheros sin seguir no tienen lineas que contar y van al tooltip.
export function diffChip(snapshot: GitSnapshot | undefined): DiffChip | null {
  if (snapshot?.kind !== 'repo' || !snapshot.dirty) return null;
  const untracked = snapshot.untracked > 0 ? ` y ${snapshot.untracked} sin seguir` : '';
  return {
    added: `+${snapshot.added}`,
    removed: `−${snapshot.removed}`,
    title: `${snapshot.changedFiles} ${snapshot.changedFiles === 1 ? 'fichero cambiado' : 'ficheros cambiados'}${untracked}: +${snapshot.added} líneas, −${snapshot.removed}`,
  };
}
