import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { UserFacingError } from '@shared/i18n/localizedText';
import type { LibraryTarget } from '@shared/ipc';
import { bundledContents, loadBundledCatalog } from '../catalog/libraryCatalog';
import type { CommandResult, CommandRunner } from '../commandRunner';
import { createMemoryCapabilityFs } from '../memoryCapabilityFs';
import { librarySecretId, type LibraryVault } from './librarySecrets';
import { LibraryService, type LibraryAccount, type LibraryServiceDeps } from './libraryService';
import { EMPTY_LIBRARY_STATE, libraryStatePath, saveLibraryState, type LibraryInstallRecord } from './libraryState';

// Ruta `mageMcp` del servicio: MCP con clave (Exa) cuya clave vive en la bóveda y nunca en el disco.
const ROOT = resolve('/mage-test');
const USER_DATA = join(ROOT, 'userData');
const CLAUDE_A = join(ROOT, '.claude');
const CODEX_A = join(ROOT, '.codex');
const ACCOUNTS: readonly LibraryAccount[] = [
  { configDir: CLAUDE_A, engine: 'claude' },
  { configDir: CODEX_A, engine: 'codex' },
];
const OK: CommandResult = { exitCode: 0, stdout: '', stderr: '' };
const EXA = 'exa-mcp';
const SECRET_VALUE = 'sk-exa-valor-secreto-9f8e7d';
const EXA_SECRETS = { EXA_API_KEY: SECRET_VALUE };

function setup() {
  const mem = createMemoryCapabilityFs();
  const runner = vi.fn<CommandRunner>(async () => OK);
  const vaultMap = new Map<string, string>();
  const vault: LibraryVault = {
    get: (id) => vaultMap.get(id) ?? null,
    set: (id, value) => void vaultMap.set(id, value),
    has: (id) => vaultMap.has(id),
    delete: (id) => void vaultMap.delete(id),
  };
  const deps: LibraryServiceDeps = {
    catalog: loadBundledCatalog(),
    contentsOf: bundledContents,
    fs: mem.fs,
    userDataDir: USER_DATA,
    platform: 'linux',
    caseInsensitivePaths: false,
    listAccounts: () => ACCOUNTS,
    binaryFor: (engine) => `/bin/${engine}`,
    runner,
    baseEnv: () => ({ PATH: 'x' }),
    isCommandAvailable: () => true,
    vault,
  };
  return { service: new LibraryService(deps), mem, runner, deps, vault: vaultMap };
}
type Harness = ReturnType<typeof setup>;

const target = (packageId: string, accountDir: string, engine: 'claude' | 'codex' = 'claude'): LibraryTarget => ({ packageId, engine, accountDir });
const exaVaultId = (): string => librarySecretId({ packageId: EXA, engine: 'claude', accountDir: CLAUDE_A }, 'EXA_API_KEY', false);

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba un rechazo y la promesa se resolvió');
}

function keyOf(error: unknown): string | undefined {
  return error instanceof UserFacingError ? error.localized.key : undefined;
}

function seedExa(h: Harness, over: { enabled: boolean; version?: string; withKey?: boolean }): void {
  const entry = h.deps.catalog.find((e) => e.id === EXA);
  if (entry === undefined) throw new Error('Falta exa-mcp en el catálogo');
  const version = over.version ?? entry.package.version;
  const record: LibraryInstallRecord = {
    packageId: EXA, engine: 'claude', accountDir: CLAUDE_A, version, enabled: over.enabled, package: { ...entry.package, version },
  };
  saveLibraryState(h.mem.fs, libraryStatePath(USER_DATA), { ...EMPTY_LIBRARY_STATE, installs: [record] });
  if (over.withKey !== false) h.vault.set(exaVaultId(), SECRET_VALUE);
}

