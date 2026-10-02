import type { Dirent, Stats } from 'node:fs';
import { join, relative } from 'node:path';
import { createContext, Script } from 'node:vm';
import { z } from 'zod';
import { fail, ok, type RuntimeTool, type ToolContext } from './types';
import { resolveToolPath } from './pathGuard';
import type { ReadLedger } from './editTools';

// Las tres herramientas de LECTURA del runtime propio: Read, Glob y Grep. Asincronas, con topes (un
// arbol enorme no bloquea el hilo de main) y sin dependencias (ficha D6).

export const READ_MAX_LINES = 2_000;
export const READ_MAX_BYTES = 5 * 1024 * 1024;
export const GLOB_MAX_RESULTS = 200;
export const GREP_MAX_MATCHES = 200;
export const GREP_MAX_FILES = 5_000;
export const GREP_MAX_FILE_BYTES = 1024 * 1024;
const BINARY_SNIFF_BYTES = 8_000;
// A5: la expresion la escribe el modelo y corre en el hilo de `main`. Cada linea se recorta antes de
// probarla y cada fichero tiene un tope de tiempo: `vm` con `timeout` corta una expresion catastrofica
// (`(a+)+$` sobre una linea larga) en vez de congelar la app (medido en Node 24.16: corta a los 210 ms
// con un tope de 200). ponytail: tope por fichero en el mismo hilo; si hiciera falta mas, Grep a un
// `utilityProcess`.
export const GREP_MAX_LINE_CHARS = 2_000;
export const GREP_FILE_TIMEOUT_MS = 500;
const GREP_SHOWN_LINE_CHARS = 300;
const MATCH_SCRIPT = new Script(`
  found = [];
  for (let i = 0; i < lines.length && found.length < max; i++) {
    const line = lines[i].slice(0, maxLine);
    if (regex.test(line)) found.push([i + 1, line.slice(0, shown)]);
  }`);
// Directorios que nunca se recorren.
const IGNORED_DIRS = new Set(['.git', 'node_modules']);

export interface ReadToolsFs {
  readonly stat: (path: string) => Promise<Stats>;
  readonly readFile: (path: string) => Promise<Buffer>;
  readonly glob: (pattern: string, options: { cwd: string; withFileTypes: true; exclude: (entry: Dirent) => boolean }) => AsyncIterable<Dirent>;
}

export interface ReadToolsDeps {
  readonly fs: ReadToolsFs;
  readonly platform: string;
  // Sigue enlaces al clasificar los resultados de Glob/Grep (A3); ausente = lexico.
  readonly realpath?: (path: string) => string | null;
  // Lo que `Read` deja apuntado para que `Write` sepa que se leyo (D5 de P-033).
  readonly ledger?: ReadLedger;
}

// Los modelos pequeños escriben `path` donde el CLI usa `file_path`: se acepta como alias.
const withFilePathAlias = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null) return raw;
  const record = raw as Record<string, unknown>;
  return record.file_path === undefined && typeof record.path === 'string' ? { ...record, file_path: record.path } : raw;
};

const positiveInt = z.coerce.number().int().positive();

const READ_INPUT = z.preprocess(
  withFilePathAlias,
  z.object({ file_path: z.string().min(1), offset: positiveInt.optional(), limit: positiveInt.optional() }),
);

function absolutePath(target: string, ctx: ToolContext, platform: string): string {
  return resolveToolPath(target, { cwd: ctx.cwd, extraDirs: ctx.extraDirs, platform }).absolute;
}

// C2, segunda linea de defensa: un resultado de Glob/Grep vale si cae dentro de la carpeta de busqueda
// (que ya paso por la puerta) o del proyecto. Un patron `../**` o absoluto no saca nada de fuera aunque
// la puerta fallara.
function withinSearch(file: string, root: string, ctx: ToolContext, deps: ReadToolsDeps): boolean {
  const scope = { cwd: root, extraDirs: [ctx.cwd, ...ctx.extraDirs], platform: deps.platform, ...(deps.realpath === undefined ? {} : { realpath: deps.realpath }) };
  return resolveToolPath(file, scope).pathClass === 'inside';
}

