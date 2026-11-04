import type { MageApi } from '@shared/ipc';
import { prKeyToString, type PrCatalogEntry, type PrDetail, type PrKey, type PrListResult, type PrListState, type PrWriteAction, type RepoMergeOptions } from '@shared/pr';
import type { Tab } from './types';
import type { WorkbenchState } from './workbenchStore';
import { conversationIdOfTab } from './conversationId';
import { conversationPrKeys, nextLimit, PR_PAGE_SIZE, repoKeyOf } from './prPanelModel';
import { describeError } from './describeError';
import { reportActionError } from './notificationStore';
import { t as translate } from '../i18n/uiLanguage';

// Estado y acciones del panel de PR (F5.5): listas por filtro, detalle, diff, catalogo de la conversacion y
// escrituras con el head esperado. Fuera de `workbenchStore.ts`, como `prActions.ts`; el store las mezcla tal cual.
// Las acciones de `prActions.ts` (la barra compacta) no cambian.

export interface PrRepoRef {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

export interface PrPanelState {
  readonly repo: PrRepoRef | null;
  readonly state: PrListState;
  readonly limit: number;
  readonly list: PrListResult | null;
  readonly loading: boolean;
  readonly selectedKey: string | null;
  readonly error: string | null;
}

export interface PrPanelStoreState {
  readonly prPanelByTab: Readonly<Record<string, PrPanelState>>;
  readonly prDetailByKey: Readonly<Record<string, PrDetail>>;
  readonly prDiffByKey: Readonly<Record<string, { readonly patch: string; readonly truncated: boolean }>>;
  readonly prCatalog: readonly PrCatalogEntry[];
  // Estrategias de fusion que permite cada repo (`host/owner/repo`): la de la lista del repo de la pestaña y la de
  // los repos de las PR vinculadas, que no salen en esa lista.
  readonly prMergeOptionsByRepo: Readonly<Record<string, RepoMergeOptions>>;
}

export interface PrPanelActions {
  loadPrPanel: (tabId: string) => Promise<void>;
  setPrListState: (tabId: string, state: PrListState) => Promise<void>;
  loadMorePrs: (tabId: string) => Promise<void>;
  selectPr: (tabId: string, key: PrKey | null) => Promise<void>;
  loadPrDiff: (tabId: string, key: PrKey) => Promise<void>;
  linkPrToConversation: (tabId: string, key: PrKey, primary: boolean) => Promise<void>;
  unlinkPrFromConversation: (tabId: string, key: PrKey) => Promise<void>;
  // true si la escritura se hizo; false si no (el head cambio, o fallo y se aviso).
  runPrAction: (tabId: string, key: PrKey, action: PrWriteAction) => Promise<boolean>;
  migratePrOnce: (tabId: string) => Promise<void>;
  // Deja en la caja (sin enviarlo) el prompt para que el agente resuelva los conflictos de la PR.
  insertResolveConflictsPrompt: (tabId: string, key: PrKey) => void;
}

export interface PrPanelDeps {
  readonly mage: Pick<MageApi, 'prRepoOf' | 'listPrs' | 'prDetail' | 'prDiff' | 'writePr' | 'listPrCatalog' | 'linkPr' | 'unlinkPr' | 'migrateTabPr'>;
  readonly get: () => WorkbenchState;
  readonly set: (fn: (s: WorkbenchState) => Partial<WorkbenchState>) => void;
  readonly insertPrompt: (tabId: string, prompt: string) => void;
}

export const EMPTY_PR_PANEL: PrPanelState = { repo: null, state: 'open', limit: PR_PAGE_SIZE, list: null, loading: false, selectedKey: null, error: null };

// Conversaciones cuyo `prNumber` ya se migro al catalogo en esta ejecucion. Solo en memoria: migrar es idempotente.
const migratedConversations = new Set<string>();

export function resetPrPanelState(): void {
  migratedConversations.clear();
}

export function createPrPanelActions(deps: PrPanelDeps): PrPanelActions {
  const { mage, get, set } = deps;
  const findTab = (tabId: string): Tab | undefined => get().tabs.find((tab) => tab.id === tabId);
  const folderOf = (tab: Tab): { readonly cwd: string; readonly accountDir: string } => ({ cwd: tab.cwd, accountDir: tab.accountId });
  const conversationOf = (tab: Tab): string | undefined => conversationIdOfTab(tab, get().sessionIdByChat[tab.id]);
  const panelOf = (tabId: string): PrPanelState => get().prPanelByTab[tabId] ?? EMPTY_PR_PANEL;
  const patchPanel = (tabId: string, patch: Partial<PrPanelState>): void =>
    set((s) => ({ prPanelByTab: { ...s.prPanelByTab, [tabId]: { ...(s.prPanelByTab[tabId] ?? EMPTY_PR_PANEL), ...patch } } }));

  const loadDetail = async (tab: Tab, key: PrKey): Promise<void> => {
    const detail = await mage.prDetail({ ...folderOf(tab), key });
    set((s) => ({ prDetailByKey: { ...s.prDetailByKey, [prKeyToString(key)]: detail } }));
  };

  const rememberMergeOptions = (repo: PrRepoRef, options: RepoMergeOptions): void =>
    set((s) => ({ prMergeOptionsByRepo: { ...s.prMergeOptionsByRepo, [repoKeyOf(repo)]: options } }));

  // Las opciones de fusion de un repo que no es el de la pestaña salen de leer una PR de su lista.
  const ensureMergeOptions = async (tab: Tab, key: PrKey): Promise<void> => {
    if (get().prMergeOptionsByRepo[repoKeyOf(key)] !== undefined) return;
    const repo = { host: key.host, owner: key.owner, repo: key.repo };
    const result = await mage.listPrs({ ...folderOf(tab), repo, state: 'all', limit: 1 });
    if (result.kind === 'list') rememberMergeOptions(repo, result.mergeOptions);
  };

  const loadDetailWithOptions = async (tab: Tab, key: PrKey): Promise<void> => {
    await loadDetail(tab, key);
    await ensureMergeOptions(tab, key);
  };

  const loadCatalog = async (tab: Tab): Promise<void> => {
    const conversationId = conversationOf(tab);
    const prCatalog = conversationId === undefined ? [] : await mage.listPrCatalog(conversationId);
    set(() => ({ prCatalog }));
  };

  // Detalle de las PR vinculadas (su titulo y estado salen de ahi); las que fallan se cuentan en `error`.
  const loadLinkedDetails = async (tab: Tab): Promise<void> => {
    const conversationId = conversationOf(tab);
    if (conversationId === undefined) return;
    const linked = conversationPrKeys(get().prCatalog, conversationId);
    const results = await Promise.allSettled(linked.map((pr) => loadDetailWithOptions(tab, pr.key)));
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed !== undefined) patchPanel(tab.id, { error: describeError(failed.reason) });
  };

