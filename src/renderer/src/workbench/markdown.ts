// Parser de Markdown PURO (subconjunto que emite un agente de codigo: headings, code fences, listas
// anidadas, blockquotes, tablas GFM, hr y enfasis/codigo/enlaces inline). Sin React ni DOM: solo
// texto -> AST (datos), testeable en Vitest. El render a React vive en Markdown.tsx. Es TOLERANTE
// (pensado para streaming): un fence sin cerrar se trata como bloque de codigo hasta el final; nunca
// lanza. NO interpreta HTML crudo (se muestra como texto) por seguridad.

export type MdInline =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'strong'; readonly children: readonly MdInline[] }
  | { readonly type: 'em'; readonly children: readonly MdInline[] }
  | { readonly type: 'del'; readonly children: readonly MdInline[] }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'link'; readonly href: string; readonly children: readonly MdInline[] };

export interface MdListItem {
  readonly children: readonly MdBlock[];
}

export type MdBlock =
  | { readonly type: 'heading'; readonly level: number; readonly children: readonly MdInline[] }
  | { readonly type: 'paragraph'; readonly children: readonly MdInline[] }
  | { readonly type: 'code'; readonly lang: string | null; readonly text: string }
  | { readonly type: 'list'; readonly ordered: boolean; readonly start: number; readonly items: readonly MdListItem[] }
  | { readonly type: 'blockquote'; readonly children: readonly MdBlock[] }
  | { readonly type: 'hr' }
  | { readonly type: 'table'; readonly header: readonly (readonly MdInline[])[]; readonly rows: readonly (readonly (readonly MdInline[])[])[] };

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*([^`~]*)$/;
const HR_RE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const BLOCKQUOTE_RE = /^ {0,3}>[ \t]?(.*)$/;
const LIST_ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TABLE_SEP_RE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/;

// Punto de entrada: convierte texto Markdown en una lista de bloques.
export function parseMarkdown(source: string): readonly MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines);
}

// Bucle principal de bloques: consume `lines` de arriba a abajo, delegando en parsers especificos.
function parseBlocks(lines: readonly string[]): MdBlock[] {
  const blocks: MdBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }
    const consumed =
      tryFence(lines, i, blocks) ??
      tryHeadingHrQuote(lines, i, blocks) ??
      tryTable(lines, i, blocks) ??
      tryList(lines, i, blocks) ??
      consumeParagraph(lines, i, blocks);
    i = consumed;
  }
  return blocks;
}

// Bloque de codigo cercado (``` o ~~~). Tolerante: si no se cierra, llega hasta el final.
function tryFence(lines: readonly string[], start: number, out: MdBlock[]): number | null {
  const match = FENCE_RE.exec(lines[start] ?? '');
  if (match === null) return null;
  const fence = match[2] ?? '```';
  const lang = (match[3] ?? '').trim();
  const closeRe = new RegExp(`^\\s*${fence[0]}{${fence.length},}\\s*$`);
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && !closeRe.test(lines[i] ?? '')) {
    body.push(lines[i] ?? '');
    i += 1;
  }
  out.push({ type: 'code', lang: lang.length > 0 ? lang : null, text: body.join('\n') });
  return i < lines.length ? i + 1 : i; // salta la linea de cierre si existe
}

// Bloques de una sola pista al inicio de linea: hr, heading y blockquote (agrupa lineas `>`).
function tryHeadingHrQuote(lines: readonly string[], start: number, out: MdBlock[]): number | null {
  const line = lines[start] ?? '';
  if (HR_RE.test(line)) {
    out.push({ type: 'hr' });
    return start + 1;
  }
  const heading = HEADING_RE.exec(line);
  if (heading !== null) {
    out.push({ type: 'heading', level: (heading[1] ?? '#').length, children: parseInline(heading[2] ?? '') });
    return start + 1;
  }
  if (!BLOCKQUOTE_RE.test(line)) return null;
  const inner: string[] = [];
  let i = start;
  while (i < lines.length) {
    const m = BLOCKQUOTE_RE.exec(lines[i] ?? '');
    if (m === null) break;
    inner.push(m[1] ?? '');
    i += 1;
  }
  out.push({ type: 'blockquote', children: parseBlocks(inner) });
  return i;
}

