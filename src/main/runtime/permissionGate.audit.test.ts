import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeRealpath } from './tools/pathGuard';
import { createRuntimeGate } from './permissionGate';

const temporaryDirs: string[] = [];
function temporaryDir(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'mage-bug-audit-')));
  temporaryDirs.push(dir);
  return dir;
}
afterEach(() => {
  // Todos los destinos son directorios temporales creados explícitamente por este fichero.
  for (const dir of temporaryDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function linkedFixture() {
  const base = temporaryDir();
  const cwd = join(base, 'project');
  const outside = join(base, 'outside');
  mkdirSync(cwd); mkdirSync(outside);
  writeFileSync(join(outside, 'note.txt'), 'contenido externo');
  symlinkSync(outside, join(cwd, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  return { cwd, outside };
}
describe('A05 — frontera de Auto', () => {
  it('A05_auto_argumentoSinBarraAUnJunctionExterno_exigeAprobacion', () => {
    const { cwd } = linkedFixture();
    const gate = createRuntimeGate({ cwd, extraDirs: [], platform: process.platform, realpath: (path) => existsSync(path) ? realpathSync.native(path) : null });
    const call = { id: 'c', name: 'Bash', kind: 'exec' as const, input: { command: 'ls linked' } };
    expect(gate({ ...call, input: { command: 'ls ./linked' } }, 'auto')).toMatchObject({ verdict: 'ask' });
    expect(gate(call, 'auto')).toMatchObject({ verdict: 'ask' });
  });
});

describe('A05 — argumentos y enlaces reales', () => {
  it.each(['ls linked', 'ls ./linked', 'cat linked/note.txt', 'ls linked/new.txt', 'ls "linked"'])('%s_preguntaYNoPermiteRecordar', (command) => {
    const { cwd } = linkedFixture();
    const gate = createRuntimeGate({ cwd, extraDirs: [], platform: process.platform, realpath: nodeRealpath });
    expect(gate({ id: 'c', name: 'Bash', kind: 'exec', input: { command } }, 'auto')).toMatchObject({ verdict: 'ask', outside: expect.any(String) });
  });
  it('enlaceInterno_yNombreInexistente_mantienenAuto', () => {
    const { cwd } = linkedFixture(); mkdirSync(join(cwd, 'inside'));
    symlinkSync(join(cwd, 'inside'), join(cwd, 'internal'), process.platform === 'win32' ? 'junction' : 'dir');
    const gate = createRuntimeGate({ cwd, extraDirs: [], platform: process.platform, realpath: nodeRealpath });
    for (const command of ['ls internal', 'ls nonexistent', 'ls inside']) {
      expect(gate({ id: 'c', name: 'Bash', kind: 'exec', input: { command } }, 'auto')).toEqual({ verdict: 'allow' });
    }
  });
  it('enlaceRotoExterno_sinBarras_pregunta', () => {
    const { cwd, outside } = linkedFixture();
    symlinkSync(join(outside, 'missing'), join(cwd, 'broken'), process.platform === 'win32' ? 'junction' : 'dir');
    const gate = createRuntimeGate({ cwd, extraDirs: [], platform: process.platform, realpath: nodeRealpath });
    expect(gate({ id: 'c', name: 'Bash', kind: 'exec', input: { command: 'ls broken' } }, 'auto')).toMatchObject({ verdict: 'ask' });
  });
  it('nombreSinBarras_conEspaciosEntreComillas_pregunta', () => {
    const { cwd, outside } = linkedFixture();
    symlinkSync(outside, join(cwd, 'external folder'), process.platform === 'win32' ? 'junction' : 'dir');
    const gate = createRuntimeGate({ cwd, extraDirs: [], platform: process.platform, realpath: nodeRealpath });
    expect(gate({ id: 'c', name: 'Bash', kind: 'exec', input: { command: 'ls "external folder"' } }, 'auto')).toMatchObject({ verdict: 'ask' });
  });
});

describe('A05 — F1.9b, palabras POSIX y comodines', () => {
  it.each([
    'cat lin*/note.txt', 'cat ./lin*/note.txt', 'cat l?nked/note.txt',
    'cat [a-z]inked/note.txt', 'cat link""ed/note.txt', "cat li'nk'ed/note.txt",
    String.raw`cat lin\ked/note.txt`, 'cat "lin"ked/note.txt',
  ])('%s_exigePermisoExterno', (command) => {
    const { cwd } = linkedFixture();
    const gate = createRuntimeGate({ cwd, extraDirs: [], platform: process.platform, realpath: nodeRealpath });
    expect(gate({ id: 'c', name: 'Bash', kind: 'exec', input: { command } }, 'auto')).toMatchObject({ verdict: 'ask', outside: expect.any(String) });
  });

  it.each(['cat $X', 'cat `echo linked`', 'cat $(echo linked)', 'cat {linked,x}/note.txt'])(
    '%s_siguePreguntando', (command) => {
      const { cwd } = linkedFixture();
      const gate = createRuntimeGate({ cwd, extraDirs: [], platform: process.platform, realpath: nodeRealpath });
      expect(gate({ id: 'c', name: 'Bash', kind: 'exec', input: { command } }, 'auto')).toMatchObject({ verdict: 'ask' });
    },
  );

  it('globInterno_sinEnlacesExternos_permanecePermitido', () => {
    const { cwd } = linkedFixture();
    writeFileSync(join(cwd, 'one.ts'), 'fixture');
    writeFileSync(join(cwd, 'two.ts'), 'fixture');
    const gate = createRuntimeGate({ cwd, extraDirs: [], platform: process.platform, realpath: nodeRealpath });
    expect(gate({ id: 'c', name: 'Bash', kind: 'exec', input: { command: 'ls *.ts' } }, 'auto')).toEqual({ verdict: 'allow' });
  });
  it.each(['ls **/note.txt', 'ls [[:alpha:]]*', 'ls "unfinished'])('%s_expansionNoGarantizada_pregunta', command => {
    const { cwd } = linkedFixture();
    const gate = createRuntimeGate({ cwd, extraDirs: [], platform: process.platform, realpath: nodeRealpath });
    expect(gate({ id: 'c', name: 'Bash', kind: 'exec', input: { command } }, 'auto')).toMatchObject({ verdict: 'ask' });
  });
  it('enumeracionDenegada_preguntaEnVezDeAutorizar', () => {
    const { cwd } = linkedFixture();
    const gate = createRuntimeGate({ cwd, extraDirs: [], platform: process.platform, realpath: nodeRealpath,
      readDirectory: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
    expect(gate({ id: 'c', name: 'Bash', kind: 'exec', input: { command: 'ls *.ts' } }, 'auto')).toMatchObject({ verdict: 'ask' });
  });
  it.each(['ls "lin*"', String.raw`ls lin\*`])('%s_comodinLiteralNoSeExpande', command => {
    const { cwd } = linkedFixture();
    const gate = createRuntimeGate({ cwd, extraDirs: [], platform: process.platform, realpath: nodeRealpath });
    expect(gate({ id: 'c', name: 'Bash', kind: 'exec', input: { command } }, 'auto')).toEqual({ verdict: 'allow' });
  });
});
