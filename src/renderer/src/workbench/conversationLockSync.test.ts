import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { ConversationLockRef, ConversationLockStatus } from '@shared/conversationLock';
import { foreignText } from '@shared/i18n/localizedText';
import { lockRefOf, RECLAIMED_NOTICE_MS, startConversationLockSync, type LockSyncMage, type LockSyncState } from './conversationLockSync';
import type { Tab } from './types';

const tab = (id: string, overrides: Partial<Tab> = {}): Tab => ({ id, accountId: '/home/u/.claude', accountAlias: 'u', cwd: '/p', model: 'm', provider: 'claude', title: id, privacy: 'shared', ...overrides }) as Tab;

function setup(initial: Partial<LockSyncState> = {}, answer: ConversationLockStatus = { owner: true }) {
  const store = createStore<LockSyncState>(() => ({ tabs: [], activeTabId: '', sessionIdByChat: {}, lockByChat: {}, lockReclaimedByChat: {}, ...initial }));
  let lost: (ref: ConversationLockRef) => void = () => undefined;
  const pending: { resolve: (status: ConversationLockStatus) => void }[] = [];
  const mage = {
    acquireConversationLock: vi.fn(() => new Promise<ConversationLockStatus>((resolve) => { pending.push({ resolve }); })),
    releaseConversationLock: vi.fn(async () => undefined),
    onConversationLockLost: vi.fn((listener: (ref: ConversationLockRef) => void) => { lost = listener; return () => undefined; }),
  } satisfies LockSyncMage;
  const reportError = vi.fn();
  let tick: () => void = () => undefined;
  const every = vi.fn((fn: () => void, _ms: number) => { tick = fn; return () => undefined; });
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const after = vi.fn((fn: () => void, ms: number) => {
    const timer = { fn, ms, cancelled: false };
    timers.push(timer);
    return () => { timer.cancelled = true; };
  });
  let focus: () => void = () => undefined;
  const onWindowFocus = vi.fn((fn: () => void) => { focus = fn; return () => undefined; });
  const stop = startConversationLockSync({ store, mage, reportError, every, after, onWindowFocus });
  const fireTimers = () => { for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn(); };
  const answerAll = async (status: ConversationLockStatus = answer) => {
    for (const entry of pending.splice(0)) entry.resolve(status);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { store, mage, reportError, stop, answerAll, lose: (ref: ConversationLockRef) => lost(ref), tick: () => tick(), every, timers, fireTimers, focus: () => focus() };
}

const REF = { provider: 'claude', accountDir: '/home/u/.claude', nativeId: 'c1' };

describe('lockRefOf', () => {
  it('lockRef_claude_laSesionVivaOLaReanudada', () => {
    expect(lockRefOf(tab('a'), 's1')).toEqual({ ...REF, nativeId: 's1' });
    expect(lockRefOf(tab('a', { resumeSessionId: 'c1' }), undefined)).toEqual(REF);
    expect(lockRefOf(tab('a'), undefined)).toBeNull();
  });

  it('lockRef_codex_soloElHiloNoLaSesionDeMage', () => {
    expect(lockRefOf(tab('a', { provider: 'codex' }), 'mage-session')).toBeNull();
    expect(lockRefOf(tab('a', { provider: 'codex', resumeSessionId: 'thread-1' }), 'mage-session')).toMatchObject({ provider: 'codex', nativeId: 'thread-1' });
  });
});

describe('startConversationLockSync', () => {
  it('pestanaReanudada_laPideYGuardaElResultado', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' })] }, { owner: false, profile: foreignText('mage'), orphan: false });

    await h.answerAll();

    expect(h.mage.acquireConversationLock).toHaveBeenCalledWith({ ...REF, tabId: 'a' });
    expect(h.store.getState().lockByChat).toEqual({ a: { owner: false, profile: foreignText('mage'), orphan: false } });
  });

  it('chatNuevo_seLaPideAlConocerSuIdNativo', async () => {
    const h = setup({ tabs: [tab('a')] });
    expect(h.mage.acquireConversationLock).not.toHaveBeenCalled();

    h.store.setState({ sessionIdByChat: { a: 's1' } });
    h.store.setState({ sessionIdByChat: { a: 's1' } });
    await h.answerAll();

    expect(h.mage.acquireConversationLock).toHaveBeenCalledTimes(1);
    expect(h.store.getState().lockByChat.a).toEqual({ owner: true });
  });

  it('cerrarPestana_laSueltaYQuitaSuEntrada', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' })] });
    await h.answerAll();

    h.store.setState({ tabs: [] });

    expect(h.mage.releaseConversationLock).toHaveBeenCalledWith({ ...REF, tabId: 'a' });
    expect(h.store.getState().lockByChat).toEqual({});
  });

  it('respuestaQueLlegaTrasCerrar_seIgnora', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' })] });

    h.store.setState({ tabs: [] });
    await h.answerAll();

    expect(h.store.getState().lockByChat).toEqual({});
  });

  it('cambiaDeConversacion_sueltaLaViejaYPideLaNueva', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' })] });
    await h.answerAll();

    h.store.setState({ tabs: [tab('a', { resumeSessionId: 'c2' })] });

    expect(h.mage.releaseConversationLock).toHaveBeenCalledWith({ ...REF, tabId: 'a' });
    expect(h.mage.acquireConversationLock).toHaveBeenLastCalledWith({ ...REF, nativeId: 'c2', tabId: 'a' });
  });

  it('perdida_laVuelveAPreguntarYQuedaEnSoloLectura', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' }), tab('b', { resumeSessionId: 'otra' })] });
    await h.answerAll();

    h.lose(REF);
    await h.answerAll({ owner: false, profile: foreignText('mage-dev'), orphan: false });

    expect(h.mage.acquireConversationLock).toHaveBeenCalledTimes(3);
    expect(h.store.getState().lockByChat).toEqual({ a: { owner: false, profile: foreignText('mage-dev'), orphan: false }, b: { owner: true } });
  });

  it('revision_soloLectura_vuelveAPreguntarCada30sYVeElHuerfano', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' }), tab('b', { resumeSessionId: 'mia' })] });
    await h.answerAll();
    h.store.setState({ lockByChat: { a: { owner: false, profile: foreignText('mage'), orphan: false }, b: { owner: true } } });

    h.tick();
    await h.answerAll({ owner: false, profile: foreignText('mage'), orphan: true });

    expect(h.every.mock.calls[0]?.[1]).toBe(30_000);
    expect(h.mage.acquireConversationLock).toHaveBeenCalledTimes(3);
    expect(h.store.getState().lockByChat.a).toEqual({ owner: false, profile: foreignText('mage'), orphan: true });
    expect(h.store.getState().lockByChat.b).toEqual({ owner: true });
  });

  it('fallaLaPregunta_seAvisaSinRomperLaSincronizacion', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' })] });
    h.mage.acquireConversationLock.mockRejectedValueOnce(new Error('main caído'));

    h.store.setState({ tabs: [tab('a', { resumeSessionId: 'c1' }), tab('b', { resumeSessionId: 'c3' })] });
    await h.answerAll();

    expect(h.reportError).toHaveBeenCalledTimes(1);
  });

  // Respuesta 4 de la devolución 17: la otra instancia SOLTÓ la conversación → esta pasa a ser la dueña sin botón y la
  // pestaña lo dice un momento; la revisión se hace también al enfocar la pestaña o la ventana.
  const READ_ONLY: ConversationLockStatus = { owner: false, profile: foreignText('mage'), orphan: false };

  it('soltadaPorLaOtra_alRevisarPasaADuenaConAvisoQueSeVaSolo', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' })] });
    await h.answerAll(READ_ONLY);

    h.tick();
    await h.answerAll({ owner: true });

    expect(h.store.getState().lockByChat.a).toEqual({ owner: true });
    expect(h.store.getState().lockReclaimedByChat).toEqual({ a: true });
    expect(h.timers.map((t) => t.ms)).toEqual([RECLAIMED_NOTICE_MS]);
    h.fireTimers();
    expect(h.store.getState().lockReclaimedByChat).toEqual({});
  });

  it('duenaDesdeElPrincipio_sinAviso', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' })] });

    await h.answerAll({ owner: true });

    expect(h.store.getState().lockReclaimedByChat).toEqual({});
    expect(h.timers).toEqual([]);
  });

  it('enfocarPestanaEnSoloLectura_preguntaEnElActoSinEsperarALaRevision', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' }), tab('b', { resumeSessionId: 'mia' })], activeTabId: 'b' });
    await h.answerAll();
    h.store.setState({ lockByChat: { a: READ_ONLY, b: { owner: true } } });

    h.store.setState({ activeTabId: 'a' });
    await h.answerAll({ owner: true });

    expect(h.mage.acquireConversationLock).toHaveBeenCalledTimes(3);
    expect(h.mage.acquireConversationLock).toHaveBeenLastCalledWith({ ...REF, tabId: 'a' });
    expect(h.store.getState().lockReclaimedByChat).toEqual({ a: true });
  });

  it('enfocarPestanaDuena_noPregunta', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' }), tab('b', { resumeSessionId: 'mia' })], activeTabId: 'b' });
    await h.answerAll({ owner: true });

    h.store.setState({ activeTabId: 'a' });

    expect(h.mage.acquireConversationLock).toHaveBeenCalledTimes(2);
  });

  it('focoDeLaVentana_revisaLaPestanaActivaEnSoloLectura', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' })], activeTabId: 'a' });
    await h.answerAll(READ_ONLY);

    h.focus();
    await h.answerAll({ owner: true });

    expect(h.mage.acquireConversationLock).toHaveBeenCalledTimes(2);
    expect(h.store.getState().lockReclaimedByChat).toEqual({ a: true });
  });

  it('cerrarPestanaConAviso_quitaElAvisoYCancelaSuTemporizador', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' })] });
    await h.answerAll(READ_ONLY);
    h.tick();
    await h.answerAll({ owner: true });

    h.store.setState({ tabs: [] });

    expect(h.store.getState().lockReclaimedByChat).toEqual({});
    expect(h.timers[0]?.cancelled).toBe(true);
  });
});
