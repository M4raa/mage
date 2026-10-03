import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { glob, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGlobTool, createGrepTool, createReadTool, GLOB_MAX_RESULTS, GREP_MAX_LINE_CHARS, type ReadToolsDeps } from './readTools';
import type { ToolContext } from './types';

let dir = '';
const deps: ReadToolsDeps = { fs: { stat, readFile, glob: glob as unknown as ReadToolsDeps['fs']['glob'] }, platform: process.platform };
const ctx = (): ToolContext => ({ cwd: dir, extraDirs: [], signal: new AbortController().signal });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mage-rt-tools-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('Read', () => {
  const read = createReadTool(deps);

  it('run_textFile_numbersLines', async () => {
    writeFileSync(join(dir, 'a.txt'), 'uno\ndos\n');

    const out = await read.run({ file_path: 'a.txt' }, ctx());

    expect(out).toEqual({ isError: false, output: '     1\tuno\n     2\tdos\n     3\t' });
  });

  it('run_offsetAndLimit_readsWindowAndSaysWhatRemains', async () => {
    writeFileSync(join(dir, 'a.txt'), 'l1\nl2\nl3\nl4');

    const out = await read.run({ file_path: 'a.txt', offset: 2, limit: 1 }, ctx());

    expect(out.output).toBe('     2\tl2\n[… 2 líneas más; usa offset 3 …]');
  });

  it('run_emptyFile_saysEmpty', async () => {
    writeFileSync(join(dir, 'v.txt'), '');

    expect((await read.run({ file_path: 'v.txt' }, ctx())).output).toMatch(/vacío/);
  });

  it('run_binaryFile_errorExplained', async () => {
    writeFileSync(join(dir, 'b.bin'), Buffer.from([1, 0, 2]));

    const out = await read.run({ file_path: 'b.bin' }, ctx());

    expect(out.isError).toBe(true);
    expect(out.output).toMatch(/binario/);
  });

  it('run_missingFile_errorWithPath', async () => {
    const out = await read.run({ file_path: 'no.txt' }, ctx());

    expect(out).toMatchObject({ isError: true, output: expect.stringContaining('no.txt') });
  });

  it('input_pathAlias_acceptedAsFilePath', () => {
    expect(read.input.parse({ path: 'x' })).toMatchObject({ file_path: 'x' });
  });
});

describe('Glob', () => {
  const globTool = createGlobTool(deps);

  it('run_pattern_listsFilesIgnoringNodeModulesAndGit', async () => {
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'node_modules'));
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, 'src', 'a.ts'), '');
    writeFileSync(join(dir, 'node_modules', 'b.ts'), '');
    writeFileSync(join(dir, '.git', 'c.ts'), '');

    const out = await globTool.run({ pattern: '**/*.ts' }, ctx());

    expect(out.output.split('\n')).toEqual([join('src', 'a.ts')]);
  });

  it('run_noMatches_saysSo', async () => {
    expect((await globTool.run({ pattern: '*.nada' }, ctx())).output).toMatch(/Ningún fichero/);
  });

  it('run_capReached_stopsAndWarns', async () => {
    for (let i = 0; i < GLOB_MAX_RESULTS + 5; i++) writeFileSync(join(dir, `f${i}.txt`), '');

    const out = await globTool.run({ pattern: '*.txt' }, ctx());

    expect(out.output.split('\n').filter((line) => line.endsWith('.txt'))).toHaveLength(GLOB_MAX_RESULTS);
    expect(out.output).toMatch(/tope/);
  });
});

describe('Grep', () => {
  const grep = createGrepTool(deps);

  it('run_regex_returnsFileLineText', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hola\nmundo\nHola otra vez');

    const out = await grep.run({ pattern: 'hola', '-i': true }, ctx());

    expect(out.output.split('\n')).toEqual(['a.txt:1:hola', 'a.txt:3:Hola otra vez']);
  });

  it('run_filesOnlyAndGlob_filtersFiles', async () => {
    writeFileSync(join(dir, 'a.ts'), 'x');
    writeFileSync(join(dir, 'b.md'), 'x');

    const out = await grep.run({ pattern: 'x', glob: '*.ts', output_mode: 'files_with_matches' }, ctx());

    expect(out.output).toBe('a.ts');
  });

  it('run_noMatches_saysSo', async () => {
    writeFileSync(join(dir, 'a.txt'), 'nada');

    expect((await grep.run({ pattern: 'zzz' }, ctx())).output).toMatch(/Sin coincidencias/);
  });

  it('run_invalidRegex_errorWithPattern', async () => {
    const out = await grep.run({ pattern: '(' }, ctx());

    expect(out).toMatchObject({ isError: true, output: expect.stringContaining('"("') });
  });

  it('run_binaryFile_skipped', async () => {
    writeFileSync(join(dir, 'b.bin'), Buffer.from('x\0x'));

    expect((await grep.run({ pattern: 'x' }, ctx())).output).toMatch(/Sin coincidencias/);
  });
});

// C2: aunque la puerta fallara, un patron que sale de la carpeta de busqueda no devuelve nada de fuera.
describe('Glob y Grep fuera del proyecto (C2)', () => {
  const insideCtx = (): ToolContext => ({ cwd: join(dir, 'proj'), extraDirs: [], signal: new AbortController().signal });

  beforeEach(() => {
    mkdirSync(join(dir, 'proj'));
    writeFileSync(join(dir, 'secreto.txt'), 'KEY=123');
    writeFileSync(join(dir, 'proj', 'a.txt'), 'KEY=dentro');
  });

  it('glob_patternWithParentSegments_returnsNothingOutside', async () => {
    const out = await createGlobTool(deps).run({ pattern: '../*.txt' }, insideCtx());

    expect(out.output).not.toMatch(/secreto/);
  });

  it('glob_absolutePatternOutside_returnsNothingOutside', async () => {
    const out = await createGlobTool(deps).run({ pattern: `${dir.replaceAll('\\', '/')}/*.txt` }, insideCtx());

    expect(out.output).not.toMatch(/secreto/);
  });

  it('grep_globOutsideCwd_returnsNothing', async () => {
    const out = await createGrepTool(deps).run({ pattern: 'KEY', glob: '../*.txt' }, insideCtx());

    expect(out.output).not.toMatch(/123/);
  });

  it('grep_globInside_stillFinds', async () => {
    const out = await createGrepTool(deps).run({ pattern: 'KEY', glob: '*.txt' }, insideCtx());

    expect(out.output).toBe('a.txt:1:KEY=dentro');
  });
});

describe('Grep con una expresion catastrofica (A5)', () => {
  it('grep_catastrophicRegex_failsWithinBudgetInsteadOfFreezing', async () => {
    writeFileSync(join(dir, 'min.js'), `${'a'.repeat(40)}b`);
    const started = Date.now();

    const out = await createGrepTool(deps).run({ pattern: '(a+)+$' }, ctx());

    expect(out).toMatchObject({ isError: true, output: expect.stringContaining('tarda demasiado') });
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('grep_longLine_matchesWithinFirstChars', async () => {
    writeFileSync(join(dir, 'largo.txt'), `${'x'.repeat(GREP_MAX_LINE_CHARS)}FIN`);

    expect((await createGrepTool(deps).run({ pattern: 'FIN' }, ctx())).output).toMatch(/Sin coincidencias/);
  });
});
