// Diff de lineas PURO para el `structuredPatch` de Write/Edit (la forma del CLI de Claude que pinta
// `diffLines.ts`): hunks `{oldStart, oldLines, newStart, newLines, lines}` con lineas ' ', '-', '+' y 3
// de contexto.
//
// ponytail: Myers O(N·D) sobre las lineas entre el prefijo y el sufijo comunes, sin heuristicas. Basta
// para ficheros de codigo; si un fichero grande lo hace notar, sustituir por la dependencia `diff`.

export interface PatchHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
}

const CONTEXT_LINES = 3;
// Por encima de este D (lineas distintas) no se calcula el diff fino: un unico hunk de borrar/añadir.
const MAX_EDIT_DISTANCE = 4_000;

type Op = { readonly sign: ' ' | '-' | '+'; readonly text: string };

export function lineDiff(before: string, after: string): PatchHunk[] {
  if (before === after) return [];
  const a = splitLines(before);
  const b = splitLines(after);
  return toHunks(diffOps(a, b));
}

function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function diffOps(a: readonly string[], b: readonly string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middle = myers(a.slice(start, endA), b.slice(start, endB));
  const same = (lines: readonly string[]): Op[] => lines.map((text) => ({ sign: ' ', text }));
  return [...same(a.slice(0, start)), ...middle, ...same(a.slice(endA))];
}

// Myers clasico con traza para reconstruir el camino.
function myers(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  if (n === 0 || m === 0 || max > MAX_EDIT_DISTANCE * 2) return [...a.map((text) => ({ sign: '-' as const, text })), ...b.map((text) => ({ sign: '+' as const, text }))];
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
      let x = down ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b, offset, d, k);
    }
    v = next;
  }
  throw new Error(`Diff sin solucion (n=${n}, m=${m})`);
}

function backtrack(trace: readonly Int32Array[], a: readonly string[], b: readonly string[], offset: number, dEnd: number, kEnd: number): Op[] {
  const ops: Op[] = [];
  let x = a.length;
  let y = b.length;
  let k = kEnd;
  for (let d = dEnd; d > 0; d--) {
    const v = trace[d]!;
    const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ sign: ' ', text: a[x]! });
    }
    if (down) {
      y--;
      ops.push({ sign: '+', text: b[y]! });
    } else {
      x--;
      ops.push({ sign: '-', text: a[x]! });
    }
    k = prevK;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ sign: ' ', text: a[x]! });
  }
  return ops.reverse();
}

// Agrupa los cambios en hunks con CONTEXT_LINES de contexto; dos cambios cercanos comparten hunk.
function toHunks(ops: readonly Op[]): PatchHunk[] {
  const changed = ops.map((op, i) => (op.sign === ' ' ? -1 : i)).filter((i) => i >= 0);
  if (changed.length === 0) return [];
  const ranges: Array<[number, number]> = [];
  for (const i of changed) {
    const from = Math.max(0, i - CONTEXT_LINES);
    const to = Math.min(ops.length - 1, i + CONTEXT_LINES);
    const last = ranges.at(-1);
    if (last !== undefined && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }
  return ranges.map(([from, to]) => hunkOf(ops, from, to));
}

function hunkOf(ops: readonly Op[], from: number, to: number): PatchHunk {
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops.slice(0, from)) {
    if (op.sign !== '+') oldLine++;
    if (op.sign !== '-') newLine++;
  }
  const slice = ops.slice(from, to + 1);
  const oldLines = slice.filter((op) => op.sign !== '+').length;
  const newLines = slice.filter((op) => op.sign !== '-').length;
  return { oldStart: oldLine, oldLines, newStart: newLine, newLines, lines: slice.map((op) => `${op.sign}${op.text}`) };
}
