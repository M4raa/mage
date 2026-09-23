// Edicion "rica" del prompt (M3): continuacion de listas e indentado. Logica PURA sobre un estado de
// texto plano (valor + seleccion), sin tocar el DOM: el PromptBar la cablea en onKeyDown y aplica el
// resultado al textarea controlado. Testeable de forma aislada (patron de toolView/contextView/…).

// Estado de un textarea reducido a lo que necesita la edicion: el texto y el rango de seleccion.
export interface TextState {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

// Unidad de indentado: 2 espacios (sin magic numbers dispersos).
export const INDENT_UNIT = '  ';

// Regex de item de lista (sobre la linea completa). Desordenada: indentacion + bullet (-,*,+) +
// espacios + contenido. Ordenada: indentacion + numero + delimitador (. o )) + espacios + contenido.
const UNORDERED_ITEM = /^(\s*)([-*+])(\s+)(.*)$/;
const ORDERED_ITEM = /^(\s*)(\d+)([.)])(\s+)(.*)$/;

// Continua una lista al pulsar Shift+Enter. Devuelve el nuevo estado, o null si la linea del cursor no
// es un item de lista (el caller deja el salto de linea por defecto). Reglas:
//  - item con contenido -> inserta "\n" + indentacion + marcador siguiente (bullet igual; ordinal +1).
//  - item vacio (solo el marcador) y cursor al final de la linea -> elimina el marcador (sale de la lista).
export function continueListOnNewline(state: TextState): TextState | null {
  const { value, selectionStart, selectionEnd } = state;
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  const lineEndRaw = value.indexOf('\n', selectionStart);
  const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;
  const line = value.slice(lineStart, lineEnd);

  const parsed = parseListItem(line);
  if (parsed === null) return null;

  const caretAtLineEnd = selectionStart === selectionEnd && selectionStart === lineEnd;
  if (parsed.content.length === 0) {
    // Item vacio + Enter al final -> salir de la lista (borrar el marcador, dejar la linea vacia).
    if (!caretAtLineEnd) return null;
    return { value: value.slice(0, lineStart) + value.slice(lineEnd), selectionStart: lineStart, selectionEnd: lineStart };
  }

  // Item con contenido -> nueva linea con el marcador siguiente, reemplazando la seleccion.
  const insertion = `\n${parsed.indent}${parsed.nextMarker}`;
  const caret = selectionStart + insertion.length;
  return {
    value: value.slice(0, selectionStart) + insertion + value.slice(selectionEnd),
    selectionStart: caret,
    selectionEnd: caret,
  };
}

// Datos de un item de lista ya parseado: indentacion, contenido tras el marcador y el marcador que
// tocaria en la linea siguiente (bullet igual; ordinal +1, conservando el delimitador y el espaciado).
interface ParsedListItem {
  readonly indent: string;
  readonly content: string;
  readonly nextMarker: string;
}

function parseListItem(line: string): ParsedListItem | null {
  const unordered = UNORDERED_ITEM.exec(line);
  if (unordered !== null) {
    const [, indent, bullet, spacing, content] = unordered;
    return { indent: indent ?? '', content: (content ?? '').trim(), nextMarker: `${bullet}${spacing}` };
  }
  const ordered = ORDERED_ITEM.exec(line);
  if (ordered !== null) {
    const [, indent, num, delimiter, spacing, content] = ordered;
    const next = Number(num) + 1;
    return { indent: indent ?? '', content: (content ?? '').trim(), nextMarker: `${next}${delimiter}${spacing}` };
  }
  return null;
}

// Indenta las lineas que toca la seleccion: antepone INDENT_UNIT a cada una y reajusta el rango.
export function indentLines(state: TextState): TextState {
  const range = affectedLineRange(state);
  const before = state.value.slice(0, range.start);
  const block = state.value.slice(range.start, range.end);
  const after = state.value.slice(range.end);
  const lines = block.split('\n');
  const indented = lines.map((line) => INDENT_UNIT + line).join('\n');
  const added = INDENT_UNIT.length;
  return {
    value: before + indented + after,
    selectionStart: state.selectionStart + added,
    selectionEnd: state.selectionEnd + added * lines.length,
  };
}

// Desindenta las lineas que toca la seleccion: quita hasta INDENT_UNIT.length espacios iniciales (o un
// tab) de cada una y reajusta el rango con clamps (nunca antes del inicio de su linea).
export function outdentLines(state: TextState): TextState {
  const range = affectedLineRange(state);
  const before = state.value.slice(0, range.start);
  const block = state.value.slice(range.start, range.end);
  const after = state.value.slice(range.end);
  const lines = block.split('\n');

  let firstLineRemoved = 0;
  let totalRemoved = 0;
  const outdented = lines.map((line, index) => {
    const removed = leadingIndentToRemove(line);
    if (index === 0) firstLineRemoved = removed;
    totalRemoved += removed;
    return line.slice(removed);
  });

  // El start baja como mucho lo quitado a SU linea (sin cruzar el inicio de linea); el end baja el total.
  const startOffset = Math.min(firstLineRemoved, state.selectionStart - range.start);
  return {
    value: before + outdented.join('\n') + after,
    selectionStart: Math.max(range.start, state.selectionStart - startOffset),
    selectionEnd: Math.max(state.selectionStart - startOffset, state.selectionEnd - totalRemoved),
  };
}

// Cuantos caracteres iniciales quitar de una linea al desindentar: un tab, o hasta INDENT_UNIT.length
// espacios (menos si hay menos). 0 si no empieza por espacio en blanco.
function leadingIndentToRemove(line: string): number {
  if (line.startsWith('\t')) return 1;
  let spaces = 0;
  while (spaces < INDENT_UNIT.length && line[spaces] === ' ') spaces += 1;
  return spaces;
}

// Rango [start,end) expandido a lineas COMPLETAS que toca la seleccion (para indentar/desindentar
// linea a linea). start = inicio de la linea de selectionStart; end = fin de la linea de selectionEnd.
function affectedLineRange(state: TextState): { readonly start: number; readonly end: number } {
  const start = state.value.lastIndexOf('\n', state.selectionStart - 1) + 1;
  const endRaw = state.value.indexOf('\n', state.selectionEnd);
  const end = endRaw === -1 ? state.value.length : endRaw;
  return { start, end };
}
