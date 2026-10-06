import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { assertTemporary, readOwnedWorkspace } from '../../spike/codex-verification.mjs';

const owned = [];
afterEach(() => {
  for (const dir of owned.splice(0).reverse()) {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith('mage-codex-')) throw new Error('Limpieza de test fuera del temporal');
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('assertTemporary', () => {
  it('readOwnedWorkspace_manifestYMarkerPropios_devuelveSoloSuWorkspace', () => {
    const home = mkdtempSync(join(tmpdir(), 'mage-codex-verify-home-'));
    const workspace = mkdtempSync(join(tmpdir(), 'mage-codex-verify-ws-'));
    owned.push(home, workspace);
    const owner = 'a17e12d7-495d-4f01-99af-494e04c61f2d';
    writeFileSync(join(home, 'mage-verification.json'), JSON.stringify({ format: 1, owner, workspace }));
    writeFileSync(join(workspace, '.mage-verification-owner'), owner);

    const result = readOwnedWorkspace(home);

    expect(result).toBe(workspace);
  });
  it('readOwnedWorkspace_sinManifest_prohibeReusarElPerfil', () => {
    const home = mkdtempSync(join(tmpdir(), 'mage-codex-verify-home-'));
    owned.push(home);

    const act = () => readOwnedWorkspace(home);

    expect(act).toThrow('El perfil temporal no tiene un manifiesto propio válido.');
  });

  it('readOwnedWorkspace_markerAjeno_rechazaElWorkspace', () => {
    const home = mkdtempSync(join(tmpdir(), 'mage-codex-verify-home-'));
    const workspace = mkdtempSync(join(tmpdir(), 'mage-codex-verify-ws-'));
    owned.push(home, workspace);
    writeFileSync(join(home, 'mage-verification.json'), JSON.stringify({ format: 1, owner: 'a17e12d7-495d-4f01-99af-494e04c61f2d', workspace }));
    writeFileSync(join(workspace, '.mage-verification-owner'), 'otro-propietario-artificial');

    const act = () => readOwnedWorkspace(home);

    expect(act).toThrow('El workspace temporal no pertenece a este perfil.');
  });
  it('assertTemporary_junctionHaciaPerfilFicticio_rechazaAntesDeUsarlo', () => {
    const target = mkdtempSync(join(tmpdir(), 'mage-codex-security-test-'));
    owned.push(target);
    const home = target.replace('mage-codex-security-test-', 'mage-codex-verify-home-');
    owned.push(home);
    mkdirSync(join(target, 'perfil-ficticio'));
    symlinkSync(join(target, 'perfil-ficticio'), home, 'junction');

    const act = () => assertTemporary(home, 'mage-codex-verify-home-');

    expect(act).toThrow('El temporal de verificación no puede ser un enlace.');
  });
});
