import { describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { ConversationLockRef, ConversationLockStatus } from '@shared/conversationLock';
import { lockRefOf, startConversationLockSync, type LockSyncMage, type LockSyncState } from './conversationLockSync';
import type { Tab } from './types';

const tab = (id: string, overrides: Partial<Tab> = {}): Tab => ({ id, accountId: '/home/u/.claude', accountAlias: 'u', cwd: '/p', model: 'm', provider: 'claude', title: id, privacy: 'shared', ...overrides }) as Tab;

function setup(initial: Partial<LockSyncState> = {}, answer: ConversationLockStatus = { owner: true }) {
  const store = createStore<LockSyncState>(() => ({ tabs: [], sessionIdByChat: {}, lockByChat: {}, ...initial }));
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
  const stop = startConversationLockSync({ store, mage, reportError, every });
  const answerAll = async (status: ConversationLockStatus = answer) => {
    for (const entry of pending.splice(0)) entry.resolve(status);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { store, mage, reportError, stop, answerAll, lose: (ref: ConversationLockRef) => lost(ref), tick: () => tick(), every };
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
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' })] }, { owner: false, profile: 'mage', orphan: false });

    await h.answerAll();

    expect(h.mage.acquireConversationLock).toHaveBeenCalledWith({ ...REF, tabId: 'a' });
    expect(h.store.getState().lockByChat).toEqual({ a: { owner: false, profile: 'mage', orphan: false } });
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
    await h.answerAll({ owner: false, profile: 'mage-dev', orphan: false });

    expect(h.mage.acquireConversationLock).toHaveBeenCalledTimes(3);
    expect(h.store.getState().lockByChat).toEqual({ a: { owner: false, profile: 'mage-dev', orphan: false }, b: { owner: true } });
  });

  it('revision_soloLectura_vuelveAPreguntarCada30sYVeElHuerfano', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' }), tab('b', { resumeSessionId: 'mia' })] });
    await h.answerAll();
    h.store.setState({ lockByChat: { a: { owner: false, profile: 'mage', orphan: false }, b: { owner: true } } });

    h.tick();
    await h.answerAll({ owner: false, profile: 'mage', orphan: true });

    expect(h.every.mock.calls[0]?.[1]).toBe(30_000);
    expect(h.mage.acquireConversationLock).toHaveBeenCalledTimes(3);
    expect(h.store.getState().lockByChat.a).toEqual({ owner: false, profile: 'mage', orphan: true });
    expect(h.store.getState().lockByChat.b).toEqual({ owner: true });
  });

  it('fallaLaPregunta_seAvisaSinRomperLaSincronizacion', async () => {
    const h = setup({ tabs: [tab('a', { resumeSessionId: 'c1' })] });
    h.mage.acquireConversationLock.mockRejectedValueOnce(new Error('main caído'));

    h.store.setState({ tabs: [tab('a', { resumeSessionId: 'c1' }), tab('b', { resumeSessionId: 'c3' })] });
    await h.answerAll();

    expect(h.reportError).toHaveBeenCalledTimes(1);
  });
});
