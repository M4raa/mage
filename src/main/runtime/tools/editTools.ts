import { dirname } from 'node:path';
import { z } from 'zod';
import type { ToolOutcome } from '../agentLoop';
import { lineDiff } from './lineDiff';
import { resolveToolPath } from './pathGuard';
import { fail, truncateOutput, type RuntimeTool, type ToolContext } from './types';

// Herramientas de EDICION del runtime propio (ficha D5): `Write` (fichero entero) y `Edit` (reemplazo
// de una cadena EXACTA y unica, como el CLI de Claude y como recomienda aider para modelos pequeños:
// sin numeros de linea). Las dos devuelven `structuredPatch` para que el chat pinte el diff.

// Tras tantos `Edit` fallidos seguidos, el error sugiere reescribir con `Write` (plan B de D5 b).
export const EDIT_FAILS_BEFORE_HINT = 2;

export interface EditToolsFs {
  readonly readFile: (path: string, encoding: 'utf8') => Promise<string>;
  readonly writeFile: (path: string, data: string, encoding: 'utf8') => Promise<void>;
  readonly mkdir: (path: string, options: { recursive: true }) => Promise<unknown>;
  readonly stat: (path: string) => Promise<{ readonly mtimeMs: number }>;
}

export interface EditToolsDeps {
  readonly fs: EditToolsFs;
  readonly platform: string;
  // D5 de P-033: lo que la sesion ha leido. Sin el, Write no comprueba nada (tests de otras piezas).
  readonly ledger?: ReadLedger;
}

// Lo que la sesion ha leido (o escrito) y con que mtime. `Write` sobre un fichero existente exige que
// este aqui con el mismo mtime que tiene en disco, como el CLI de Claude (B10 de la revision): asi no
// pisa un cambio que el usuario hizo despues de la ultima lectura del modelo.
export class ReadLedger {
  private readonly seen = new Map<string, number>();

  constructor(private readonly platform: string) {}

  record(path: string, mtimeMs: number): void {
    this.seen.set(this.key(path), mtimeMs);
  }

  mtimeOf(path: string): number | undefined {
    return this.seen.get(this.key(path));
  }

  // En win32 el FS no distingue mayusculas: `A.txt` y `a.txt` son el mismo fichero.
  private key(path: string): string {
    return this.platform === 'win32' ? path.toLowerCase() : path;
  }
}

const withFilePathAlias = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null) return raw;
  const record = raw as Record<string, unknown>;
  return record.file_path === undefined && typeof record.path === 'string' ? { ...record, file_path: record.path } : raw;
};

const WRITE_INPUT = z.preprocess(withFilePathAlias, z.object({ file_path: z.string().min(1), content: z.string() }));
const EDIT_INPUT = z.preprocess(
  withFilePathAlias,
  z.object({ file_path: z.string().min(1), old_string: z.string().min(1), new_string: z.string(), replace_all: z.boolean().optional() }),
);

function absolutePath(target: string, ctx: ToolContext, platform: string): string {
  return resolveToolPath(target, { cwd: ctx.cwd, extraDirs: ctx.extraDirs, platform }).absolute;
}

