import { describe, expect, it } from 'vitest';
import {
  filterConversationRows,
  formatSize,
  planOpenConversation,
  tabFromConversation,
  relativeTime,
  rowRecency,
  rowTitle,
  type ConversationRow,
} from './conversationList';
import type { ConversationSummary } from '@shared/conversations';
import type { Tab } from './types';

const tab = (over: Partial<Tab>): Tab => ({
  id: 'tab1',
  accountId: '.claude-p',
  accountAlias: 'p',
  cwd: '/proj',
  model: 'sonnet',
  provider: 'claude',
  title: 'abierta',
  ...over,
});

const hist = (over: Partial<ConversationSummary>): ConversationSummary => ({
  sessionId: 's1',
  configDir: '.claude-p',
  cwd: '/proj',
  title: 'histórica',
  updatedAtMs: 1000,
  sizeBytes: 2048,
  isScheduled: false,
  ...over,
});

describe('filterConversationRows', () => {
  const rows: ConversationRow[] = [
    { kind: 'tab', tab: tab({ id: 'tA', title: 'Arreglar login' }) },
    { kind: 'history', item: hist({ sessionId: 's1', title: 'Bug en el chat' }) },
    { kind: 'history', item: hist({ sessionId: 's2', title: 'Refactor de temas' }) },
  ];

  it('queryVacia_devuelveTodas', () => {
    expect(filterConversationRows(rows, '')).toHaveLength(3);
    expect(filterConversationRows(rows, '   ')).toHaveLength(3);
  });

  it('filtraPorTituloCaseInsensitive', () => {
    const result = filterConversationRows(rows, 'CHAT');
    expect(result).toHaveLength(1);
    expect(rowTitle(result[0]!)).toBe('Bug en el chat');
  });

  it('sinCoincidencias_devuelveVacio', () => {
    expect(filterConversationRows(rows, 'inexistente')).toHaveLength(0);
  });

  it('coincidenciaParcial_enPestanaEHistorial', () => {
    // "re" coincide con "Arreglar" y "Refactor".
    const result = filterConversationRows(rows, 're');
    expect(result.map(rowTitle).sort()).toEqual(['Arreglar login', 'Refactor de temas']);
  });
});

describe('planOpenConversation', () => {
  const CTX = { activeAccountId: '.claude-p', sessionId: 's1' };

  it('planOpenConversation_noEstaAbierta_creaPestanaNueva', () => {
    expect(planOpenConversation({ ...CTX, tabs: [], sessionIdByChat: {} })).toEqual({ action: 'create' });
  });

  // Devolución 19: antes no la encontraba (casaba el UUID de Mage) y abría OTRA pestaña con el mismo hilo.
  it('planOpenConversation_codexConSesionViva_activaLaPestaña', () => {
    const tabs = [tab({ id: 'tA', accountId: '.claude-p', provider: 'codex', resumeSessionId: 's1' })];

    expect(planOpenConversation({ ...CTX, tabs, sessionIdByChat: { tA: 'mage-uuid-1' } })).toEqual({ action: 'activate', tabId: 'tA' });
  });

  it('planOpenConversation_abiertaEnLaCuentaActiva_soloLaActiva', () => {
    const tabs = [tab({ id: 'tA', accountId: '.claude-p', resumeSessionId: 's1' })];

    expect(planOpenConversation({ ...CTX, tabs, sessionIdByChat: {} })).toEqual({
      action: 'activate',
      tabId: 'tA',
    });
  });

  it('planOpenConversation_abiertaEnOtraCuentaSinSesionViva_laReasignaALaActiva', () => {
    // EL CASO DEL BUG: estando en .claude-p se abre una conversacion compartida que quedo abierta bajo
    // .claude-9. Antes la app CAMBIABA de cuenta; ahora la pestana pasa a la cuenta seleccionada.
    const tabs = [tab({ id: 'tA', accountId: '.claude-9', resumeSessionId: 's1' })];

    expect(planOpenConversation({ ...CTX, tabs, sessionIdByChat: {} })).toEqual({
      action: 'reassign',
      tabId: 'tA',
    });
  });

  it('planOpenConversation_abiertaEnOtraCuentaConSesionViva_vaADondeEstaViva', () => {
    // Con proceso vivo no se puede reasignar: dos CLIs sobre la misma transcripcion la corromperian.
    const tabs = [tab({ id: 'tA', accountId: '.claude-9' })];

    expect(planOpenConversation({ ...CTX, tabs, sessionIdByChat: { tA: 's1' } })).toEqual({
      action: 'follow',
      tabId: 'tA',
      accountId: '.claude-9',
    });
  });

  it('planOpenConversation_sesionVivaEnLaCuentaActiva_soloLaActiva', () => {
    const tabs = [tab({ id: 'tA', accountId: '.claude-p' })];

    expect(planOpenConversation({ ...CTX, tabs, sessionIdByChat: { tA: 's1' } })).toEqual({
      action: 'activate',
      tabId: 'tA',
    });
  });

  it('planOpenConversation_otraConversacionAbierta_noLaConfunde', () => {
    const tabs = [tab({ id: 'tA', accountId: '.claude-9', resumeSessionId: 'otra' })];

    expect(planOpenConversation({ ...CTX, tabs, sessionIdByChat: {} })).toEqual({ action: 'create' });
  });

  it('planOpenConversation_sessionIdVacio_lanza', () => {
    expect(() => planOpenConversation({ ...CTX, sessionId: '', tabs: [], sessionIdByChat: {} })).toThrow(
      /sessionId vacio/i,
    );
  });
});