  const loadList = async (tab: Tab): Promise<void> => {
    const { repo, state, limit } = panelOf(tab.id);
    if (repo === null) return;
    const list = await mage.listPrs({ ...folderOf(tab), repo, state, limit });
    if (list.kind === 'list') rememberMergeOptions(repo, list.mergeOptions);
    // Una respuesta de un filtro o limite que ya no es el actual se descarta.
    const current = panelOf(tab.id);
    if (current.state === state && current.limit === limit) patchPanel(tab.id, { list });
  };

  const guarded = async (tabId: string, work: (tab: Tab) => Promise<void>): Promise<void> => {
    const tab = findTab(tabId);
    if (tab === undefined || tab.cwd.length === 0) return;
    patchPanel(tabId, { loading: true, error: null });
    try {
      await work(tab);
    } catch (err) {
      patchPanel(tabId, { error: describeError(err) });
    } finally {
      patchPanel(tabId, { loading: false });
    }
  };

  const loadAll = async (tab: Tab): Promise<void> => {
    patchPanel(tab.id, { repo: await mage.prRepoOf(folderOf(tab)) });
    await loadCatalog(tab);
    await Promise.all([loadList(tab), loadLinkedDetails(tab)]);
  };

  const reloadAfterWrite = async (tab: Tab, key: PrKey): Promise<void> => {
    await Promise.all([loadDetail(tab, key), loadList(tab)]);
  };

