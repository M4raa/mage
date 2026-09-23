import { describe, expect, it } from 'vitest';
import {
  filterConversationRows,
  mergeConversationRows,
  planOpenConversation,
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
  privacy: 'shared',
  ...over,
});

const hist = (over: Partial<ConversationSummary>): ConversationSummary => ({
  sessionId: 's1',
  configDir: '.claude-p',
  cwd: '/proj',
  title: 'histórica',
  privacy: 'shared',
  updatedAtMs: 1000,
  sizeBytes: 2048,
  ...over,
});

describe('mergeConversationRows', () => {
  it('ordenaPorRecencia_pestanaRecienEscritaPrimero', () => {
    const tabs = [tab({ id: 'tA', resumeSessionId: 'sA', lastMessageAtMs: 5000 })];
    const history = [hist({ sessionId: 'sB', updatedAtMs: 2000 })];

    const rows = mergeConversationRows(tabs, history, {}, '.claude-p', 'shared');

    expect(rows.map((r) => r.kind)).toEqual(['tab', 'history']);
  });

  it('pestanaAbiertaSinEscribir_mantieneSuSitioPorMtimeDelHistorial', () => {
    // Abrir una conversacion antigua NO debe subirla al principio (A6): su sitio lo da su mtime.
    const tabs = [tab({ id: 'tA', resumeSessionId: 'sVieja' })];
    const history = [hist({ sessionId: 'sVieja', updatedAtMs: 100 }), hist({ sessionId: 'sNueva', updatedAtMs: 900 })];

    const rows = mergeConversationRows(tabs, history, {}, '.claude-p', 'shared');

    expect(rows.map((r) => (r.kind === 'tab' ? 'sVieja' : r.item.sessionId))).toEqual(['sNueva', 'sVieja']);
  });

  it('escribirEnLaPestana_laSubeAlPrincipio', () => {
    const tabs = [tab({ id: 'tA', resumeSessionId: 'sVieja', lastMessageAtMs: 5000 })];
    const history = [hist({ sessionId: 'sVieja', updatedAtMs: 100 }), hist({ sessionId: 'sNueva', updatedAtMs: 900 })];

    const rows = mergeConversationRows(tabs, history, {}, '.claude-p', 'shared');

    expect(rows.map((r) => (r.kind === 'tab' ? 'sVieja' : r.item.sessionId))).toEqual(['sVieja', 'sNueva']);
  });

  it('conversacionNuevaSinSesion_seOrdenaPorCreatedAtMs', () => {
    const tabs = [tab({ id: 'tNueva', createdAtMs: 8000 })];
    const history = [hist({ sessionId: 'sB', updatedAtMs: 2000 })];

    const rows = mergeConversationRows(tabs, history, {}, '.claude-p', 'shared');

    expect(rows.map((r) => r.kind)).toEqual(['tab', 'history']);
  });

  it('pestanaSinMarcasDeTiempo_noRompeElOrden', () => {
    const tabs = [tab({ id: 'tLegacy' })]; // restaurada de un formato anterior
    const history = [hist({ sessionId: 'sB', updatedAtMs: 2000 })];

    const rows = mergeConversationRows(tabs, history, {}, '.claude-p', 'shared');

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.kind)).toEqual(['history', 'tab']);
  });

  it('deduplicaHistorialQueYaEstaAbierto_porResumeSessionId', () => {
    const tabs = [tab({ id: 'tA', resumeSessionId: 'sX' })];
    const history = [hist({ sessionId: 'sX' })]; // misma conversacion abierta

    const rows = mergeConversationRows(tabs, history, {}, '.claude-p', 'shared');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('tab');
  });

  it('deduplicaPorSesionViva_sessionIdByChat', () => {
    const tabs = [tab({ id: 'tA' })]; // sin resumeSessionId, pero con sesion viva
    const history = [hist({ sessionId: 'live1' })];

    const rows = mergeConversationRows(tabs, history, { tA: 'live1' }, '.claude-p', 'shared');

    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('tab');
  });

  it('filtraPorPrivacidad', () => {
    const history = [hist({ sessionId: 's1', privacy: 'shared' }), hist({ sessionId: 's2', privacy: 'private' })];

    const shared = mergeConversationRows([], history, {}, '.claude-p', 'shared');
    const priv = mergeConversationRows([], history, {}, '.claude-p', 'private');

    expect(shared).toHaveLength(1);
    expect(priv).toHaveLength(1);
    expect(priv[0]).toMatchObject({ kind: 'history', item: { sessionId: 's2' } });
  });

  it('historialMasRecientePrimero', () => {
    const history = [hist({ sessionId: 'viejo', updatedAtMs: 1 }), hist({ sessionId: 'nuevo', updatedAtMs: 9 })];

    const rows = mergeConversationRows([], history, {}, '.claude-p', 'shared');

    expect(rows.map((r) => (r.kind === 'history' ? r.item.sessionId : ''))).toEqual(['nuevo', 'viejo']);
  });

  it('filtraPestanasDeOtraCuenta', () => {
    const tabs = [tab({ id: 'tA', accountId: '.claude-9' })];

    const rows = mergeConversationRows(tabs, [], {}, '.claude-p', 'shared');

    expect(rows).toHaveLength(0);
  });
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
