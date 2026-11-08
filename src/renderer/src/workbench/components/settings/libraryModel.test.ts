import { describe, expect, it } from 'vitest';
import type { LibraryAccountView, LibraryBlock, LibraryEntryView, LibraryInstallView, LibraryKind, LibraryView } from '@shared/ipc';
import { blockKey, canInstallKeyed, cardActions, filterEntries, indexInstalls, installKey, keyedFieldsFor, kindFilters, resultKey, selectedAccount, shortCommit } from './libraryModel';

const entry = (id: string, kind: LibraryKind): LibraryEntryView =>
  ({ id, kind, title: id, summary: '', publisher: '', version: '1', engines: [], platforms: [], scopes: ['user'] }) as unknown as LibraryEntryView;
const install = (over: Partial<LibraryInstallView> = {}): LibraryInstallView => ({
  packageId: 'p', engine: 'claude', accountDir: '/a', version: '1', enabled: true, inCatalog: true, updateAvailable: false, keyed: false, ...over,
});
const account = (accountDir: string): LibraryAccountView => ({ accountDir, engine: 'claude', label: accountDir });
const viewOf = (accounts: readonly LibraryAccountView[]): LibraryView => ({ platform: 'win32', accounts, entries: [], installs: [] });

describe('kindFilters', () => {
  it('kindFilters_skillsPluginAndMcp_returnsAllThenPresentKindsInOrder', () => {
    const entries = [entry('a', 'plugin'), entry('b', 'skill'), entry('c', 'mcp')];

    expect(kindFilters(entries)).toEqual(['all', 'skill', 'mcp', 'plugin']);
  });

  it('kindFilters_empty_returnsOnlyAll', () => {
    expect(kindFilters([])).toEqual(['all']);
  });
});

describe('filterEntries', () => {
  it('filterEntries_mcp_returnsOnlyMcp', () => {
    const entries = [entry('a', 'skill'), entry('b', 'mcp')];

    expect(filterEntries(entries, 'mcp').map((e) => e.id)).toEqual(['b']);
    expect(filterEntries(entries, 'all')).toHaveLength(2);
  });
});

describe('cardActions', () => {
  it('cardActions_notInstalled_returnsPreviewOnly', () => {
    expect(cardActions(null)).toEqual(['preview']);
  });

  it('cardActions_enabledWithUpdate_returnsUpdateDisableRemove', () => {
    expect(cardActions(install({ updateAvailable: true }))).toEqual(['update', 'disable', 'remove']);
  });

  it('cardActions_enabledUpToDate_returnsDisableRemove', () => {
    expect(cardActions(install())).toEqual(['disable', 'remove']);
  });

  it('cardActions_disabled_returnsEnableRemove', () => {
    expect(cardActions(install({ enabled: false }))).toEqual(['enable', 'remove']);
  });
});

describe('indexInstalls', () => {
  it('indexInstalls_sameIdTwoAccounts_keepsBoth', () => {
    const one = install({ accountDir: '/a' });
    const two = install({ accountDir: '/b' });

    const index = indexInstalls([one, two]);

    expect(index.get(installKey('p', 'claude', '/a'))).toBe(one);
    expect(index.get(installKey('p', 'claude', '/b'))).toBe(two);
  });
});

describe('selectedAccount', () => {
  it('selectedAccount_missingDir_fallsBackToFirst', () => {
    const view = viewOf([account('/a'), account('/b')]);

    expect(selectedAccount(view, '/b')?.accountDir).toBe('/b');
    expect(selectedAccount(view, '/gone')?.accountDir).toBe('/a');
    expect(selectedAccount(view, null)?.accountDir).toBe('/a');
  });

  it('selectedAccount_noAccounts_returnsNull', () => {
    expect(selectedAccount(viewOf([]), '/a')).toBeNull();
  });
});

describe('message keys', () => {
  it('blockKey_everyBlock_hasKey', () => {
    const blocks: LibraryBlock[] = ['engineNotDeclared', 'platformUnsupported', 'needsSecrets', 'kindNotInstallable', 'codexSkillsUnmeasured'];

    for (const block of blocks) expect(blockKey(block)).toBe(`library.block.${block}`);
  });

  it('resultKey_everyStatus_hasKey', () => {
    expect(resultKey({ status: 'done', appliesOnNextSession: true })).toBe('library.result.done');
    expect(resultKey({ status: 'collision', items: [] })).toBe('library.result.collision');
    expect(resultKey({ status: 'modifiedByUser', items: [] })).toBe('library.result.modifiedByUser');
    expect(resultKey({ status: 'rolledBack', detail: '' })).toBe('library.result.rolledBack');
  });
});

describe('shortCommit', () => {
  it('shortCommit_full_returnsSeven', () => {
    expect(shortCommit('0123456789abcdef')).toBe('0123456');
  });

  it('shortCommit_null_returnsNull', () => {
    expect(shortCommit(null)).toBeNull();
  });
});

describe('keyedFieldsFor', () => {
  it('keyedFieldsFor_mageMcp_nombres', () => {
    expect(keyedFieldsFor({ route: 'mageMcp', block: null, requiresSecrets: ['EXA_API_KEY'] })).toEqual(['EXA_API_KEY']);
  });

  it('keyedFieldsFor_native_vacio', () => {
    expect(keyedFieldsFor({ route: 'native', block: null, requiresSecrets: [] })).toEqual([]);
    expect(keyedFieldsFor({ route: null, block: 'engineNotDeclared', requiresSecrets: ['EXA_API_KEY'] })).toEqual([]);
  });
});

describe('canInstallKeyed', () => {
  it('canInstallKeyed_faltaUno_false', () => {
    expect(canInstallKeyed(['A', 'B'], { A: 'x' })).toBe(false);
  });

  it('canInstallKeyed_soloEspacios_false', () => {
    expect(canInstallKeyed(['A'], { A: '   ' })).toBe(false);
  });

  it('canInstallKeyed_todos_true', () => {
    expect(canInstallKeyed(['A', 'B'], { A: 'x', B: ' y ' })).toBe(true);
  });

  it('canInstallKeyed_sinCampos_true', () => {
    expect(canInstallKeyed([], {})).toBe(true);
  });
});
