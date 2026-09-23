import { describe, expect, it } from 'vitest';
import { orderTabsForDisplay, tabColorVar, tabsToCloseAll, tabsToCloseInactive } from './tabActions';
import type { ChatStatus, Tab } from './types';

function tab(id: string, overrides: Partial<Tab> = {}): Tab {
  return {
    id,
    accountId: 'acc',
    accountAlias: 'acc',
    cwd: 'C:/p',
    model: 'sonnet',
    provider: 'claude',
    title: id,
    privacy: 'shared',
    ...overrides,
  };
}

const ACCOUNT_ACCENT = 'var(--mg-accent-1-base)';

describe('tabColorVar', () => {
  it('tabColorVar_sinOverride_usaElAcentoDeLaCuenta', () => {
    expect(tabColorVar(undefined, ACCOUNT_ACCENT)).toBe(ACCOUNT_ACCENT);
  });

  it('tabColorVar_conOverride_devuelveLaVariableDeEseAcento', () => {
    expect(tabColorVar(3, ACCOUNT_ACCENT)).toBe('var(--mg-accent-3-base)');
  });

  it('tabColorVar_indiceCero_noCaeAlAcentoDeLaCuenta', () => {
    // 0 es un indice valido: un `if (!colorIndex)` lo trataria como "sin color".
    expect(tabColorVar(0, ACCOUNT_ACCENT)).toBe('var(--mg-accent-0-base)');
  });

  it('tabColorVar_indiceFueraDeRango_seCicla', () => {
    expect(tabColorVar(7, ACCOUNT_ACCENT)).toBe('var(--mg-accent-1-base)');
    expect(tabColorVar(-1, ACCOUNT_ACCENT)).toBe('var(--mg-accent-5-base)');
  });

  it('tabColorVar_indiceNoEntero_caeAlAcentoDeLaCuenta', () => {
    expect(tabColorVar(1.5, ACCOUNT_ACCENT)).toBe(ACCOUNT_ACCENT);
  });
});

describe('tabsToCloseAll', () => {
  it('tabsToCloseAll_conAncladas_lasExcluye', () => {
    const tabs = [tab('t1'), tab('t2', { pinned: true }), tab('t3')];

    expect(tabsToCloseAll(tabs).map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('tabsToCloseAll_todasAncladas_noCierraNinguna', () => {
    expect(tabsToCloseAll([tab('t1', { pinned: true })])).toEqual([]);
  });

  it('tabsToCloseAll_sinPestañas_devuelveVacio', () => {
    expect(tabsToCloseAll([])).toEqual([]);
  });
});

describe('tabsToCloseInactive', () => {
  const statusByChat: Readonly<Record<string, ChatStatus>> = {
    t2: 'streaming',
    t3: 'needs_permission',
    t4: 'idle',
    t5: 'error',
  };

  it('tabsToCloseInactive_conAgenteTrabajandoOPermisoPendiente_lasRespeta', () => {
    const tabs = [tab('t1'), tab('t2'), tab('t3'), tab('t4'), tab('t5')];

    expect(tabsToCloseInactive(tabs, statusByChat).map((t) => t.id)).toEqual(['t1', 't4']);
  });

  it('tabsToCloseInactive_pestañaSinEstado_cuentaComoInactiva', () => {
    // Nunca arrancó sesion -> no hay nada en curso que proteger.
    expect(tabsToCloseInactive([tab('nueva')], {}).map((t) => t.id)).toEqual(['nueva']);
  });

  it('tabsToCloseInactive_inactivaPeroAnclada_noSeCierra', () => {
    expect(tabsToCloseInactive([tab('t4', { pinned: true })], statusByChat)).toEqual([]);
  });
});

describe('orderTabsForDisplay', () => {
  it('orderTabsForDisplay_conAncladas_vanPrimeroSinAlterarElOrdenRelativo', () => {
    const tabs = [tab('t1'), tab('t2', { pinned: true }), tab('t3'), tab('t4', { pinned: true })];

    expect(orderTabsForDisplay(tabs).map((t) => t.id)).toEqual(['t2', 't4', 't1', 't3']);
  });

  it('orderTabsForDisplay_sinAncladas_devuelveLaMismaReferencia', () => {
    // Importante para Zustand/React: no crear un array nuevo cuando no hay nada que reordenar.
    const tabs = [tab('t1'), tab('t2')];

    expect(orderTabsForDisplay(tabs)).toBe(tabs);
  });

  it('orderTabsForDisplay_todasAncladas_devuelveLaMismaReferencia', () => {
    const tabs = [tab('t1', { pinned: true }), tab('t2', { pinned: true })];

    expect(orderTabsForDisplay(tabs)).toBe(tabs);
  });
});