// U-A2: el orden es por la ultima interaccion (mensaje del usuario o respuesta del agente).
describe('rowRecency — pestaña', () => {
  const rowOf = (t: Partial<Tab>, h?: Partial<ConversationSummary>): ConversationRow =>
    h === undefined ? { kind: 'tab', tab: tab(t) } : { kind: 'tab', tab: tab(t), history: hist(h) };

  it('rowRecency_tabConRespuestaPosterior_usaElMtime', () => {
    expect(rowRecency(rowOf({ lastMessageAtMs: 1000 }, { updatedAtMs: 5000 }))).toBe(5000);
  });

  it('rowRecency_tabConMensajePosterior_usaLastMessage', () => {
    expect(rowRecency(rowOf({ lastMessageAtMs: 8000 }, { updatedAtMs: 5000 }))).toBe(8000);
  });

  it('rowRecency_tabSinNada_usaCreatedAt', () => {
    expect(rowRecency(rowOf({ createdAtMs: 300 }))).toBe(300);
  });

  it('rowRecency_tabVacia_cero', () => {
    expect(rowRecency(rowOf({}))).toBe(0);
  });
});

describe('formatSize', () => {
  it('formatSize_limites', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1024)).toBe('1,0 kB');
    expect(formatSize(10 * 1024 * 1024)).toBe('10 MB');
  });

  it('formatSize_negativoONoEntero_lanzaConElValor', () => {
    expect(() => formatSize(-1)).toThrow(/-1/);
    expect(() => formatSize(1.5)).toThrow(/1.5/);
  });
});

describe('relativeTime', () => {
  const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);

  it('relativeTime_limites', () => {
    expect(relativeTime(NOW, NOW)).toBe('ahora');
    expect(relativeTime(NOW - 59_999, NOW)).toBe('ahora');
    expect(relativeTime(NOW - 60_000, NOW)).toBe('hace 1 min');
    expect(relativeTime(NOW - 60 * 60_000, NOW)).toBe('hace 1 h');
    expect(relativeTime(NOW - 24 * 60 * 60_000, NOW)).toBe('hace 1 d');
    expect(relativeTime(NOW - 30 * 24 * 60 * 60_000, NOW)).toBe('2026-08-27');
  });

  it('relativeTime_menosDeUnaHora_minutosNuncaHoras', () => {
    expect(relativeTime(NOW - 59 * 60_000, NOW)).toBe('hace 59 min');
    expect(relativeTime(NOW - (60 * 60_000 - 1), NOW)).toBe('hace 59 min');
  });

  it('relativeTime_instanteFuturo_ahora', () => {
    expect(relativeTime(NOW + 5_000, NOW)).toBe('ahora');
  });
});

describe('tabFromConversation', () => {
  const item: ConversationSummary = {
    sessionId: 'sess-1',
    configDir: 'C:/Users/u/.claude',
    cwd: 'C:/src/mage',
    title: 'Arreglar el cierre',
    updatedAtMs: 5,
    sizeBytes: 10,
    isScheduled: false,
  };

  it('tabFromConversation_reanudaEsaSesionConLaCuentaDada', () => {
    const tab = tabFromConversation({ id: 't1', item, accountId: 'acc', accountAlias: 'principal', prefs: { model: 'opus' } });

    expect(tab).toEqual({
      id: 't1',
      accountId: 'acc',
      accountAlias: 'principal',
      cwd: 'C:/src/mage',
      model: 'opus',
      provider: 'claude',
      title: 'Arreglar el cierre',
      resolvedConfigDir: 'C:/Users/u/.claude',
      resumeSessionId: 'sess-1',
    });
  });

  it('tabFromConversation_conEsfuerzoYModo_losConserva', () => {
    const tab = tabFromConversation({ id: 't1', item, accountId: 'acc', accountAlias: 'a', prefs: { model: 'opus', effort: 'high', permissionMode: 'plan' } });

    expect(tab.effort).toBe('high');
    expect(tab.permissionMode).toBe('plan');
  });
});
