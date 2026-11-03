import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryCapabilityFs } from '../memoryCapabilityFs';
import { loadBundledCatalog } from '../catalog/libraryCatalog';
import {
  EMPTY_LIBRARY_STATE,
  findInstall,
  libraryStatePath,
  loadLibraryState,
  saveLibraryState,
  withInstall,
  withoutInstall,
  type LibraryInstallRecord,
  type LibraryState,
} from './libraryState';

const ROOT = resolve('/mage-test');
const ACCOUNT_A = join(ROOT, '.claude');
const ACCOUNT_B = join(ROOT, '.claude-b');
const STATE_PATH = libraryStatePath(join(ROOT, 'userData'));

function pkg() {
  const entry = loadBundledCatalog().find((e) => e.id === 'ecc-tdd-workflow');
  if (entry === undefined) throw new Error('Falta ecc-tdd-workflow en el catálogo');
  return entry.package;
}

function record(accountDir: string, enabled = true): LibraryInstallRecord {
  const p = pkg();
  return { packageId: p.id, engine: 'claude', accountDir, version: p.version, enabled, package: p };
}

function stateOf(...installs: LibraryInstallRecord[]): LibraryState {
  return { ...EMPTY_LIBRARY_STATE, installs };
}

describe('libraryState', () => {
  it('loadLibraryState_noFile_returnsEmpty', () => {
    const { fs } = createMemoryCapabilityFs();

    expect(loadLibraryState(fs, STATE_PATH)).toEqual(EMPTY_LIBRARY_STATE);
  });

  it('saveThenLoad_roundTrip_keepsRecords', () => {
    const { fs } = createMemoryCapabilityFs();
    const state = stateOf(record(ACCOUNT_A), record(ACCOUNT_B, false));

    saveLibraryState(fs, STATE_PATH, state);

    expect(loadLibraryState(fs, STATE_PATH)).toEqual(state);
  });

  it('loadLibraryState_corruptJson_throwsWithPath', () => {
    const { fs, put } = createMemoryCapabilityFs();
    put(STATE_PATH, '{ no es json');

    expect(() => loadLibraryState(fs, STATE_PATH)).toThrow(STATE_PATH);
  });

  it('loadLibraryState_relativeAccountDir_throws', () => {
    const { fs, put } = createMemoryCapabilityFs();
    put(STATE_PATH, JSON.stringify({ version: 1, installs: [{ ...record(ACCOUNT_A), accountDir: 'relativa/.claude' }] }));

    expect(() => loadLibraryState(fs, STATE_PATH)).toThrow(/accountDir/);
  });

  it('loadLibraryState_packageIdMismatch_throws', () => {
    const { fs, put } = createMemoryCapabilityFs();
    put(STATE_PATH, JSON.stringify({ version: 1, installs: [{ ...record(ACCOUNT_A), packageId: 'otro-paquete' }] }));

    expect(() => loadLibraryState(fs, STATE_PATH)).toThrow(/incoherente.*otro-paquete/);
  });

  it('findInstall_differentCaseOnWindows_findsIt', () => {
    const state = stateOf(record(ACCOUNT_A));

    const found = findInstall(state, { packageId: 'ecc-tdd-workflow', engine: 'claude', accountDir: ACCOUNT_A.toUpperCase() }, true);

    expect(found).not.toBeNull();
  });

  it('findInstall_differentCaseOnLinux_returnsNull', () => {
    const state = stateOf(record(ACCOUNT_A));

    const found = findInstall(state, { packageId: 'ecc-tdd-workflow', engine: 'claude', accountDir: ACCOUNT_A.toUpperCase() }, false);

    expect(found).toBeNull();
  });

  it('withInstall_existingKey_replacesInsteadOfDuplicating', () => {
    const state = stateOf(record(ACCOUNT_A, true));

    const next = withInstall(state, record(ACCOUNT_A, false), false);

    expect(next.installs).toHaveLength(1);
    expect(next.installs[0]?.enabled).toBe(false);
  });

  it('withoutInstall_otherAccountSamePackage_keepsIt', () => {
    const state = stateOf(record(ACCOUNT_A), record(ACCOUNT_B));

    const next = withoutInstall(state, record(ACCOUNT_B), false);

    expect(next.installs.map((r) => r.accountDir)).toEqual([ACCOUNT_A]);
  });

  it('libraryStatePath_relativeUserData_throws', () => {
    expect(() => libraryStatePath('userData')).toThrow('userData');
  });
});
