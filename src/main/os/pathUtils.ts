import { normalize } from 'node:path';

// Compara dos rutas del sistema de forma robusta: normaliza separadores y '..'/'.', ignora la barra
// final y compara sin distinguir mayusculas/minusculas (Windows es case-insensitive; en POSIX rara vez
// colisiona y es aceptable para las comparaciones de config de este proyecto). Encapsula la
// comparacion para no repetirla.
//
// La barra final importa: `normalize` la CONSERVA, asi que sin este tratamiento "~/.claude/" y
// "~/.claude" serian rutas distintas. Y de esta funcion cuelgan las guardas de cuenta
// (AccountService.isMainDir / isManagedAccountDir) y la deteccion de junctions (classifyLink), donde un
// falso negativo se traduce en "ruta de cuenta no valida" o en un enlace que se toma por dir real.
export function pathEquals(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b);
}

function normalizeForCompare(path: string): string {
  // Minusculas SOLO en Windows (B13e). En POSIX `.claude/Projects` y `.claude/projects` son
  // directorios DISTINTOS, asi que bajarlo todo hacia que `LinkService.warnIfWrongTarget` se callara
  // justo cuando debia avisar: dos realpaths distintos se veian iguales.
  const normalized = stripTrailingSeparator(normalize(path));
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

// Quita la barra final SIN tocar las raices: en POSIX "/" y en Windows "C:\" son rutas completas cuyo
// separador final es parte de su significado (quitarlo dejaria "" y "C:", que es la ruta RELATIVA a la
// unidad, algo muy distinto).
function stripTrailingSeparator(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  if (trimmed.length === 0) return path; // era solo separadores ("/", "\\", "//")
  if (/^[A-Za-z]:$/.test(trimmed)) return path; // "C:\" -> no dejarlo en "C:"
  return trimmed;
}
