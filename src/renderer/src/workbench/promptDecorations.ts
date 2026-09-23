// Decoraciones WYSIWYG del prompt (2.7), como funcion PURA: texto -> rangos. Sin CodeMirror aqui
// dentro, para poder probar exhaustivamente lo unico que puede romper el input en runtime.
//
// Alcance cerrado con el usuario: listas, enfasis (`**`/`_`), codigo inline, vallas y encabezados.
// Enlaces, tablas, citas y `---` se quedan en TEXTO PLANO — se envian igual, solo no se pintan.
//
// Comportamiento "Obsidian": en la LINEA DEL CURSOR los marcadores NO se ocultan, para poder editarlos.
// En las demas si.
//
// DOS INVARIANTES que hay que respetar si o si, porque CodeMirror LANZA con cualquiera de las dos roto
// y al caerse el plugin el input se queda SIN formato (medido en el .exe empaquetado):
//   1. los rangos no se solapan;
//   2. ningun rango esta VACIO (`from === to`) — "Mark decorations may not be empty".
// Los dos casos vacios alcanzables son un encabezado sin texto aun (`"## "` mientras se teclea) y una
// linea en blanco dentro de una valla. Se filtran en el ULTIMO paso, no en cada `push`: un solo sitio
// donde puede estar mal.

export type DecorationKind =
  | 'bullet'
  | 'ordinal'
  | 'marker-hidden'
  | 'list-indent'
  | 'strong'
  | 'em'
  | 'code'
  | 'fence'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6';

export interface DecorationRange {
  readonly from: number;
  readonly to: number;
  readonly kind: DecorationKind;
}

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d+[.)]))(\s+)/;
const HEADING = /^(#{1,6})(\s+)/;
const FENCE = /^\s*```/;
const MAX_HEADING_LEVEL = 6;

// `cursorLine` es 0-based; -1 = sin cursor (no se muestra ningun marcador).
export function decorationRangesFor(text: string, cursorLine: number): readonly DecorationRange[] {
  const ranges: DecorationRange[] = [];
  let offset = 0;
  let insideFence = false;

  for (const [index, line] of text.split('\n').entries()) {
    const isCursorLine = index === cursorLine;
    if (FENCE.test(line)) {
      ranges.push({ from: offset, to: offset + line.length, kind: 'fence' });
      insideFence = !insideFence;
      offset += line.length + 1;
      continue;
    }
    if (insideFence) {
      // Dentro de una valla ABIERTA no se decora nada: un `**` ahi es codigo, no enfasis. Una valla sin
      // cerrar decora hasta el final, igual de tolerante que el parser del chat.
      ranges.push({ from: offset, to: offset + line.length, kind: 'fence' });
      offset += line.length + 1;
      continue;
    }
    appendLineRanges(ranges, line, offset, isCursorLine);
    offset += line.length + 1;
  }
  return ranges.filter((range) => range.to > range.from);
}

// Decoraciones de UNA linea fuera de vallas: encabezado o lista (que ocupan el principio) y, en el
// resto, los inline. Se recorre en orden y sin solapar: el bloque decide su tramo y los inline solo
// miran lo que queda.
function appendLineRanges(ranges: DecorationRange[], line: string, offset: number, isCursorLine: boolean): void {
  const heading = HEADING.exec(line);
  if (heading !== null) {
    const level = Math.min(heading[1]?.length ?? 1, MAX_HEADING_LEVEL);
    const markerEnd = offset + (heading[1]?.length ?? 0) + (heading[2]?.length ?? 0);
    if (!isCursorLine) ranges.push({ from: offset, to: markerEnd, kind: 'marker-hidden' });
    ranges.push({ from: markerEnd, to: offset + line.length, kind: `heading-${level}` as DecorationKind });
    return;
  }

  const list = LIST_ITEM.exec(line);
  if (list !== null) {
    const indent = list[1] ?? '';
    const marker = list[2] ?? list[3] ?? '';
    const space = list[4] ?? '';
    const markerFrom = offset + indent.length;
    const markerTo = markerFrom + marker.length + space.length;
    if (indent.length > 0) ranges.push({ from: offset, to: markerFrom, kind: 'list-indent' });
    // En la linea del cursor el marcador se VE (se esta editando); en las demas se sustituye por la
    // viñeta pintada.
    ranges.push({ from: markerFrom, to: markerTo, kind: isCursorLine ? (list[2] !== undefined ? 'bullet' : 'ordinal') : 'marker-hidden' });
    appendInlineRanges(ranges, line.slice(markerTo - offset), markerTo);
    return;
  }

  appendInlineRanges(ranges, line, offset);
}

// Inline: codigo primero (lo que hay dentro de backticks no es enfasis), luego `**`/`__` y luego `_`/`*`
// sueltos. Se lleva un mapa de posiciones ya tomadas para no emitir rangos solapados.
function appendInlineRanges(ranges: DecorationRange[], text: string, offset: number): void {
  const taken: boolean[] = new Array(text.length).fill(false);
  collect(/`([^`\n]+)`/g, 'code');
  collect(/\*\*([^*\n]+)\*\*/g, 'strong');
  collect(/__([^_\n]+)__/g, 'strong');
  collect(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, 'em');
  // `_` solo cuenta como enfasis con frontera de NO-palabra a los dos lados: asi `snake_case`
  // sobrevive, igual que en el parser del chat.
  collect(/(?<![\w_])_([^_\n]+)_(?![\w_])/g, 'em');

  function collect(pattern: RegExp, kind: DecorationKind): void {
    for (const match of text.matchAll(pattern)) {
      const from = match.index ?? 0;
      const to = from + match[0].length;
      if (taken.slice(from, to).some(Boolean)) continue; // ya decorado por una regla anterior
      for (let i = from; i < to; i += 1) taken[i] = true;
      ranges.push({ from: offset + from, to: offset + to, kind });
    }
  }
}
