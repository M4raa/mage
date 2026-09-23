// El UNICO modelo de linea de diff de Mage (2.12.2). Antes habia tres declaraciones de `DiffLine`
// (toolView, engineBlocks/types y ToolCallDetail) y dos visores con dos paletas distintas.
//
// La novedad: NUMEROS DE LINEA. MEDIDO sobre una transcripcion real (1946 lineas): los hunks de
// `structuredPatch` traen `oldStart`/`oldLines`/`newStart`/`newLines` — 141 veces cada uno — asi que
// los numeros son derivables del propio hunk. Tambien se midio que hay 15 `structuredPatch` SIN hunks
// (un `Write` que crea fichero): de ahi la guard clause, porque inventar un `1` seria peor que no
// numerar.

export type DiffSign = '+' | '-' | ' ';

export interface DiffLine {
  readonly sign: DiffSign;
  readonly text: string;
  // `null` cuando la linea no existe en ese lado (una adicion no tiene numero antiguo) o cuando el
  // hunk NO trae los campos: entonces se pinta el diff SIN numeros, nunca con numeros inventados.
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

// Convierte el `structuredPatch` (array de hunks con `lines[]` ya prefijadas con +/-/espacio) a lineas
// planas numeradas. `null` si no es un array o no tiene ninguna linea util. Entre hunks se inserta un
// separador de contexto (`⋯`) SIN numeros: no corresponde a ninguna linea del fichero.
export function parseStructuredPatch(patch: unknown): readonly DiffLine[] | null {
  if (!Array.isArray(patch)) return null;
  const lines: DiffLine[] = [];
  for (const hunk of patch) {
    if (!isRecord(hunk) || !Array.isArray(hunk.lines)) continue;
    if (lines.length > 0) lines.push({ sign: ' ', text: '⋯', oldLine: null, newLine: null });
    appendHunkLines(lines, hunk);
  }
  return lines.length > 0 ? lines : null;
}

// Numera las lineas de UN hunk. Los dos contadores avanzan por separado: una adicion solo consume
// numero nuevo, un borrado solo consume numero antiguo, y el contexto consume los dos.
function appendHunkLines(into: DiffLine[], hunk: Record<string, unknown>): void {
  let oldLine = positiveInt(hunk.oldStart);
  let newLine = positiveInt(hunk.newStart);
  for (const raw of hunk.lines as readonly unknown[]) {
    if (typeof raw !== 'string') continue;
    const { sign, text } = splitSign(raw);
    into.push({
      sign,
      text,
      oldLine: sign === '+' ? null : oldLine,
      newLine: sign === '-' ? null : newLine,
    });
    if (sign !== '+' && oldLine !== null) oldLine += 1;
    if (sign !== '-' && newLine !== null) newLine += 1;
  }
}

// Prefijo +/-/espacio -> {sign, text}. Las lineas especiales ("\\ No newline at end of file") no
// llevan prefijo y se tratan como contexto.
function splitSign(raw: string): { readonly sign: DiffSign; readonly text: string } {
  const first = raw.charAt(0);
  if (first === '+') return { sign: '+', text: raw.slice(1) };
  if (first === '-') return { sign: '-', text: raw.slice(1) };
  return { sign: ' ', text: raw.startsWith(' ') ? raw.slice(1) : raw };
}

// Entero >0 o null. Un `oldStart` ausente, cero, negativo o no numerico significa "este hunk no dice
// por donde va": se pinta sin numeros en vez de empezar a contar desde un sitio inventado.
function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