export function createReadTool(deps: ReadToolsDeps): RuntimeTool<z.infer<typeof READ_INPUT>> {
  return {
    name: 'Read',
    kind: 'read',
    description: `Read a text file. Returns numbered lines (at most ${READ_MAX_LINES}; use offset/limit for more).`,
    fields: {
      file_path: { type: 'string', description: 'Path of the file (absolute or relative to the working directory)', required: true },
      offset: { type: 'number', description: 'First line to read (1-based)', required: false },
      limit: { type: 'number', description: 'Number of lines to read', required: false },
    },
    input: READ_INPUT,
    run: async (input, ctx) => {
      const path = absolutePath(input.file_path, ctx, deps.platform);
      const stats = await statOrNull(deps.fs, path);
      if (stats === null) return fail(`No existe el fichero: ${path}`);
      if (stats.isDirectory()) return fail(`${path} es un directorio: usa Glob para listarlo`);
      if (stats.size > READ_MAX_BYTES) return fail(`${path} ocupa ${stats.size} bytes (máximo ${READ_MAX_BYTES})`);
      const buffer = await deps.fs.readFile(path);
      if (isBinary(buffer)) return fail(`${path} es un fichero binario: Read solo lee texto`);
      deps.ledger?.record(path, stats.mtimeMs);
      return ok(numberLines(buffer.toString('utf8'), input.offset ?? 1, input.limit ?? READ_MAX_LINES, path));
    },
  };
}

function numberLines(text: string, offset: number, limit: number, path: string): string {
  if (text.length === 0) return `(${path} está vacío)`;
  const lines = text.split(/\r?\n/);
  if (offset > lines.length) return `(${path} tiene ${lines.length} líneas; offset ${offset} está fuera)`;
  const slice = lines.slice(offset - 1, offset - 1 + Math.min(limit, READ_MAX_LINES));
  const body = slice.map((line, i) => `${String(offset + i).padStart(6)}\t${line}`).join('\n');
  const rest = lines.length - (offset - 1 + slice.length);
  return rest > 0 ? `${body}\n[… ${rest} líneas más; usa offset ${offset + slice.length} …]` : body;
}

const GLOB_INPUT = z.object({ pattern: z.string().min(1), path: z.string().min(1).optional() });

export function createGlobTool(deps: ReadToolsDeps): RuntimeTool<z.infer<typeof GLOB_INPUT>> {
  return {
    name: 'Glob',
    kind: 'read',
    description: `Find files by glob pattern (e.g. "**/*.ts"). Ignores .git and node_modules. At most ${GLOB_MAX_RESULTS} results.`,
    fields: {
      pattern: { type: 'string', description: 'Glob pattern', required: true },
      path: { type: 'string', description: 'Directory to search in (default: working directory)', required: false },
    },
    input: GLOB_INPUT,
    run: async (input, ctx) => {
      const root = absolutePath(input.path ?? '.', ctx, deps.platform);
      const found: string[] = [];
      for await (const entry of walk(deps.fs, input.pattern, root, ctx.signal)) {
        if (!entry.isFile() || !withinSearch(joinEntry(entry), root, ctx, deps)) continue;
        found.push(relative(root, joinEntry(entry)) || entry.name);
        if (found.length >= GLOB_MAX_RESULTS) break;
      }
      if (found.length === 0) return ok(`Ningún fichero coincide con ${input.pattern} en ${root}`);
      const capped = found.length >= GLOB_MAX_RESULTS ? `\n[tope de ${GLOB_MAX_RESULTS} resultados: afina el patrón]` : '';
      return ok(found.sort().join('\n') + capped);
    },
  };
}

const GREP_INPUT = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).optional(),
  glob: z.string().min(1).optional(),
  '-i': z.boolean().optional(),
  output_mode: z.enum(['content', 'files_with_matches']).optional(),
});

export function createGrepTool(deps: ReadToolsDeps): RuntimeTool<z.infer<typeof GREP_INPUT>> {
  return {
    name: 'Grep',
    kind: 'read',
    description: `Search file contents with a JavaScript regular expression. Returns "file:line:text" (at most ${GREP_MAX_MATCHES} matches).`,
    fields: {
      pattern: { type: 'string', description: 'Regular expression', required: true },
      path: { type: 'string', description: 'File or directory to search (default: working directory)', required: false },
      glob: { type: 'string', description: 'Only files matching this glob (e.g. "*.ts")', required: false },
      '-i': { type: 'boolean', description: 'Case-insensitive', required: false },
      output_mode: { type: 'string', description: 'content (default) or files_with_matches', required: false, enum: ['content', 'files_with_matches'] },
    },
    input: GREP_INPUT,
    run: (input, ctx) => runGrep(input, ctx, deps),
  };
}