  const write = async (tab: Tab, key: PrKey, action: PrWriteAction): Promise<boolean> => {
    const detail = get().prDetailByKey[prKeyToString(key)];
    if (detail === undefined) throw new Error(`Falta el detalle cargado de ${prKeyToString(key)} para escribir ${action.kind}`);
    const result = await mage.writePr({ ...folderOf(tab), key, expectedHeadSha: detail.headSha, action });
    if (result.kind === 'conflict') {
      patchPanel(tab.id, { error: translate('pr.conflict') });
      await loadDetail(tab, key);
      return false;
    }
    patchPanel(tab.id, { error: null });
    await reloadAfterWrite(tab, key);
    return true;
  };

  return {
    loadPrPanel: (tabId) => guarded(tabId, loadAll),

    setPrListState: async (tabId, state) => {
      patchPanel(tabId, { state, limit: PR_PAGE_SIZE, list: null });
      await guarded(tabId, loadList);
    },

    loadMorePrs: async (tabId) => {
      patchPanel(tabId, { limit: nextLimit(panelOf(tabId).limit) });
      await guarded(tabId, loadList);
    },

    selectPr: async (tabId, key) => {
      patchPanel(tabId, { selectedKey: key === null ? null : prKeyToString(key) });
      if (key !== null) await guarded(tabId, (tab) => loadDetailWithOptions(tab, key));
    },

    loadPrDiff: (tabId, key) =>
      guarded(tabId, async (tab) => {
        const diff = await mage.prDiff({ ...folderOf(tab), key });
        set((s) => ({ prDiffByKey: { ...s.prDiffByKey, [prKeyToString(key)]: diff } }));
      }),

    linkPrToConversation: (tabId, key, primary) =>
      guarded(tabId, async (tab) => {
        const conversationId = conversationOf(tab);
        if (conversationId === undefined) throw new Error(`La pestaña ${tabId} aun no tiene conversacion a la que vincular ${prKeyToString(key)}`);
        await mage.linkPr({ key: prKeyToString(key), conversationId, primary });
        await loadCatalog(tab);
        await loadLinkedDetails(tab);
      }),

    unlinkPrFromConversation: (tabId, key) =>
      guarded(tabId, async (tab) => {
        const conversationId = conversationOf(tab);
        if (conversationId === undefined) return;
        await mage.unlinkPr({ key: prKeyToString(key), conversationId });
        await loadCatalog(tab);
      }),

    runPrAction: async (tabId, key, action) => {
      const tab = findTab(tabId);
      if (tab === undefined) return false;
      try {
        return await write(tab, key, action);
      } catch (err) {
        reportActionError(translate('pr.actionFailed'), err, 'pr');
        return false;
      }
    },

    migratePrOnce: async (tabId) => {
      const tab = findTab(tabId);
      const conversationId = tab === undefined ? undefined : conversationOf(tab);
      if (tab?.prNumber === undefined || conversationId === undefined || migratedConversations.has(conversationId)) return;
      migratedConversations.add(conversationId);
      try {
        await mage.migrateTabPr({ ...folderOf(tab), conversationId, number: tab.prNumber });
      } catch (err) {
        migratedConversations.delete(conversationId);
        reportActionError(translate('pr.migrateFailed'), err, 'pr');
      }
    },

    insertResolveConflictsPrompt: (tabId, key) => {
      const detail = get().prDetailByKey[prKeyToString(key)];
      if (detail === undefined) throw new Error(`Falta el detalle cargado de ${prKeyToString(key)} para pedir resolver sus conflictos`);
      deps.insertPrompt(tabId, translate('pr.resolveConflictsPrompt', { number: detail.number, head: detail.headRefName, base: detail.baseRefName }));
    },
  };
}
