import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkDeliverables, type DeliverableFs } from './deliverableChecker';

const WORK = resolve('/work');
const EXTRA = resolve('/extra');
const scope = (caseInsensitive = false, folders: readonly string[] = [WORK, EXTRA]) => ({ folders, caseInsensitive });

// FS falso: `files` son ficheros legibles; `dirs` directorios; `unreadable` ficheros sin permiso.
function fakeFs(files: readonly string[], dirs: readonly string[] = [], unreadable: readonly string[] = []) {
  const stat = vi.fn((path: string) => {
    if (dirs.includes(path)) return { isFile: false, size: 0, mtimeMs: 1 };
    if (files.includes(path) || unreadable.includes(path)) return { isFile: true, size: 12, mtimeMs: 1234.9 };
    return null;
  });
  const canRead = vi.fn((path: string) => !unreadable.includes(path));
  const fs: DeliverableFs = { stat, canRead };
  return { fs, stat, canRead };
}

describe('checkDeliverables', () => {
  it('checkDeliverables_relativaExistente_ok', () => {
    const { fs } = fakeFs([resolve(WORK, 'report.md')]);

    const [check] = checkDeliverables(['report.md'], scope(), fs);

    expect(check).toMatchObject({ declared: 'report.md', path: resolve(WORK, 'report.md'), status: 'ok', bytes: 12, modifiedAtMs: 1234, kind: 'md' });
  });

  it('checkDeliverables_absolutaDentroDeSegundaCarpeta_ok', () => {
    const target = resolve(EXTRA, 'sub', 'a.txt');
    const { fs } = fakeFs([target]);

    const [check] = checkDeliverables([target], scope(), fs);

    expect(check?.status).toBe('ok');
  });

  it('checkDeliverables_noExiste_missing', () => {
    const { fs } = fakeFs([]);

    const [check] = checkDeliverables(['nada.md'], scope(), fs);

    expect(check).toMatchObject({ status: 'missing', bytes: null, modifiedAtMs: null });
  });

  it('checkDeliverables_directorio_notFile', () => {
    const { fs } = fakeFs([], [resolve(WORK, 'out')]);

    const [check] = checkDeliverables(['out'], scope(), fs);

    expect(check).toMatchObject({ status: 'notFile', bytes: null });
  });

  it('checkDeliverables_sinPermisoDeLectura_unreadable', () => {
    const { fs } = fakeFs([], [], [resolve(WORK, 'x.bin')]);

    const [check] = checkDeliverables(['x.bin'], scope(), fs);

    expect(check).toMatchObject({ status: 'unreadable', bytes: 12, modifiedAtMs: 1234 });
  });

  it('checkDeliverables_escapaConPuntoPunto_outsideScopeSinTocarFs', () => {
    const { fs, stat, canRead } = fakeFs([resolve('/secret.txt')]);

    const [check] = checkDeliverables(['../secret.txt'], scope(), fs);

    expect(check).toMatchObject({ status: 'outsideScope', bytes: null, modifiedAtMs: null });
    expect(stat).not.toHaveBeenCalled();
    expect(canRead).not.toHaveBeenCalled();
  });

  it('checkDeliverables_mayusculasEnWindows_dentro', () => {
    const { fs } = fakeFs([resolve(WORK, 'a.md')]);

    const [check] = checkDeliverables([resolve(WORK).toUpperCase() + '/a.md'], scope(true), fs);

    expect(check?.status).not.toBe('outsideScope');
  });

  it('checkDeliverables_mayusculasSensible_fuera', () => {
    const { fs, stat } = fakeFs([]);

    const [check] = checkDeliverables([resolve(WORK).toUpperCase() + '/a.md'], scope(false), fs);

    expect(check?.status).toBe('outsideScope');
    expect(stat).not.toHaveBeenCalled();
  });

  it('checkDeliverables_duplicadas_unaEntrada', () => {
    const { fs } = fakeFs([resolve(WORK, 'a.md')]);

    const checks = checkDeliverables(['a.md', './a.md', resolve(WORK, 'a.md')], scope(), fs);

    expect(checks).toHaveLength(1);
    expect(checks[0]?.declared).toBe('a.md');
  });

  it('checkDeliverables_sinCarpetas_lanzaConValor', () => {
    const { fs } = fakeFs([]);

    expect(() => checkDeliverables(['a.md'], scope(false, []), fs)).toThrow('[]');
    expect(() => checkDeliverables(['a.md'], scope(false, ['relativa']), fs)).toThrow('relativa');
  });

  it('checkDeliverables_extension_kindEnMinusculas', () => {
    const { fs } = fakeFs([resolve(WORK, 'Foto.PNG'), resolve(WORK, 'LICENSE')]);

    const checks = checkDeliverables(['Foto.PNG', 'LICENSE'], scope(), fs);

    expect(checks.map((check) => check.kind)).toEqual(['png', '']);
  });
});
