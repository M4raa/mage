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
  readonly activeTabId: string;
  readonly sessionIdByChat: Readonly<Record<string, string>>;
  readonly lockByChat: Readonly<Record<string, ConversationLockStatus>>;
  // Pestañas que acaban de pasar de solo lectura a dueñas porque la otra instancia soltó la conversación: la pestaña lo
  // dice un momento («Ya puedes continuar aquí»). Respuesta 4 de la devolución 17.
  readonly lockReclaimedByChat: Readonly<Record<string, true>>;
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
  // Una vez, pasado `ms` (`setTimeout` en producción); devuelve cómo cancelarla.
  readonly after?: (fn: () => void, ms: number) => () => void;
  // La ventana recupera el foco (`focus` de `window` en producción); devuelve cómo dejar de escuchar.
  readonly onWindowFocus?: (fn: () => void) => () => void;
}

// Cada cuánto se vuelve a preguntar por una conversación en solo lectura: el ritmo del latido de main. Si la otra
// instancia la soltó, esta pasa a ser la dueña; si murió (pid caído o sin latido), se ofrece «Tomar el control».
export const READ_ONLY_RECHECK_MS = 30_000;
// Cuánto se ve «Ya puedes continuar aquí».
export const RECLAIMED_NOTICE_MS = 6_000;

const defaultEvery = (fn: () => void, ms: number): (() => void) => {
  const timer = setInterval(fn, ms);
  return () => clearInterval(timer);
};

const defaultAfter = (fn: () => void, ms: number): (() => void) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

const defaultOnWindowFocus = (fn: () => void): (() => void) => {
  window.addEventListener('focus', fn);
  return () => window.removeEventListener('focus', fn);
};

// El resultado de preguntar por la pestaña. Si estaba en solo lectura y ahora es suya (la otra la soltó), se marca para
// el aviso; «Tomar el control» no pasa por aquí (lo pide el usuario y no hace falta decírselo).
function lockPatch(state: LockSyncState, tabId: string, status: ConversationLockStatus): Partial<LockSyncState> {
  const reclaimed = status.owner && state.lockByChat[tabId]?.owner === false;
  return {
    lockByChat: { ...state.lockByChat, [tabId]: status },
    ...(reclaimed ? { lockReclaimedByChat: { ...state.lockReclaimedByChat, [tabId]: true } } : {}),
  };
}

function clearReclaimed(state: LockSyncState, tabId: string): Partial<LockSyncState> {
  return state.lockReclaimedByChat[tabId] === undefined ? {} : { lockReclaimedByChat: withoutKey(state.lockReclaimedByChat, tabId) };
}

// Arranca la sincronización; devuelve cómo pararla.
export function startConversationLockSync(deps: LockSyncDeps): () => void {
  return new ConversationLockSync(deps).start();
}

class ConversationLockSync {
  private readonly held = new Map<string, ConversationLockRef>();
  private readonly noticeTimers = new Map<string, () => void>();
  private readonly every: NonNullable<LockSyncDeps['every']>;
  private readonly after: NonNullable<LockSyncDeps['after']>;
  private readonly onWindowFocus: NonNullable<LockSyncDeps['onWindowFocus']>;
  private activeTabId: string;

  constructor(private readonly deps: LockSyncDeps) {
    this.every = deps.every ?? defaultEvery;
    this.after = deps.after ?? defaultAfter;
    this.onWindowFocus = deps.onWindowFocus ?? defaultOnWindowFocus;
    this.activeTabId = deps.store.getState().activeTabId;
  }

  start(): () => void {
    const { store, mage } = this.deps;
    this.reconcile(store.getState());
    const unsubscribe = store.subscribe((state) => this.reconcile(state));
    // Otra instancia tomó el control de una de las nuestras: se vuelve a preguntar (y queda en solo lectura).
    const offLost = mage.onConversationLockLost((lost) => {
      for (const [tabId, ref] of [...this.held]) if (sameRef(ref, lost)) this.acquire(tabId, ref);
    });
    const stopRecheck = this.every(() => {
      for (const tabId of [...this.held.keys()]) this.recheck(tabId);
    }, READ_ONLY_RECHECK_MS);
    const offFocus = this.onWindowFocus(() => this.recheck(store.getState().activeTabId));
    return () => {
      unsubscribe();
      offLost();
      stopRecheck();
      offFocus();
      for (const cancel of this.noticeTimers.values()) cancel();
      this.noticeTimers.clear();
    };
  }

  private reconcile(state: LockSyncState): void {
    const wanted = new Map<string, ConversationLockRef>();
    for (const tab of state.tabs) {
      const ref = lockRefOf(tab, state.sessionIdByChat[tab.id]);
      if (ref !== null) wanted.set(tab.id, ref);
    }
    for (const [tabId, ref] of [...this.held]) {
      const next = wanted.get(tabId);
      if (next === undefined || !sameRef(next, ref)) this.release(tabId, ref);
    }
    for (const [tabId, ref] of wanted) if (!this.held.has(tabId)) this.acquire(tabId, ref);
    // Al enfocar una pestaña en solo lectura se revisa en el acto, sin esperar a la revisión periódica.
    if (state.activeTabId === this.activeTabId) return;
    this.activeTabId = state.activeTabId;
    this.recheck(this.activeTabId);
  }

  private acquire(tabId: string, ref: ConversationLockRef): void {
    const { store, mage, reportError } = this.deps;
    this.held.set(tabId, ref);
    mage
      .acquireConversationLock({ ...ref, tabId })
      .then((status) => {
        // La pestaña cambió de conversación (o se cerró) mientras se preguntaba: ese resultado ya no es suyo.
        if (this.held.get(tabId) !== ref) return;
        store.setState((state) => lockPatch(state, tabId, status));
        if (store.getState().lockReclaimedByChat[tabId] === true) this.showReclaimed(tabId);
      })
      .catch((err: unknown) => reportError('No se pudo comprobar si la conversación está abierta en otra instancia', err));
  }

  private release(tabId: string, ref: ConversationLockRef): void {
    this.held.delete(tabId);
    this.cancelNotice(tabId);
    this.deps.store.setState((state) => ({
      ...(state.lockByChat[tabId] === undefined ? {} : { lockByChat: withoutKey(state.lockByChat, tabId) }),
      ...clearReclaimed(state, tabId),
    }));
    this.deps.mage.releaseConversationLock({ ...ref, tabId }).catch((err: unknown) => this.deps.reportError('No se pudo soltar la conversación', err));
  }

  // Vuelve a preguntar por una pestaña solo si la ve en solo lectura.
  private recheck(tabId: string): void {
    const ref = this.held.get(tabId);
    if (ref !== undefined && this.deps.store.getState().lockByChat[tabId]?.owner === false) this.acquire(tabId, ref);
  }

  private showReclaimed(tabId: string): void {
    this.cancelNotice(tabId);
    this.noticeTimers.set(tabId, this.after(() => {
      this.noticeTimers.delete(tabId);
      this.deps.store.setState((state) => clearReclaimed(state, tabId));
    }, RECLAIMED_NOTICE_MS));
  }

  private cancelNotice(tabId: string): void {
    this.noticeTimers.get(tabId)?.();
    this.noticeTimers.delete(tabId);
  }
}

function withoutKey<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T> {
  const { [key]: _removed, ...rest } = record;
  return rest;
}
