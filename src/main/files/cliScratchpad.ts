import { isAbsolute, relative, sep } from 'node:path';

// ¿Una ruta cae en el SCRATCHPAD del CLI? Es la segunda raíz permitida fuera del cwd de la
// conversación, junto a los planes (ver `isUnderManagedPlans` en main/index.ts).
//
// POR QUE EXISTE (reporte del usuario, 2026-09-21, con captura): el panel de Ficheros LISTA lo que el
// agente dice haber escrito, y el agente escribe en su propio scratchpad —que no está bajo el cwd de
// nadie—. El fichero salía en la lista y al pulsarlo saltaba «El fichero no está en la carpeta de la
// conversación ni en los planes del CLI». Mismo agujero que ya se tapó para los planes, otra carpeta.
//
// La forma la tiene medida el repo en `state/scratchRetention.ts`:
// `<temp>/claude-<uid>/<slug del cwd>/<sessionId>/scratchpad/…`. Se acepta también `claude` a secas,
// sin sufijo, que es lo que escribe la versión con la que se reportó el fallo.
//
// SE ANCLA POR ESTRUCTURA, no por prefijo: hacen falta las CUATRO capas y que la última se llame
// `scratchpad`. Permitir `<temp>` a secas —o `<temp>/claude/` sin más— abriría lectura y escritura de
// fichero arbitrario sobre un directorio donde escribe cualquier proceso de la máquina.
//
// Las rutas llegan ya CANONICALIZADAS por quien llama (main): en Windows la misma carpeta se escribe
// `C:\Users\USUARIO\…` u `C:\Users\usuario\…` según quién la imprima, y comparar las dos formas en
// crudo da un "fuera" que no lo es.

// `claude` o `claude-<uid>`. El sufijo es el id de usuario del SO, así que se acepta cualquier
// identificador razonable en vez de fijar un formato que la siguiente versión del CLI puede cambiar.
const CLI_TEMP_ROOT_PATTERN = /^claude(-[A-Za-z0-9._-]+)?$/;

// Capas bajo `<temp>`: raíz del CLI, slug del cwd, id de sesión, `scratchpad`, y al menos un nombre
// más (el fichero). Menos que eso es la carpeta contenedora, no un fichero dentro.
const SCRATCHPAD_DEPTH = 4;
const MIN_SEGMENTS = SCRATCHPAD_DEPTH + 1;

export function isUnderCliScratchpad(tempDir: string, targetPath: string): boolean {
  if (tempDir.trim().length === 0) return false;
  const rel = relative(tempDir, targetPath);
  // Igual que `isInside` de projectFileService: '' es el propio dir, '..' sale fuera, y una ruta
  // absoluta significa otra unidad en Windows. Nunca un `startsWith` de cadenas.
  if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) return false;
  const segments = rel.split(sep).filter((segment) => segment.length > 0);
  if (segments.length < MIN_SEGMENTS) return false;
  if (!CLI_TEMP_ROOT_PATTERN.test(segments[0] ?? '')) return false;
  return segments[SCRATCHPAD_DEPTH - 1] === 'scratchpad';
}
