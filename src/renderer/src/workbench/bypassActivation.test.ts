import { describe, expect, it } from 'vitest';
import { bypassActivatedTabs } from './bypassActivation';
import type { Tab } from './types';

function tab(id: string, overrides: Partial<Tab> = {}): Tab {
  return { id, accountId: 'acc', accountAlias: 'acc', cwd: 'C:/p', model: 'sonnet', provider: 'claude', title: id, privacy: 'shared', ...overrides };
}

const ids = (tabs: readonly Tab[]): string[] => tabs.map((t) => t.id);

describe('bypassActivatedTabs (#1)', () => {
  it('bypassActivatedTabs_pasaDeOtroModoABypass_laDevuelve', () => {
    const before = [tab('a', { permissionMode: 'default' }), tab('b')];

    const after = [tab('a', { permissionMode: 'bypassPermissions' }), tab('b')];

    expect(ids(bypassActivatedTabs(before, after))).toEqual(['a']);
  });

  it('bypassActivatedTabs_sinModoPrevio_tambienEsActivacion', () => {
    expect(ids(bypassActivatedTabs([tab('a')], [tab('a', { permissionMode: 'bypassPermissions' })]))).toEqual(['a']);
  });

  it('bypassActivatedTabs_yaEstabaEnBypass_noAvisa', () => {
    const active = [tab('a', { permissionMode: 'bypassPermissions', title: 'antes' })];

    expect(bypassActivatedTabs(active, [tab('a', { permissionMode: 'bypassPermissions', title: 'despues' })])).toEqual([]);
  });

  it('bypassActivatedTabs_pestanaNuevaORestauradaEnBypass_noAvisa', () => {
    expect(bypassActivatedTabs([], [tab('a', { permissionMode: 'bypassPermissions' })])).toEqual([]);
  });

  it('bypassActivatedTabs_desactivar_noAvisa', () => {
    expect(bypassActivatedTabs([tab('a', { permissionMode: 'bypassPermissions' })], [tab('a', { permissionMode: 'default' })])).toEqual([]);
  });

  it('bypassActivatedTabs_proveedorSinEseAviso_noAvisa', () => {
    expect(bypassActivatedTabs([tab('a', { provider: 'codex' })], [tab('a', { provider: 'codex', permissionMode: 'bypassPermissions' })])).toEqual([]);
  });

  it('bypassActivatedTabs_mismaLista_vacioSinRecorrer', () => {
    const same = [tab('a', { permissionMode: 'bypassPermissions' })];

    expect(bypassActivatedTabs(same, same)).toEqual([]);
  });
});