// Tabla GFM: fila de cabecera con `|` seguida de una fila separadora `---|---`.
function tryTable(lines: readonly string[], start: number, out: MdBlock[]): number | null {
  const headerLine = lines[start] ?? '';
  const sepLine = lines[start + 1] ?? '';
  if (!headerLine.includes('|') || !TABLE_SEP_RE.test(sepLine)) return null;
  const header = splitTableRow(headerLine);
  if (header.length === 0) return null;
  const rows: (readonly MdInline[])[][] = [];
  let i = start + 2;
  while (i < lines.length && (lines[i] ?? '').includes('|') && (lines[i] ?? '').trim().length > 0) {
    rows.push(splitTableRow(lines[i] ?? ''));
    i += 1;
  }
  out.push({ type: 'table', header, rows });
  return i;
}

// Divide una fila de tabla en celdas (inline), respetando `\|` escapado y descartando bordes vacios.
function splitTableRow(line: string): (readonly MdInline[])[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === '\\' && trimmed[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (ch === '|') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((cell) => parseInline(cell.trim()));
}

// Lista (ordenada o no) con anidamiento por indentacion. Cada item re-parsea su contenido dedentado
// (asi las sublistas y los parrafos de continuacion salen gratis por recursion).
function tryList(lines: readonly string[], start: number, out: MdBlock[]): number | null {
  const first = LIST_ITEM_RE.exec(lines[start] ?? '');
  if (first === null) return null;
  const markerIndent = (first[1] ?? '').length;
  const ordered = /\d/.test(first[2] ?? '');
  const startNum = ordered ? Number.parseInt(first[2] ?? '1', 10) : 1;
  const items: MdListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const m = LIST_ITEM_RE.exec(lines[i] ?? '');
    if (m === null || (m[1] ?? '').length !== markerIndent) break;
    if (ordered !== /\d/.test(m[2] ?? '')) break; // no mezclar ordenada con no ordenada
    const contentIndent = markerIndent + (m[2] ?? '').length + 1;
    const itemLines: string[] = [dedent(lines[i] ?? '', contentIndent, m[3] ?? '')];
    i += 1;
    // Lineas de continuacion / sublistas: indentadas > markerIndent, o en blanco entre contenido.
    while (i < lines.length) {
      const raw = lines[i] ?? '';
      if (raw.trim().length === 0) {
        itemLines.push('');
        i += 1;
        continue;
      }
      const indent = raw.length - raw.trimStart().length;
      if (indent <= markerIndent) break;
      itemLines.push(dedent(raw, contentIndent, raw.trimStart()));
      i += 1;
    }
    while (itemLines.length > 0 && itemLines[itemLines.length - 1] === '') itemLines.pop();
    items.push({ children: parseBlocks(itemLines) });
  }
  out.push({ type: 'list', ordered, start: startNum, items });
  return i;
}

// Quita `indent` espacios del inicio (para re-parsear el contenido del item sin su sangria).
function dedent(line: string, indent: number, fallback: string): string {
  const leading = line.length - line.trimStart().length;
  if (leading >= indent) return line.slice(indent);
  return fallback;
}

// Parrafo: agrupa lineas consecutivas hasta un blanco o el inicio de otro bloque. Une con '\n'
// (los saltos dentro del parrafo se conservan como saltos de linea suaves al renderizar).
function consumeParagraph(lines: readonly string[], start: number, out: MdBlock[]): number {
  const buffer: string[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0) break;
    if (i > start && startsNewBlock(lines, i)) break;
    buffer.push(line.trim());
    i += 1;
  }
  out.push({ type: 'paragraph', children: parseInline(buffer.join('\n')) });
  return i > start ? i : start + 1;
}

// Detecta si una linea (dentro de un parrafo en curso) inicia otro bloque y corta el parrafo.
function startsNewBlock(lines: readonly string[], i: number): boolean {
  const line = lines[i] ?? '';
  return (
    FENCE_RE.test(line) ||
    HR_RE.test(line) ||
    HEADING_RE.test(line) ||
    BLOCKQUOTE_RE.test(line) ||
    LIST_ITEM_RE.test(line) ||
    (line.includes('|') && TABLE_SEP_RE.test(lines[i + 1] ?? ''))
  );
}