describe('LibraryService.apply (MCP con clave, ruta mageMcp)', () => {
  it('install_mageMcpConClave_guardaEnBovedaYRegistro', async () => {
    const h = setup();

    const result = await h.service.apply('install', target(EXA, CLAUDE_A), EXA_SECRETS);

    expect(result).toEqual({ status: 'done', appliesOnNextSession: true });
    expect(h.vault.get(exaVaultId())).toBe(SECRET_VALUE);
    expect(h.service.view().installs.map((i) => [i.packageId, i.enabled, i.keyed])).toEqual([[EXA, true, true]]);
  });

  it('install_mageMcp_estadoEnDiscoNoContieneLaClave', async () => {
    const h = setup();

    await h.service.apply('install', target(EXA, CLAUDE_A), EXA_SECRETS);

    const written = [...h.mem.files.values()].map((data) => data.toString('utf8')).join('\n');
    expect(written.length).toBeGreaterThan(0);
    expect(written).not.toContain(SECRET_VALUE);
  });

  it('install_mageMcp_noEjecutaComandos', async () => {
    const h = setup();

    await h.service.apply('install', target(EXA, CLAUDE_A), EXA_SECRETS);
    await h.service.apply('install', target(EXA, CODEX_A, 'codex'), EXA_SECRETS);

    expect(h.runner).not.toHaveBeenCalled();
  });

  it.each<Record<string, string> | undefined>([undefined, {}, { EXA_API_KEY: '   ' }])('install_mageMcpSinClave_errorSinValores', async (secrets) => {
    const h = setup();

    const error = await rejection(h.service.apply('install', target(EXA, CLAUDE_A), secrets));

    expect(keyOf(error)).toBe('library.error.secretsRequired');
    expect(JSON.stringify((error as UserFacingError).localized)).toContain('EXA_API_KEY');
    expect(h.vault.size).toBe(0);
  });

  it('install_mageMcpClaveDeMas_error', async () => {
    const h = setup();

    const error = await rejection(h.service.apply('install', target(EXA, CLAUDE_A), { ...EXA_SECRETS, OTRA: SECRET_VALUE }));

    expect(keyOf(error)).toBe('library.error.secretsRequired');
    expect(JSON.stringify((error as UserFacingError).localized)).not.toContain(SECRET_VALUE);
    expect(h.vault.size).toBe(0);
  });

  it('install_mageMcpFalloAlGuardar_borraLaBoveda', async () => {
    const h = setup();
    h.mem.failNext('writeFile', 'library.json');

    await expect(h.service.apply('install', target(EXA, CLAUDE_A), EXA_SECRETS)).rejects.toThrow();

    expect(h.vault.size).toBe(0);
  });

  it('apply_secretosEnOtraAccion_lanza', async () => {
    const h = setup();
    seedExa(h, { enabled: true });

    const onKeyed = await rejection(h.service.apply('disable', target(EXA, CLAUDE_A), EXA_SECRETS));
    const onNative = await rejection(h.service.apply('install', target('context7', CLAUDE_A), EXA_SECRETS));

    for (const error of [onKeyed, onNative]) {
      expect((error as Error).message).toMatch(/Secretos solo al instalar/);
      expect((error as Error).message).not.toContain(SECRET_VALUE);
    }
    expect(h.runner).not.toHaveBeenCalled();
  });

  it('disable_mageMcp_soloRegistro', async () => {
    const h = setup();
    seedExa(h, { enabled: true });

    await h.service.apply('disable', target(EXA, CLAUDE_A));

    expect(h.service.view().installs[0]?.enabled).toBe(false);
    expect(h.vault.has(exaVaultId())).toBe(true);
    expect(h.runner).not.toHaveBeenCalled();
  });

  it('enable_mageMcpSinClaveEnBoveda_secretsChanged', async () => {
    const h = setup();
    seedExa(h, { enabled: false, withKey: false });

    const error = await rejection(h.service.apply('enable', target(EXA, CLAUDE_A)));

    expect(keyOf(error)).toBe('library.error.secretsChanged');
  });

  it('enable_mageMcpConClave_activaSinPedirla', async () => {
    const h = setup();
    seedExa(h, { enabled: false });

    await h.service.apply('enable', target(EXA, CLAUDE_A));

    expect(h.service.view().installs[0]?.enabled).toBe(true);
    expect(h.runner).not.toHaveBeenCalled();
  });

  it('remove_mageMcp_borraBovedaYRegistro', async () => {
    const h = setup();
    seedExa(h, { enabled: true });

    await h.service.apply('remove', target(EXA, CLAUDE_A));

    expect(h.vault.size).toBe(0);
    expect(h.service.view().installs).toEqual([]);
  });

  it('update_mageMcpMismaClave_actualizaVersion', async () => {
    const h = setup();
    seedExa(h, { enabled: true, version: '0.0.1' });

    await h.service.apply('update', target(EXA, CLAUDE_A));

    const entry = h.deps.catalog.find((e) => e.id === EXA);
    expect(h.service.view().installs[0]?.version).toBe(entry?.package.version);
    expect(h.vault.has(exaVaultId())).toBe(true);
    expect(h.runner).not.toHaveBeenCalled();
  });

  it('update_mageMcpSinClaveEnBoveda_secretsChanged', async () => {
    const h = setup();
    seedExa(h, { enabled: true, version: '0.0.1', withKey: false });

    const error = await rejection(h.service.apply('update', target(EXA, CLAUDE_A)));

    expect(keyOf(error)).toBe('library.error.secretsChanged');
  });

  it('view_mageMcp_keyedTrue', () => {
    const h = setup();
    seedExa(h, { enabled: true });

    expect(h.service.view().installs.map((i) => i.keyed)).toEqual([true]);
  });
});
