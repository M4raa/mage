// Parseo PURO de la salida de git (P-026 3.5). Todo con `-z`: los campos van separados por NUL, asi que
// una ruta con espacios, tabuladores o saltos de linea no rompe nada. Tolerante a lo que no entiende
// (una linea desconocida se salta), estricto con los numeros (un contador que no es entero lanza).

export interface GitStatusSummary {
  readonly branch: string | null;
  readonly detached: boolean;
  readonly oid: string | null; // null en un repo sin commits (`(initial)`)
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly changed: number; // entradas `1`, `2` y `u` (seguidos con cambios o en conflicto)
  readonly untracked: number;
}

export interface GitDiffSummary {
  readonly added: number;
  readonly removed: number;
  readonly files: number;
  readonly binaryFiles: number;
}

const NUL = '\u0000';

type MutableStatus = { -readonly [K in keyof GitStatusSummary]: GitStatusSummary[K] };

// `git status --porcelain=v2 --branch -z`: cabeceras `# branch.*` y una entrada por fichero. Una
// entrada `2` (renombrado/copiado) trae DETRAS un campo extra con la ruta de origen, que se salta.
export function parseStatusV2(stdout: string): GitStatusSummary {
  const fields = stdout.split(NUL);
  const acc: MutableStatus = { branch: null, detached: false, oid: null, upstream: null, ahead: 0, behind: 0, changed: 0, untracked: 0 };
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i] ?? '';
    if (field.startsWith('# ')) applyHeader(acc, field.slice(2));
    else if (field.startsWith('1 ') || field.startsWith('u ')) acc.changed += 1;
    else if (field.startsWith('2 ')) {
      acc.changed += 1;
      i += 1; // ruta de origen del renombrado
    } else if (field.startsWith('? ')) acc.untracked += 1;
  }
  return acc;
}

function applyHeader(acc: MutableStatus, header: string): void {
  const space = header.indexOf(' ');
  if (space < 0) return;
  const key = header.slice(0, space);
  const value = header.slice(space + 1);
  if (key === 'branch.oid') acc.oid = value === '(initial)' ? null : value;
  else if (key === 'branch.head') {
    acc.detached = value === '(detached)';
    acc.branch = acc.detached ? null : value;
  } else if (key === 'branch.upstream') acc.upstream = value;
  else if (key === 'branch.ab') [acc.ahead, acc.behind] = parseAheadBehind(value);
}

// `+3 -1` → [3, 1].
function parseAheadBehind(value: string): [number, number] {
  const match = /^\+(\d+) -(\d+)$/.exec(value);
  if (match === null) throw new Error(`branch.ab con formato inesperado: "${value}"`);
  return [Number(match[1]), Number(match[2])];
}

// `git diff --numstat -z HEAD`: `añadidas\tborradas\truta` por fichero; un binario trae `-\t-`; un
// renombrado deja la ruta VACIA y la mandan los dos campos siguientes (origen y destino).
export function parseNumstat(stdout: string): GitDiffSummary {
  const fields = stdout.split(NUL);
  let added = 0;
  let removed = 0;
  let files = 0;
  let binaryFiles = 0;
  for (let i = 0; i < fields.length; i += 1) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(fields[i] ?? '');
    if (match === null) continue;
    files += 1;
    if (match[3] === '') i += 2;
    if (match[1] === '-' || match[2] === '-') {
      binaryFiles += 1;
      continue;
    }
    added += Number(match[1]);
    removed += Number(match[2]);
  }
  return { added, removed, files, binaryFiles };
}

// `git for-each-ref --format=%(refname:short) refs/heads`: una rama por linea.
export function parseBranches(stdout: string): readonly string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// Solo se cambia a una rama que ESTA en la lista que main acaba de leer, y nunca a algo que git
// pudiera leer como opcion. Devuelve el motivo del rechazo, o null si vale.
export function switchTargetError(name: string, branches: readonly string[]): string | null {
  if (name.length === 0) return 'rama vacía';
  if (name.startsWith('-')) return `rama no válida: "${name}"`;
  if (!branches.includes(name)) return `la rama "${name}" no existe en este repositorio`;
  return null;
}
