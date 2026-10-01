import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEditTool, createWriteTool, EDIT_FAILS_BEFORE_HINT, type EditToolsDeps } from './editTools';
import type { ToolContext } from './types';

let dir = '';
const deps: EditToolsDeps = { fs: { readFile, writeFile, mkdir }, platform: process.platform };
const ctx = (): ToolContext => ({ cwd: dir, extraDirs: [], signal: new AbortController().signal });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mage-rt-edit-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('Write', () => {
  it('run_newFile_createsWithDirsAndNoHunks', async () => {
    const out = await createWriteTool(deps).run({ file_path: 'sub/n.txt', content: 'hola\n' }, ctx());

    expect(readFileSync(join(dir, 'sub', 'n.txt'), 'utf8')).toBe('hola\n');
    expect(out.output).toMatch(/^Creado/);
    expect(out.file).toEqual({ path: join(dir, 'sub', 'n.txt'), content: 'hola\n', structuredPatch: [] });
  });

  it('run_existingFile_overwritesWithDiff', async () => {
    writeFileSync(join(dir, 'a.txt'), 'uno\n');

    const out = await createWriteTool(deps).run({ file_path: 'a.txt', content: 'dos\n' }, ctx());

    expect(out.output).toMatch(/^Sobrescrito/);
    expect(out.file?.structuredPatch).toEqual([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-uno', '+dos'] }]);
  });
});

describe('Edit', () => {
  it('run_oneMatch_replacesAndReturnsPatch', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hola mundo\n');

    const out = await createEditTool(deps).run({ file_path: 'a.txt', old_string: 'mundo', new_string: 'Mage' }, ctx());

    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('hola Mage\n');
    expect(out.isError).toBe(false);
    expect(out.file?.structuredPatch).toEqual([{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-hola mundo', '+hola Mage'] }]);
  });

  it('run_zeroMatches_errorAndFileUntouched', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hola');

    const out = await createEditTool(deps).run({ file_path: 'a.txt', old_string: 'adiós', new_string: 'x' }, ctx());

    expect(out).toMatchObject({ isError: true, output: expect.stringContaining('no aparece') });
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('hola');
  });

  it('run_twoMatchesWithoutReplaceAll_errorWithCount', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x y x');

    const out = await createEditTool(deps).run({ file_path: 'a.txt', old_string: 'x', new_string: 'z' }, ctx());

    expect(out.output).toMatch(/aparece 2 veces/);
  });

  it('run_replaceAll_replacesEvery', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x y x');

    const out = await createEditTool(deps).run({ file_path: 'a.txt', old_string: 'x', new_string: 'z', replace_all: true }, ctx());

    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('z y z');
    expect(out.output).toMatch(/2 reemplazo/);
  });

  it('run_crlfFileWithLfOldString_stillMatches', async () => {
    writeFileSync(join(dir, 'w.txt'), 'a\r\nb\r\nc\r\n');

    await createEditTool(deps).run({ file_path: 'w.txt', old_string: 'a\nb', new_string: 'a\nB' }, ctx());

    expect(readFileSync(join(dir, 'w.txt'), 'utf8')).toBe('a\r\nB\r\nc\r\n');
  });

  it('run_repeatedFailures_suggestWrite', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hola');
    const edit = createEditTool(deps);
    let last = '';

    for (let i = 0; i < EDIT_FAILS_BEFORE_HINT; i++) last = (await edit.run({ file_path: 'a.txt', old_string: 'zz', new_string: 'x' }, ctx())).output;

    expect(last).toMatch(/Write/);
  });

  it('run_missingFile_pointsToWrite', async () => {
    const out = await createEditTool(deps).run({ file_path: 'no.txt', old_string: 'a', new_string: 'b' }, ctx());

    expect(out.output).toMatch(/usa Write/);
  });
});
