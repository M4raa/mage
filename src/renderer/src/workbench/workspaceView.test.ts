import { describe, expect, it } from 'vitest';
import type { PersistedWorkspace } from '@shared/state';
import type { Tab } from './types';
import { restoreTabs, toPersistedWorkspace } from './workspaceView';
import { singleLeaf } from './splitLayout';
import type { SplitLayout } from '@shared/state';

// Fixture de test (splitPane ya no existe: la produccion solo crea splits por arrastre, ver
// splitLayout.test.ts). Aqui solo hace falta CONSTRUIR arboles para probar persistencia/migracion.
// Una pestaña tal y como la guarda el workspace: por el MISMO mapeo que en produccion (desde P-026 2.3
// la `Tab` admite modos que el fichero no, asi que ya no vale el spread directo).
function asPersisted(t: Tab): PersistedWorkspace['tabs'][number] {
  const persisted = toPersistedWorkspace([t], t.id, {}, singleLeaf(t.id)).tabs[0];
  if (persisted === undefined) throw new Error(`toPersistedWorkspace no devolvio la pestaña ${t.id}`);
  return persisted;
}

function split(a: SplitLayout, b: SplitLayout, direction: 'row' | 'col' = 'row'): SplitLayout {
  return { kind: 'split', direction, ratio: 0.5, a, b };
}

const tab = (over: Partial<Tab> = {}): Tab => ({
  id: 'tab1',
  accountId: '.claude',
  accountAlias: 'main',
  cwd: '/proj',
  model: 'opus',
  provider: 'claude',
  title: 'proj',
  privacy: 'shared',
  ...over,
});

describe('toPersistedWorkspace', () => {
  it('pestanaConSesionViva_persisteEseSessionId', () => {
    const ws = toPersistedWorkspace([tab()], 'tab1', { tab1: 'live-123' });

    expect(ws.tabs[0]?.sessionId).toBe('live-123');
    expect(ws.activeTabId).toBe('tab1');
    expect(ws.version).toBe(1);
  });

  it('pestanaRestauradaSinSesionViva_persisteElResumeSessionId', () => {
    const ws = toPersistedWorkspace([tab({ resumeSessionId: 'old-999' })], 'tab1', {});

    expect(ws.tabs[0]?.sessionId).toBe('old-999'); // no se pierde la posibilidad de reanudar
  });

  it('pestanaNuncaUsada_noEscribeSessionId', () => {
    const ws = toPersistedWorkspace([tab()], 'tab1', {});

    expect('sessionId' in (ws.tabs[0] as object)).toBe(false);
  });

  it('effort_sePersisteYSeRestaura', () => {
    const persistedEffort = toPersistedWorkspace([tab({ effort: 'high' })], 'tab1', {}).tabs[0]?.effort;
    expect(persistedEffort).toBe('high');

    const restored = restoreTabs(
      { version: 1, activeTabId: 'tab1', tabs: [{ id: 'tab1', accountId: '.claude', accountAlias: 'm', cwd: '/p', model: 'opus', provider: 'claude', title: 'p', privacy: 'shared', effort: 'high' }] },
      new Set(['.claude']),
    );
    expect(restored.tabs[0]?.effort).toBe('high');
  });

  it('maxBudgetUsdCents_sePersisteYSeRestaura', () => {
    expect(toPersistedWorkspace([tab({ maxBudgetUsdCents: 500 })], 'tab1', {}).tabs[0]?.maxBudgetUsdCents).toBe(500);

    const restored = restoreTabs(
      { version: 1, activeTabId: 'tab1', tabs: [{ id: 'tab1', accountId: '.claude', accountAlias: 'm', cwd: '/p', model: 'opus', provider: 'claude', title: 'p', privacy: 'shared', maxBudgetUsdCents: 500 }] },
      new Set(['.claude']),
    );
    expect(restored.tabs[0]?.maxBudgetUsdCents).toBe(500);
  });
});

