import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProjectFileService } from './projectFileService';

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
describe('A04 — frontera del panel de archivos', () => {
  it('A04_panelDeArchivos_junctionExterno_exigeAprobacion', () => {
    const { cwd, outside } = linkedFixture();
    const service = new ProjectFileService({
      exists: existsSync,
      readFile: (path) => readFileSync(path, 'utf8'),
      writeFile: (path, content) => writeFileSync(path, content),
      mtimeMs: (path) => existsSync(path) ? statSync(path).mtimeMs : null,
      byteLength: (path) => statSync(path).size,
      isAllowedOutsideCwd: () => false,
      isApprovedOutside: () => false,
    });
    const target = { cwd, path: 'linked/note.txt' };
    const result = service.read(target);
    // También se comprueba la escritura: un enlace no debe ampliar lo autorizado.
    if (result.content !== null) service.write({ ...target, content: 'sobrescrito sin aprobar', expectedMtimeMs: result.mtimeMs });
    expect({ outsideCwd: result.outsideCwd, content: readFileSync(join(outside, 'note.txt'), 'utf8') })
      .toEqual({ outsideCwd: true, content: 'contenido externo' });
  });

});

function diskService(approved: (path: string) => boolean = () => false) {
  return new ProjectFileService({ exists: existsSync, readFile: (p) => readFileSync(p, 'utf8'),
    writeFile: (p, content) => writeFileSync(p, content), mtimeMs: (p) => existsSync(p) ? statSync(p).mtimeMs : null,
    byteLength: (p) => statSync(p).size, isAllowedOutsideCwd: () => false, isApprovedOutside: approved });
}
describe('A04 — regresiones con sistema de archivos real', () => {
  it('enlaceInterno_conservaLecturaYCompareAndSwap', () => {
    const { cwd } = linkedFixture();
    mkdirSync(join(cwd, 'inside')); writeFileSync(join(cwd, 'inside', 'note.txt'), 'interno');
    symlinkSync(join(cwd, 'inside'), join(cwd, 'internal'), process.platform === 'win32' ? 'junction' : 'dir');
    const svc = diskService(); const target = { cwd, path: 'internal/note.txt' }; const read = svc.read(target);
    expect(read).toMatchObject({ content: 'interno', path: join(cwd, 'internal', 'note.txt') });
    svc.write({ ...target, content: 'nuevo', expectedMtimeMs: read.mtimeMs });
    expect(readFileSync(join(cwd, 'inside', 'note.txt'), 'utf8')).toBe('nuevo');
    expect(() => svc.write({ ...target, content: 'no', expectedMtimeMs: -1 })).toThrow(/cambió en disco/);
  });
  it('destinoInexistente_bajoEnlaceExterno_noLoCrea', () => {
    const { cwd, outside } = linkedFixture(); const svc = diskService(); const target = { cwd, path: 'linked/new.txt' };
    expect(svc.read(target)).toMatchObject({ outsideCwd: true, content: null });
    expect(() => svc.write({ ...target, content: 'no', expectedMtimeMs: null })).toThrow(/no está en la carpeta/);
    expect(existsSync(join(outside, 'new.txt'))).toBe(false);
  });
  it('destinoInexistenteInterno_sePuedeCrear', () => {
    const { cwd } = linkedFixture(); const svc = diskService(); const target = { cwd, path: 'new.txt' };
    expect(svc.read(target)).toMatchObject({ content: null });
    svc.write({ ...target, content: 'nuevo', expectedMtimeMs: null });
    expect(readFileSync(join(cwd, 'new.txt'), 'utf8')).toBe('nuevo');
    expect(svc.read({ cwd, path: 'new.txt/missing.txt' })).toMatchObject({ content: null });
  });
  it('enlaceRotoExterno_exigeAprobacionInclusoAntesDeExistirElDestino', () => {
    const { cwd, outside } = linkedFixture();
    symlinkSync(join(outside, 'missing'), join(cwd, 'broken'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(diskService().read({ cwd, path: 'broken/new.txt' })).toMatchObject({ outsideCwd: true, content: null });
    expect(() => diskService().write({ cwd, path: 'broken/new.txt', content: 'no', expectedMtimeMs: null })).toThrow(/no está en la carpeta/);
  });
  it('aprobacion_seConsultaPorDestinoReal_yNoAutorizaVecinos', () => {
    const { cwd, outside } = linkedFixture();
    const svc = diskService((p) => p === join(outside, 'note.txt'));
    expect(svc.read({ cwd, path: 'linked/note.txt' })).toMatchObject({ content: 'contenido externo' });
    expect(svc.read({ cwd, path: 'linked/other.txt' })).toMatchObject({ outsideCwd: true });
  });
  it.runIf(process.platform === 'win32')('rutaCortaWindows_equivaleAlCwdLargo', () => {
    const { cwd } = linkedFixture(); writeFileSync(join(cwd, 'note.txt'), 'interno');
    const short = spawnSync('cmd.exe', ['/d', '/c', 'for %I in ("' + cwd + '") do @echo %~sI'], { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true }).stdout.trim();
    expect(realpathSync.native(short)).toBe(cwd);
    expect(diskService().read({ cwd: short, path: join(cwd, 'note.txt') })).toMatchObject({ content: 'interno' });
    expect(diskService().read({ cwd: short, path: 'linked/note.txt' })).toMatchObject({ outsideCwd: true });
  });
});
