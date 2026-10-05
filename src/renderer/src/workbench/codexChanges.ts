import { z } from 'zod';
import { parseStructuredPatch, type DiffLine } from './diffLines';

// 0.160.0: un alta trae CONTENIDO sin prefijos en changes[].diff; una actualizacion trae un diff.
// Se conservan las rutas de todos los cambios y se muestran sin inventar numeros de linea.
const CHANGE = z.object({ path: z.string(), kind: z.object({ type: z.string() }).passthrough(), diff: z.string() }).passthrough();

export function codexChangeView(raw: unknown): { readonly target: string; readonly diff: readonly DiffLine[]; readonly summary: string } {
  const parsed = z.array(CHANGE).safeParse(raw);
  if (!parsed.success) return { target: 'apply_patch', diff: [], summary: '' };
  const changes = parsed.data;
  const diff = changes.flatMap((change) => {
    const lines = change.diff.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const content = lines.map((line) => prefixedLine(change.kind.type, line));
    const useful = change.kind.type === 'update' ? content.filter((line) => !/^(---|\+\+\+) /.test(line)) : content;
    const header: DiffLine = { sign: ' ', text: change.path, oldLine: null, newLine: null };
    return [header, ...(parseStructuredPatch([{ lines: useful }]) ?? [])];
  });
  return { target: `apply_patch ${changes.map((change) => change.path).join(', ')}`,
    diff, summary: `+${diff.filter((line) => line.sign === '+').length} −${diff.filter((line) => line.sign === '-').length}` };
}

function prefixedLine(kind: string, line: string): string {
  if (kind === 'add') return `+${line}`;
  if (kind === 'delete') return `-${line}`;
  return line;
}