describe('toPersistedWorkspace + restoreTabs — division del centro (item 13 / I11)', () => {
  const twoTabs = [tab({ id: 'tab1' }), tab({ id: 'tab2' })];
  const threeTabs = [tab({ id: 'tab1' }), tab({ id: 'tab2' }), tab({ id: 'tab3' })];

  it('sinDivision_noEscribeSplitLayout', () => {
    const ws = toPersistedWorkspace(twoTabs, 'tab1', {});

    expect(ws.splitLayout).toBeUndefined();
  });

  it('conDivision_persisteYSeRestauraIgual', () => {
    const layout = split(singleLeaf('tab1'), singleLeaf('tab2'), 'col');
    const ws = toPersistedWorkspace(twoTabs, 'tab1', {}, layout);

    const restored = restoreTabs(ws, new Set(['.claude']));

    expect(restored.splitLayout).toEqual(layout);
  });

  it('divisionDeTresPaneles_persisteYSeRestauraIgual', () => {
    const layout = split(singleLeaf('tab1'), split(singleLeaf('tab2'), singleLeaf('tab3'), 'col'));
    const ws = toPersistedWorkspace(threeTabs, 'tab1', {}, layout);

    const restored = restoreTabs(ws, new Set(['.claude']));

    expect(restored.splitLayout).toEqual(layout);
  });

  it('unPanelDeUnaHojaQueUsaLaPestanaActiva_seCierraTalCual', () => {
    const ws: PersistedWorkspace = {
      version: 1,
      activeTabId: 'tab1',
      tabs: [asPersisted(twoTabs[0]!)],
      splitLayout: { kind: 'leaf', tabIds: ['tab2'], activeTabId: 'tab2' }, // grupo de una pestaña de cuenta ya borrada
    };

    expect(restoreTabs(ws, new Set(['.claude'])).splitLayout).toEqual({ kind: 'leaf', tabIds: ['tab1'], activeTabId: 'tab1' });
  });

  it('divisionApuntandoAUnaPestanaQueYaNoExiste_sePoda', () => {
    // La pestaña del segundo panel era de una cuenta borrada entre arranques.
    const ws: PersistedWorkspace = {
      version: 1,
      activeTabId: 'tab1',
      tabs: [asPersisted(twoTabs[0]!)],
      splitLayout: split(singleLeaf('tab1'), singleLeaf('tab2')),
    };

    expect(restoreTabs(ws, new Set(['.claude'])).splitLayout).toEqual({ kind: 'leaf', tabIds: ['tab1'], activeTabId: 'tab1' });
  });

  it('estadoDeUnaVersionAnterior_sinNingunCampoDeSplit_seRestauraSinDivision', () => {
    const ws: PersistedWorkspace = { version: 1, activeTabId: 'tab1', tabs: [asPersisted(twoTabs[0]!)] };

    expect(restoreTabs(ws, new Set(['.claude'])).splitLayout).toEqual({ kind: 'leaf', tabIds: ['tab1'], activeTabId: 'tab1' });
  });

  it('estadoDeUnaVersionAnterior_conSplitTabIdYSplitDirection_seMigraAUnArbolDeUnNivel', () => {
    // Forma VIEJA (Ronda 3, antes de I11): la escribia una version de Mage anterior a este cambio.
    const ws: PersistedWorkspace = {
      version: 1,
      activeTabId: 'tab1',
      tabs: [asPersisted(twoTabs[0]!), asPersisted(twoTabs[1]!)],
      splitTabId: 'tab2',
      splitDirection: 'col',
    };

    const restored = restoreTabs(ws, new Set(['.claude']));

    expect(restored.splitLayout).toEqual({ kind: 'split', direction: 'col', ratio: 0.5, a: { kind: 'leaf', tabIds: ['tab1'], activeTabId: 'tab1' }, b: { kind: 'leaf', tabIds: ['tab2'], activeTabId: 'tab2' } });
  });
});

describe('restoreTabs', () => {
  const persisted = (over: Partial<PersistedWorkspace> = {}): PersistedWorkspace => ({
    version: 1,
    activeTabId: 'tab1',
    tabs: [{ id: 'tab1', accountId: '.claude', accountAlias: 'main', cwd: '/p', model: 'opus', provider: 'claude', title: 'p', privacy: 'shared', sessionId: 's1' }],
    ...over,
  });

  it('sessionIdPersistido_pasaAResumeSessionId', () => {
    const { tabs } = restoreTabs(persisted(), new Set(['.claude']));

    expect(tabs[0]?.resumeSessionId).toBe('s1');
  });

  it('cuentaInexistente_descartaLaPestana', () => {
    const { tabs, activeTabId } = restoreTabs(persisted(), new Set(['.otra']));

    expect(tabs).toHaveLength(0);
    expect(activeTabId).toBe('');
  });

  it('restoreTabs_novedadesActivaEnElArbol_sePodaYLaActivaVuelveALaPrimera', () => {
    // La pseudo-pestaña de novedades no esta en `tabs`: no sobrevive a un reinicio.
    const ws = persisted({ activeTabId: 'mage:novedades', splitLayout: { kind: 'leaf', tabIds: ['tab1', 'mage:novedades'], activeTabId: 'mage:novedades' } });

    const restored = restoreTabs(ws, new Set(['.claude']));

    expect(restored.activeTabId).toBe('tab1');
    expect(restored.splitLayout).toEqual(singleLeaf('tab1'));
  });

  it('activaYaNoPresente_caeALaPrimera', () => {
    const ws = persisted({ activeTabId: 'no-existe' });

    expect(restoreTabs(ws, new Set(['.claude'])).activeTabId).toBe('tab1');
  });
});