async function readOrNull(fs: EditToolsFs, path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export function createWriteTool(deps: EditToolsDeps): RuntimeTool<z.infer<typeof WRITE_INPUT>> {
  return {
    name: 'Write',
    kind: 'edit',
    description: 'Create a file or overwrite it with the given content.',
    fields: {
      file_path: { type: 'string', description: 'Path of the file', required: true },
      content: { type: 'string', description: 'Full content of the file', required: true },
    },
    input: WRITE_INPUT,
    run: async (input, ctx): Promise<ToolOutcome> => {
      const path = absolutePath(input.file_path, ctx, deps.platform);
      const before = await readOrNull(deps.fs, path);
      const stale = before === null ? null : await staleReason(deps, path);
      if (stale !== null) return fail(stale);
      await deps.fs.mkdir(dirname(path), { recursive: true });
      await deps.fs.writeFile(path, input.content, 'utf8');
      await recordWrite(deps, path);
      const lines = input.content.length === 0 ? 0 : input.content.split(/\r?\n/).length;
      return {
        isError: false,
        output: truncateOutput(`${before === null ? 'Creado' : 'Sobrescrito'} ${path} (${lines} líneas)`),
        // Fichero nuevo: sin hunks, el chat pinta el contenido entero.
        file: { path, content: input.content, structuredPatch: before === null ? [] : lineDiff(before, input.content) },
      };
    },
  };
}

export function createEditTool(deps: EditToolsDeps): RuntimeTool<z.infer<typeof EDIT_INPUT>> {
  let consecutiveFails = 0;
  const failed = (message: string): ToolOutcome => {
    consecutiveFails += 1;
    const hint = consecutiveFails >= EDIT_FAILS_BEFORE_HINT ? ' Si sigue fallando, reescribe el fichero entero con Write.' : '';
    return fail(`${message}${hint}`);
  };
  return {
    name: 'Edit',
    kind: 'edit',
    description: 'Replace an exact string in a file. old_string must appear exactly once unless replace_all is true. Read the file first.',
    fields: {
      file_path: { type: 'string', description: 'Path of the file', required: true },
      old_string: { type: 'string', description: 'Exact text to replace (with enough context to be unique)', required: true },
      new_string: { type: 'string', description: 'Replacement text', required: true },
      replace_all: { type: 'boolean', description: 'Replace every occurrence', required: false },
    },
    input: EDIT_INPUT,
    run: async (input, ctx): Promise<ToolOutcome> => {
      const path = absolutePath(input.file_path, ctx, deps.platform);
      if (input.old_string === input.new_string) return failed('old_string y new_string son iguales: no hay nada que cambiar.');
      const before = await readOrNull(deps.fs, path);
      if (before === null) return failed(`No existe el fichero: ${path}. Para crearlo usa Write.`);
      const { oldText, newText } = matchLineEndings(before, input.old_string, input.new_string);
      const count = countOccurrences(before, oldText);
      if (count === 0) return failed(`old_string no aparece en ${path}. Léelo con Read y copia el texto exacto.`);
      if (count > 1 && input.replace_all !== true) {
        return failed(`old_string aparece ${count} veces en ${path}: añade líneas de contexto para que sea única o usa replace_all.`);
      }
      const after = input.replace_all === true ? before.split(oldText).join(newText) : before.replace(oldText, () => newText);
      await deps.fs.writeFile(path, after, 'utf8');
      await recordWrite(deps, path);
      consecutiveFails = 0;
      return {
        isError: false,
        output: `Editado ${path}: ${input.replace_all === true ? count : 1} reemplazo(s)`,
        file: { path, content: null, structuredPatch: lineDiff(before, after) },
      };
    },
  };
}

// null = se puede sobrescribir. Si no, el motivo para el modelo.
async function staleReason(deps: EditToolsDeps, path: string): Promise<string | null> {
  if (deps.ledger === undefined) return null;
  const seen = deps.ledger.mtimeOf(path);
  if (seen === undefined) return `${path} ya existe y no lo has leído en esta conversación: léelo con Read antes de sobrescribirlo.`;
  const { mtimeMs } = await deps.fs.stat(path);
  return mtimeMs === seen ? null : `${path} ha cambiado desde que lo leíste: vuelve a leerlo con Read antes de sobrescribirlo.`;
}

// Lo que acaba de escribir la propia sesion cuenta como leido (Write tras Edit, o dos Write seguidos).
async function recordWrite(deps: EditToolsDeps, path: string): Promise<void> {
  if (deps.ledger === undefined) return;
  deps.ledger.record(path, (await deps.fs.stat(path)).mtimeMs);
}

// Un fichero con CRLF y un `old_string` con LF (lo normal en un modelo) no casarian nunca en Windows.
function matchLineEndings(file: string, oldText: string, newText: string): { oldText: string; newText: string } {
  if (!file.includes('\r\n') || oldText.includes('\r') || !oldText.includes('\n')) return { oldText, newText };
  const crlf = (text: string) => text.replace(/\r?\n/g, '\r\n');
  return { oldText: crlf(oldText), newText: crlf(newText) };
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count++;
  return count;
}
