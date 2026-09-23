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

// Etiqueta del modelo. `resolved` es lo que el CLI dijo al arrancar (`session_init.model`, p.ej.
// `claude-sonnet-5`): los ids de Claude son ALIAS que apuntan a la ultima version de su familia, asi
// que la unica version que no miente es la que reporta la sesion. Va al tooltip, no a la etiqueta:
// en la fila cabe el nombre corto, y el largo es para cuando importa.
export function modelChip(modelLabel: string, resolved: string | null): ChatChip {
  return {
    icon: 'brain',
    label: modelLabel,
    title: resolved === null || resolved.length === 0 ? `Modelo ${modelLabel}` : `Modelo ${modelLabel} · la sesión resolvió ${resolved}`,
  };
}

export function privacyChip(privacy: 'shared' | 'private'): ChatChip {
  return privacy === 'private'
    ? { icon: 'lock', label: 'Privado', title: 'Conversación privada: usa el perfil mage-private de la cuenta' }
    : { icon: 'diamond', label: 'Compartido', title: 'Conversación compartida: usa el pozo común de la cuenta' };
}
