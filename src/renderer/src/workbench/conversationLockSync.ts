import type { ConversationLockRef, ConversationLockStatus } from '@shared/conversationLock';
import { AGY_PROVIDER_ID, CODEX_PROVIDER_ID } from '@shared/providers';
import type { MageApi } from '@shared/ipc';
import type { Tab } from './types';

// Bloqueo de conversación entre instancias (#55, F2.8), lado del renderer: cada pestaña con conversación (reanudada o
// ya ligada a su id nativo) la pide a main; al cerrarse o cambiar de conversación, la suelta. Una sola suscripción al
// store cubre todos los caminos (abrir, restaurar, `session_init`, reasignar cuenta, cerrar), en vez de una llamada en
// cada uno. El resultado (dueña o solo lectura) queda en `lockByChat`.

// Proveedores cuyo id de conversación viene del CLI (`thread`/`cascade`), no del id de sesión de Mage.
const OWN_CONVERSATION_PROVIDERS: readonly string[] = [CODEX_PROVIDER_ID, AGY_PROVIDER_ID];

export function lockRefOf(tab: Tab, liveSessionId: string | undefined): ConversationLockRef | null {
  const nativeId = OWN_CONVERSATION_PROVIDERS.includes(tab.provider) ? tab.resumeSessionId : (liveSessionId ?? tab.resumeSessionId);
  if (nativeId === undefined || nativeId.length === 0) return null;
  return { provider: tab.provider, accountDir: tab.accountId, nativeId };
}

export function sameRef(a: ConversationLockRef, b: ConversationLockRef): boolean {
  return a.provider === b.provider && a.accountDir === b.accountDir && a.nativeId === b.nativeId;
}

export interface LockSyncState {
  readonly tabs: readonly Tab[];
  readonly sessionIdByChat: Readonly<Record<string, string>>;
  readonly lockByChat: Readonly<Record<string, ConversationLockStatus>>;
}

export interface LockSyncStore {
  getState(): LockSyncState;
  setState(partial: (state: LockSyncState) => Partial<LockSyncState>): void;
  subscribe(listener: (state: LockSyncState) => void): () => void;
}

export type LockSyncMage = Pick<MageApi, 'acquireConversationLock' | 'releaseConversationLock' | 'onConversationLockLost'>;

export interface LockSyncDeps {
  readonly store: LockSyncStore;
  readonly mage: LockSyncMage;
  readonly reportError: (title: string, err: unknown) => void;
  // Revisión periódica de las pestañas en solo lectura (`setInterval` en producción); devuelve cómo pararla.
  readonly every?: (fn: () => void, ms: number) => () => void;
}

// Cada cuánto se vuelve a preguntar por una conversación en solo lectura: el ritmo del latido de main. Si la otra
// instancia la soltó, esta pasa a ser la dueña; si murió (pid caído o sin latido), se ofrece «Tomar el control».
export const READ_ONLY_RECHECK_MS = 30_000;

const defaultEvery = (fn: () => void, ms: number): (() => void) => {
  const timer = setInterval(fn, ms);
  return () => clearInterval(timer);
};

// Arranca la sincronización; devuelve cómo pararla.
export function startConversationLockSync({ store, mage, reportError, every = defaultEvery }: LockSyncDeps): () => void {
  const held = new Map<string, ConversationLockRef>();
  const acquire = (tabId: string, ref: ConversationLockRef): void => {
    held.set(tabId, ref);
    mage
      .acquireConversationLock({ ...ref, tabId })
      .then((status) => {
        // La pestaña cambió de conversación (o se cerró) mientras se preguntaba: ese resultado ya no es suyo.
        if (held.get(tabId) !== ref) return;
        store.setState((state) => ({ lockByChat: { ...state.lockByChat, [tabId]: status } }));
      })
      .catch((err: unknown) => reportError('No se pudo comprobar si la conversación está abierta en otra instancia', err));
  };
  const release = (tabId: string, ref: ConversationLockRef): void => {
    held.delete(tabId);
    store.setState((state) => (state.lockByChat[tabId] === undefined ? {} : { lockByChat: withoutKey(state.lockByChat, tabId) }));
    mage.releaseConversationLock({ ...ref, tabId }).catch((err: unknown) => reportError('No se pudo soltar la conversación', err));
  };
  const reconcile = (state: LockSyncState): void => {
    const wanted = new Map<string, ConversationLockRef>();
    for (const tab of state.tabs) {
      const ref = lockRefOf(tab, state.sessionIdByChat[tab.id]);
      if (ref !== null) wanted.set(tab.id, ref);
    }
    for (const [tabId, ref] of [...held]) {
      const next = wanted.get(tabId);
      if (next === undefined || !sameRef(next, ref)) release(tabId, ref);
    }
    for (const [tabId, ref] of wanted) if (!held.has(tabId)) acquire(tabId, ref);
  };
  reconcile(store.getState());
  const unsubscribe = store.subscribe(reconcile);
  // Otra instancia tomó el control de una de las nuestras: se vuelve a preguntar (y queda en solo lectura).
  const offLost = mage.onConversationLockLost((lost) => {
    for (const [tabId, ref] of [...held]) if (sameRef(ref, lost)) acquire(tabId, ref);
  });
  const stopRecheck = every(() => {
    const { lockByChat } = store.getState();
    for (const [tabId, ref] of [...held]) if (lockByChat[tabId]?.owner === false) acquire(tabId, ref);
  }, READ_ONLY_RECHECK_MS);
  return () => {
    unsubscribe();
    offLost();
    stopRecheck();
  };
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}