async function runGrep(input: z.infer<typeof GREP_INPUT>, ctx: ToolContext, deps: ReadToolsDeps) {
  let regex: RegExp;
  try {
    regex = new RegExp(input.pattern, input['-i'] === true ? 'i' : '');
  } catch (err) {
    return fail(`Expresión regular no válida ${JSON.stringify(input.pattern)}: ${(err as Error).message}`);
  }
  const root = absolutePath(input.path ?? '.', ctx, deps.platform);
  const files = await grepTargets(root, input.glob, ctx, deps);
  const filesOnly = input.output_mode === 'files_with_matches';
  const out: string[] = [];
  for (const file of files) {
    if (ctx.signal.aborted || out.length >= GREP_MAX_MATCHES) break;
    const text = await readTextOrNull(deps.fs, file);
    if (text === null) continue;
    const label = relative(root, file) || file;
    const matches = matchLines(text, regex, GREP_MAX_MATCHES - out.length);
    if (matches === null) return fail(`La expresión ${JSON.stringify(input.pattern)} tarda demasiado (más de ${GREP_FILE_TIMEOUT_MS} ms en ${label}): simplifícala.`);
    if (matches.length === 0) continue;
    if (filesOnly) out.push(label);
    else out.push(...matches.map(([line, content]) => `${label}:${line}:${content}`));
  }
  if (out.length === 0) return ok(`Sin coincidencias de ${input.pattern}`);
  return ok(out.join('\n') + (out.length >= GREP_MAX_MATCHES ? `\n[tope de ${GREP_MAX_MATCHES} coincidencias]` : ''));
}

// Un fichero suelto o los ficheros del directorio (con el filtro `glob`), hasta GREP_MAX_FILES.
// ponytail: recorre en Node con topes; si un repo grande lo hace notar, `@vscode/ripgrep` (ficha D6 b).
async function grepTargets(root: string, glob: string | undefined, ctx: ToolContext, deps: ReadToolsDeps): Promise<string[]> {
  const stats = await statOrNull(deps.fs, root);
  if (stats === null) return [];
  if (stats.isFile()) return [root];
  const pattern = glob === undefined ? '**/*' : glob.includes('/') ? glob : `**/${glob}`;
  const files: string[] = [];
  for await (const entry of walk(deps.fs, pattern, root, ctx.signal)) {
    if (entry.isFile() && withinSearch(joinEntry(entry), root, ctx, deps)) files.push(joinEntry(entry));
    if (files.length >= GREP_MAX_FILES) break;
  }
  return files;
}

// null = la expresion supero el tope de tiempo en este fichero.
function matchLines(text: string, regex: RegExp, max: number): Array<[number, string]> | null {
  const sandbox = createContext({ lines: text.split(/\r?\n/), regex, max, maxLine: GREP_MAX_LINE_CHARS, shown: GREP_SHOWN_LINE_CHARS, found: [] });
  try {
    MATCH_SCRIPT.runInContext(sandbox, { timeout: GREP_FILE_TIMEOUT_MS });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return null;
    throw err;
  }
  return sandbox.found as Array<[number, string]>;
}

async function* walk(fs: ReadToolsFs, pattern: string, root: string, signal: AbortSignal): AsyncIterable<Dirent> {
  const exclude = (entry: Dirent) => IGNORED_DIRS.has(entry.name);
  for await (const entry of fs.glob(pattern, { cwd: root, withFileTypes: true, exclude })) {
    if (signal.aborted) return;
    yield entry;
  }
}

// `parentPath` (Node >= 20.12) es la carpeta del resultado.
function joinEntry(entry: Dirent): string {
  return join(entry.parentPath, entry.name);
}

async function readTextOrNull(fs: ReadToolsFs, path: string): Promise<string | null> {
  const stats = await statOrNull(fs, path);
  if (stats === null || stats.size > GREP_MAX_FILE_BYTES) return null;
  const buffer = await fs.readFile(path);
  return isBinary(buffer) ? null : buffer.toString('utf8');
}

async function statOrNull(fs: ReadToolsFs, path: string): Promise<Stats | null> {
  try {
    return await fs.stat(path);
  } catch (err) {
    // Solo «no existe» es un resultado; cualquier otro fallo (permisos…) sube con su mensaje.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR') return null;
    throw err;
  }
}

export function isBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}
