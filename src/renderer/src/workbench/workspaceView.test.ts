import { describe, expect, it } from 'vitest';
import type { PersistedWorkspace } from '@shared/state';
import type { Tab } from './types';
import { restoreTabs, toPersistedWorkspace } from './workspaceView';
import { singleLeaf } from './splitLayout';
import type { SplitLayout } from '@shared/state';
import { conversationIdOfTab } from './conversationId';

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
  it('proyectoDePestanaSobreviveAlReinicio', () => {
    const persisted = toPersistedWorkspace([tab({ projectId: 'python' })], 'tab1', {});
    expect(persisted.tabs[0]?.projectId).toBe('python');
    expect(restoreTabs(persisted, new Set(['.claude'])).tabs[0]?.projectId).toBe('python');
  });
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

  // Devolución 19, H1: en Codex y agy la sesión viva de Mage es un UUID propio; lo que se reanuda es el hilo.
  it('toPersistedWorkspace_pestañaCodexConSesionViva_guardaElIdDelHilo', () => {
    const codex = tab({ provider: 'codex', accountId: '.codex-a', resumeSessionId: 'thread-7' });

    const ws = toPersistedWorkspace([codex], 'tab1', { tab1: 'mage-uuid-1' });

    expect(ws.tabs[0]?.sessionId).toBe('thread-7');
  });

  it('toPersistedWorkspace_pestañaAgyConSesionViva_guardaElIdDelHilo', () => {
    const agy = tab({ provider: 'agy', accountId: 'agy-a', resumeSessionId: 'cascade-3' });

    const ws = toPersistedWorkspace([agy], 'tab1', { tab1: 'mage-uuid-2' });

    expect(ws.tabs[0]?.sessionId).toBe('cascade-3');
  });

  it('toPersistedWorkspace_pestañaClaudeConSesionViva_sinCambios', () => {
    const ws = toPersistedWorkspace([tab({ resumeSessionId: 'old-1' })], 'tab1', { tab1: 'live-2' });

    expect(ws.tabs[0]?.sessionId).toBe('live-2');
  });

  it('toPersistedWorkspace_pestañaRuntimePropioConSesionViva_sinCambios', () => {
    const ws = toPersistedWorkspace([tab({ provider: 'custom:ollama', resumeSessionId: 'old-1' })], 'tab1', { tab1: 'live-3' });

    expect(ws.tabs[0]?.sessionId).toBe('live-3');
  });

  it('toPersistedWorkspace_pestañaCodexSinHilo_noGuardaElUuidDeMage', () => {
    const codex = tab({ provider: 'codex', accountId: '.codex-a' });

    const ws = toPersistedWorkspace([codex], 'tab1', { tab1: 'mage-uuid-1' });

    expect('sessionId' in (ws.tabs[0] as object)).toBe(false);
  });

  it('toPersistedWorkspace_idaYVueltaCodex_conversationIdOfTabDevuelveElHilo', () => {
    const codex = tab({ provider: 'codex', accountId: '.codex-a', resumeSessionId: 'thread-7' });

    const restored = restoreTabs(toPersistedWorkspace([codex], 'tab1', { tab1: 'mage-uuid-1' }), new Set(['.codex-a'])).tabs[0];

    expect(restored === undefined ? undefined : conversationIdOfTab(restored, undefined)).toBe('thread-7');
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

  it('restoreTabs_proveedorRetiradoDelGateway_reabreConClaudeYConservaLaSesion', () => {
    // P-032 R6: `openai`/`gemini` ya no tienen runtime; su transcripcion es del CLI de Claude.
    const ws = persisted({ tabs: [{ id: 'tab1', accountId: '.claude', accountAlias: 'main', cwd: '/p', model: 'gpt-4o', provider: 'openai', title: 'p', privacy: 'shared', sessionId: 's1' }] });

    const [restored] = restoreTabs(ws, new Set(['.claude'])).tabs;

    expect(restored).toMatchObject({ provider: 'claude', model: 'sonnet', resumeSessionId: 's1' });
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

  it('restaurarWorkspace_de012ConMarcadores_titulosVacios', () => {
    const base = persisted().tabs[0]!;
    const ws = persisted({
      tabs: [
        { ...base, id: 'a', title: 'Nuevo chat' },
        { ...base, id: 'b', title: 'Nueva conversación' },
        { ...base, id: 'c', title: 'Refactor del parser' },
      ],
    });

    const titles = restoreTabs(ws, new Set(['.claude'])).tabs.map((tab) => tab.title);

    expect(titles).toEqual(['', '', 'Refactor del parser']);
  });
});

describe('toPersistedWorkspace + restoreTabs — PR vinculado (grupo D)', () => {
  it('prVinculado_idaYVuelta_conservaNumeroDescarteYAutoFix', () => {
    const tab = { id: 't1', accountId: '.claude', accountAlias: 'a', cwd: '/r', model: 'm', provider: 'claude', title: 'x', privacy: 'shared' as const, prNumber: 7, prDismissed: 3, prAutoFix: true };

    const restored = restoreTabs(toPersistedWorkspace([tab], 't1', {}), new Set(['.claude']));

    expect(restored.tabs[0]).toMatchObject({ prNumber: 7, prDismissed: 3, prAutoFix: true });
  });
});

describe('toPersistedWorkspace + restoreTabs — worktree (#52)', () => {
  it.each([true, false])('restoreTabs_eleccionWorktreeOff%s_sobreviveAlReinicio', (worktreeOff) => {
    const persisted = toPersistedWorkspace([tab({ worktreeOff })], 'tab1', {});

    expect(restoreTabs(persisted, new Set(['.claude'])).tabs[0]?.worktreeOff).toBe(worktreeOff);
  });

  it('restoreTabs_pestanaAntiguaSinCampo_noInventaEleccion', () => {
    const persisted = toPersistedWorkspace([tab({})], 'tab1', {});

    expect(restoreTabs(persisted, new Set(['.claude'])).tabs[0]?.worktreeOff).toBeUndefined();
  });
});