// --- Inline ------------------------------------------------------------------------------------

// Tokeniza texto inline en runs (texto/enfasis/codigo/enlace). Recorre char a char; el codigo inline
// (`...`) tiene prioridad (su contenido no se re-parsea). Delimitadores sin cerrar -> texto literal.
export function parseInline(text: string): readonly MdInline[] {
  return parseInlineInto(text);
}

function parseInlineInto(text: string): MdInline[] {
  const out: MdInline[] = [];
  let plain = '';
  const flush = (): void => {
    if (plain.length > 0) {
      out.push({ type: 'text', text: plain });
      plain = '';
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    if (ch === '\\' && i + 1 < text.length) {
      plain += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const code = matchCode(text, i);
      if (code !== null) {
        flush();
        out.push({ type: 'code', text: code.text });
        i = code.end;
        continue;
      }
    }
    const link = ch === '[' ? matchLink(text, i) : null;
    if (link !== null) {
      flush();
      out.push({ type: 'link', href: link.href, children: parseInlineInto(link.label) });
      i = link.end;
      continue;
    }
    const emph = matchEmphasis(text, i);
    if (emph !== null) {
      flush();
      out.push({ type: emph.node, children: parseInlineInto(emph.inner) });
      i = emph.end;
      continue;
    }
    plain += ch;
    i += 1;
  }
  flush();
  return out;
}

// Codigo inline: `texto` o ``texto con ` dentro``. Devuelve el contenido y el indice de fin.
function matchCode(text: string, start: number): { text: string; end: number } | null {
  let ticks = 0;
  while (text[start + ticks] === '`') ticks += 1;
  const fence = '`'.repeat(ticks);
  const closeIdx = text.indexOf(fence, start + ticks);
  if (closeIdx === -1) return null;
  const inner = text.slice(start + ticks, closeIdx);
  return { text: inner.replace(/^ (.*) $/, '$1'), end: closeIdx + ticks };
}

// Enlace [label](href). No admite parentesis anidados en href (raro en salida de agente).
function matchLink(text: string, start: number): { label: string; href: string; end: number } | null {
  const closeLabel = findMatching(text, start, '[', ']');
  if (closeLabel === -1 || text[closeLabel + 1] !== '(') return null;
  const closeHref = text.indexOf(')', closeLabel + 2);
  if (closeHref === -1) return null;
  const label = text.slice(start + 1, closeLabel);
  const href = text.slice(closeLabel + 2, closeHref).trim();
  return { label, href, end: closeHref + 1 };
}

// Enfasis: **strong**, __strong__, *em*, _em_, ~~del~~. Busca el delimitador de cierre correspondiente.
function matchEmphasis(text: string, start: number): { node: 'strong' | 'em' | 'del'; inner: string; end: number } | null {
  const two = text.slice(start, start + 2);
  if (two === '**' || two === '__') return closeAt(text, start, two, 'strong');
  if (two === '~~') return closeAt(text, start, two, 'del');
  const one = text[start] ?? '';
  if (one === '*' || one === '_') {
    // `_` no abre enfasis en medio de una palabra (p.ej. snake_case); `*` si.
    if (one === '_' && isWordChar(text[start - 1])) return null;
    return closeAt(text, start, one, 'em');
  }
  return null;
}

function closeAt(
  text: string,
  start: number,
  delim: string,
  node: 'strong' | 'em' | 'del',
): { node: 'strong' | 'em' | 'del'; inner: string; end: number } | null {
  const from = start + delim.length;
  if ((text[from] ?? ' ').trim().length === 0) return null; // sin contenido pegado al delimitador
  let i = from;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text.startsWith(delim, i) && !isSpace(text[i - 1])) {
      const inner = text.slice(from, i);
      if (inner.length > 0) return { node, inner, end: i + delim.length };
      return null;
    }
    i += 1;
  }
  return null;
}

function findMatching(text: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let i = start; i < text.length; i += 1) {
    if (text[i] === '\\') {
      i += 1;
      continue;
    }
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9]/.test(ch);
}

function isSpace(ch: string | undefined): boolean {
  return ch === undefined || ch === ' ' || ch === '\t';
}
