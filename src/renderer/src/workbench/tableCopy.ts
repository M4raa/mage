import type { MdInline } from './markdown';

// Copiar una tabla Markdown renderizada (#44): las celdas son TEXTO plano (sin las marcas de Markdown) y
// salen como Markdown (para pegar en otro documento) o TSV (para pegar en una hoja de calculo). PURO.

type Cells = readonly string[];

// Texto plano de una celda: sin negritas, enlaces ni codigo, solo lo que se ve.
export function inlinesToText(nodes: readonly MdInline[]): string {
  return nodes.map((node) => (node.type === 'text' || node.type === 'code' ? node.text : inlinesToText(node.children))).join('');
}

const flatten = (cell: string): string => cell.replace(/[\t\r\n]+/g, ' ');

function markdownRow(cells: Cells): string {
  return `| ${cells.map((cell) => flatten(cell).replaceAll('|', '\|')).join(' | ')} |`;
}

export function tableToMarkdown(header: Cells, rows: readonly Cells[]): string {
  const separator = markdownRow(header.map(() => '---'));
  return [markdownRow(header), separator, ...rows.map(markdownRow)].join('\n');
}

export function tableToTsv(header: Cells, rows: readonly Cells[]): string {
  return [header, ...rows].map((cells) => cells.map(flatten).join('\t')).join('\n');
}
