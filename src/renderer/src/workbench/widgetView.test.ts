import { describe, expect, it } from 'vitest';
import { toWidgetSnapshot, type WidgetViewInput } from './widgetView';
import type { Account, ChatStatus, Tab } from './types';

// --- Fixtures -----------------------------------------------------------------------------------

function makeTab(overrides: Partial<Tab> = {}): Tab {
  return {
    id: 'tab1',
    accountId: 'acc1',
    accountAlias: 'claude-p',
    cwd: '/proj',
    model: 'sonnet',
    provider: 'claude',
    title: 'proj',
    privacy: 'shared',
    ...overrides,
  };
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc1',
    monogram: 'C',
    alias: 'claude-p',
    provider: 'Claude',
    providerId: 'claude',
    apiBilled: false,
    defaultModel: 'sonnet',
    accent: {
      base: 'var(--mg-accent-0-base)',
      tint: 'var(--mg-accent-0-tint)',
      bgActive: 'var(--mg-accent-0-bg-active)',
      borderInactive: 'var(--mg-accent-0-border-inactive)',
    },
    activity: 'idle',
    usage: { fiveHour: { pct: 10, label: '1 h' }, weekly: { pct: 20, label: '2 d' } },
    email: 'a@b.c',
    loginStatus: 'logged_in',
    isMain: true,
    ...overrides,
  };
}

function makeInput(overrides: Partial<WidgetViewInput> = {}): WidgetViewInput {
  return {
    tabs: [makeTab()],
    accounts: [makeAccount()],
    activeAccountId: 'acc1',
    statusByChat: {},
    ...overrides,
  };
}

// --- Tests --------------------------------------------------------------------------------------

describe('toWidgetSnapshot', () => {
  it('toWidgetSnapshot_sinPestanas_devuelveAgentesVacios', () => {
    const snapshot = toWidgetSnapshot(makeInput({ tabs: [] }), 'dark');

    expect(snapshot.agents).toEqual([]);
  });

  it('toWidgetSnapshot_propagaTema', () => {
    const snapshot = toWidgetSnapshot(makeInput(), 'light');

    expect(snapshot.theme).toBe('light');
  });

  it('toWidgetSnapshot_sinCuentaActiva_usageNull', () => {
    const snapshot = toWidgetSnapshot(makeInput({ activeAccountId: 'inexistente' }), 'dark');

    expect(snapshot.usage).toBeNull();
  });

  it('toWidgetSnapshot_conCuentaActiva_mapeaUso', () => {
    const snapshot = toWidgetSnapshot(makeInput(), 'dark');

    expect(snapshot.usage).toEqual({ fiveHour: { pct: 10, label: '1 h' }, weekly: { pct: 20, label: '2 d' } });
  });

  it('toWidgetSnapshot_agente_tomaEstadoYAcentoDeLaCuenta', () => {
    const snapshot = toWidgetSnapshot(makeInput({ statusByChat: { tab1: 'streaming' } }), 'dark');

    expect(snapshot.agents[0]).toEqual({
      tabId: 'tab1',
      title: 'proj',
      accountAlias: 'claude-p',
      accentBase: 'var(--mg-accent-0-base)',
      status: 'streaming',
    });
  });

  it('toWidgetSnapshot_sinEstado_agenteIdle', () => {
    const snapshot = toWidgetSnapshot(makeInput({ statusByChat: {} }), 'dark');

    expect(snapshot.agents[0]?.status).toBe('idle');
  });

  it('toWidgetSnapshot_ordenaActivasPrimeroPorUrgencia', () => {
    const tabs: readonly Tab[] = [
      makeTab({ id: 'a', title: 'A' }),
      makeTab({ id: 'b', title: 'B' }),
      makeTab({ id: 'c', title: 'C' }),
    ];
    const statusByChat: Record<string, ChatStatus> = { a: 'idle', b: 'error', c: 'streaming' };

    const snapshot = toWidgetSnapshot(makeInput({ tabs, statusByChat }), 'dark');

    // error (3) > streaming (1) > idle (0)
    expect(snapshot.agents.map((agent) => agent.tabId)).toEqual(['b', 'c', 'a']);
  });

  it('toWidgetSnapshot_mismaUrgencia_preservaOrdenOriginal', () => {
    const tabs: readonly Tab[] = [makeTab({ id: 'a' }), makeTab({ id: 'b' })];

    const snapshot = toWidgetSnapshot(makeInput({ tabs, statusByChat: {} }), 'dark');

    expect(snapshot.agents.map((agent) => agent.tabId)).toEqual(['a', 'b']);
  });

  it('toWidgetSnapshot_pestanaEnError_emiteAlertaCritica', () => {
    const snapshot = toWidgetSnapshot(makeInput({ statusByChat: { tab1: 'error' } }), 'dark');

    expect(snapshot.alerts).toContainEqual({ kind: 'error', severity: 'critical', text: 'proj: error' });
  });

  it('toWidgetSnapshot_pestanaEnPermiso_emiteAlertaWarn', () => {
    const snapshot = toWidgetSnapshot(makeInput({ statusByChat: { tab1: 'needs_permission' } }), 'dark');

    expect(snapshot.alerts).toContainEqual({ kind: 'permission', severity: 'warn', text: 'proj: permiso pendiente' });
  });

  it('toWidgetSnapshot_usoSobreUmbralCritico_emiteAlertaCritical', () => {
    const account = makeAccount({ usage: { fiveHour: { pct: 96, label: '30 m' }, weekly: { pct: 20, label: '2 d' } } });

    const snapshot = toWidgetSnapshot(makeInput({ accounts: [account] }), 'dark');

    expect(snapshot.alerts).toContainEqual({ kind: 'usage', severity: 'critical', text: 'Uso 5h 96%' });
  });

  it('toWidgetSnapshot_usoSobreUmbralAviso_emiteAlertaWarn', () => {
    const account = makeAccount({ usage: { fiveHour: { pct: 10, label: '1 h' }, weekly: { pct: 85, label: '2 d' } } });

    const snapshot = toWidgetSnapshot(makeInput({ accounts: [account] }), 'dark');

    expect(snapshot.alerts).toContainEqual({ kind: 'usage', severity: 'warn', text: 'Uso semanal 85%' });
  });

  it('toWidgetSnapshot_usoBajoUmbral_sinAlertaDeUso', () => {
    const snapshot = toWidgetSnapshot(makeInput(), 'dark'); // 10% / 20%: por debajo del aviso

    expect(snapshot.alerts.filter((alert) => alert.kind === 'usage')).toEqual([]);
  });

  it('toWidgetSnapshot_ordenaAlertasErroresPrimero', () => {
    const account = makeAccount({ usage: { fiveHour: { pct: 96, label: '30 m' }, weekly: { pct: 20, label: '2 d' } } });
    const snapshot = toWidgetSnapshot(
      makeInput({ accounts: [account], statusByChat: { tab1: 'error' } }),
      'dark',
    );

    // error (critical) antes que la alerta de uso.
    expect(snapshot.alerts[0]?.kind).toBe('error');
  });
});
