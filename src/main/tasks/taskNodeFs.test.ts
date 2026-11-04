import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nodeDeliverableFs, nodeIsDirectory, nodeIsFile } from './taskNodeFs';

const root = mkdtempSync(join(tmpdir(), 'mage-task-fs-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('taskNodeFs', () => {
  it('nodeIsFile_ficheroCarpetaYAusente_distingue', () => {
    const file = join(root, 'a.txt');
    writeFileSync(file, 'hola');
    mkdirSync(join(root, 'dir'));

    expect(nodeIsFile(file)).toBe(true);
    expect(nodeIsFile(join(root, 'dir'))).toBe(false);
    expect(nodeIsDirectory(join(root, 'dir'))).toBe(true);
    expect(nodeIsDirectory(join(root, 'nada'))).toBe(false);
    expect(nodeIsFile(join(file, 'dentro'))).toBe(false);
  });

  it('deliverableFs_ficheroVacioYAusente_statYCanRead', () => {
    const empty = join(root, 'vacio.txt');
    writeFileSync(empty, '');

    expect(nodeDeliverableFs.stat(empty)).toMatchObject({ isFile: true, size: 0 });
    expect(nodeDeliverableFs.canRead(empty)).toBe(true);
    expect(nodeDeliverableFs.stat(join(root, 'nada'))).toBeNull();
    expect(nodeDeliverableFs.canRead(join(root, 'nada'))).toBe(false);
  });
});
