import type { GhPrUpdate, GhRunsSnapshot, GhSnapshot } from '@shared/gh';
import type { MageApi } from '@shared/ipc';
import type { Tab } from './types';
import type { WorkbenchState } from './workbenchStore';
import { buildCiMonitorEvent, pendingAutoFix } from './ciMonitorEvent';
import { prBarView } from './chatInfoView';

// PR y CI de una pestaña (grupo D, como Claude Desktop). Las acciones del store que hablan con `gh` por
// main, fuera de `workbenchStore.ts` para no engordarlo; el store las mezcla tal cual.

export interface PrState {
  // Ultima lectura del PR de la pestaña: la del vinculado (llega de la vigilancia de main) o, sin vinculo,
  // la de su rama.
  readonly prByTab: Readonly<Record<string, GhSnapshot>>;
  readonly ghRunsByTab: Readonly<Record<string, GhRunsSnapshot>>;
  // Pestañas cuyo turno en marcha es el de «Crear PR»: sus barreras de permiso estan activas.
  readonly prGuardByChat: Readonly<Record<string, true>>;
}

export interface PrActions {
  refreshPr: (tabId: string) => Promise<void>;
  bindPr: (tabId: string, number: number) => void;
  unbindPr: (tabId: string) => void;
  applyGhPrUpdate: (update: GhPrUpdate) => void;
  // D27: deja en el input el prompt de crear el PR, SIN enviarlo (DN-3).
  insertCreatePrPrompt: (tabId: string) => void;
  setPrAutoFix: (tabId: string, enabled: boolean) => void;
  loadGhRuns: (tabId: string) => Promise<void>;
  ghRunAction: (tabId: string, runId: number, action: 'rerun' | 'cancel') => Promise<void>;
  setPrAutoMerge: (tabId: string, enabled: boolean) => Promise<void>;
  setGhNoticeDismissed: (dismissed: boolean) => void;
  setAutoArchiveOnPrClose: (enabled: boolean) => void;
}

export interface PrDeps {
  readonly mage: Pick<MageApi, 'ghBranchPr' | 'ghWatch' | 'ghUnwatch' | 'ghRuns' | 'ghRunAction' | 'ghAutoMerge' | 'notify'>;
  readonly get: () => WorkbenchState;
  readonly set: (fn: (s: WorkbenchState) => Partial<WorkbenchState>) => void;
  readonly persistTabs: () => void;
  readonly persistSettings: () => void;
  readonly insertPrompt: (tabId: string, prompt: string) => void;
  readonly sendToTab: (tabId: string, text: string) => Promise<void>;
  readonly archiveTab: (tabId: string) => Promise<void>;
}

export const CREATE_PR_PROMPT =
  'Crea un pull request de esta rama. Revisa el diff y haz commit de lo pendiente con un mensaje descriptivo (si estás en la rama principal, crea antes una rama nueva). ' +
  'Haz un push normal de la rama a su remoto, sin forzar, y abre el PR con `gh pr create` con un título y una descripción que expliquen el cambio. ' +
  'Cuando exista, escribe su URL entre <pr-created> y </pr-created>.';

// Checks rotos y conflictos ya mandados al agente, por pestaña: `${sha}:${check}`. Solo en memoria.
// ponytail: tras reiniciar, un PR que sigue roto vuelve a mandarse una vez (el auto-fix sigue encendido).
const autoFixSent = new Map<string, Set<string>>();

export function resetPrActionsState(): void {
  autoFixSent.clear();
}

function patchTab(set: PrDeps['set'], tabId: string, patch: (tab: Tab) => Tab): void {
  set((s) => ({ tabs: s.tabs.map((t) => (t.id === tabId ? patch(t) : t)) }));
}

function paramsOf(tab: Tab): { readonly cwd: string; readonly accountDir: string } {
  return { cwd: tab.cwd, accountDir: tab.accountId };
}

export function createPrActions(deps: PrDeps): PrActions {
  const { mage, get, set } = deps;
  const findTab = (tabId: string): Tab | undefined => get().tabs.find((t) => t.id === tabId);
  const setSnapshot = (tabId: string, snapshot: GhSnapshot): void => set((s) => ({ prByTab: { ...s.prByTab, [tabId]: snapshot } }));

  const watch = (tab: Tab, number: number): void => {
    void mage.ghWatch({ ...paramsOf(tab), key: tab.id, number }).catch((err: unknown) => console.warn('No se pudo vigilar el PR:', String(err)));
  };

  const bindPr = (tabId: string, number: number): void => {
    const tab = findTab(tabId);
    if (tab === undefined || tab.prNumber === number) return;
    patchTab(set, tabId, (t) => ({ ...t, prNumber: number }));
    deps.persistTabs();
    watch({ ...tab, prNumber: number }, number);
  };

  const notifyCiFinished = (tab: Tab, snapshot: GhSnapshot): void => {
    if (snapshot.kind !== 'pr') return;
    const view = prBarView(snapshot.pr);
    const counts = view.counts.map((c) => `${c.glyph}${c.count}`).join(' ');
    const sessionId = get().sessionIdByChat[tab.id] ?? tab.resumeSessionId;
    const target = sessionId === undefined ? {} : { target: { tabId: tab.id, sessionId } };
    void mage
      .notify({ title: 'CI terminado', body: `${tab.title}: ${view.label} ${counts}`, ...target })
      .catch((err: unknown) => console.warn('No se pudo avisar del fin del CI:', String(err)));
  };

  const runAutoFix = (tab: Tab, snapshot: GhSnapshot): void => {
    if (tab.prAutoFix !== true || snapshot.kind !== 'pr') return;
    const sent = autoFixSent.get(tab.id) ?? new Set<string>();
    const work = pendingAutoFix(snapshot.pr, sent);
    if (work === null) return;
    for (const key of work.keys) sent.add(key);
    autoFixSent.set(tab.id, sent);
    // Con un turno en marcha, `sendToTab` lo deja en la cola de Mage y sale al acabar ese turno.
    void deps.sendToTab(tab.id, buildCiMonitorEvent(snapshot.pr, work));
  };

  // «Auto-archive» de Desktop: PR fusionado o cerrado + ajuste encendido + pestaña parada → se archiva.
  const autoArchive = (tab: Tab, snapshot: GhSnapshot): void => {
    if (!get().settings.autoArchiveOnPrClose || snapshot.kind !== 'pr' || snapshot.pr.state === 'open') return;
    const status = get().statusByChat[tab.id];
    if (status === 'streaming' || status === 'needs_permission') return;
    void deps.archiveTab(tab.id).catch((err: unknown) => console.warn('No se pudo archivar la conversación:', String(err)));
  };

  return {
    refreshPr: async (tabId) => {
      const tab = findTab(tabId);
      if (tab === undefined || tab.cwd.length === 0) return;
      if (tab.prNumber !== undefined) {
        watch(tab, tab.prNumber);
        return;
      }
      const snapshot = await mage.ghBranchPr(paramsOf(tab));
      setSnapshot(tabId, snapshot);
      // Tercera señal de Desktop: la rama tiene un PR abierto (salvo el que el usuario quito con la ✕).
      if (snapshot.kind === 'pr' && snapshot.pr.state === 'open' && snapshot.pr.number !== tab.prDismissed) bindPr(tabId, snapshot.pr.number);
    },

    bindPr,

    unbindPr: (tabId) => {
      const tab = findTab(tabId);
      if (tab?.prNumber === undefined) return;
      const dismissed = tab.prNumber;
      patchTab(set, tabId, ({ prNumber: _quitado, prAutoFix: _off, ...rest }) => ({ ...rest, prDismissed: dismissed }));
      set((s) => {
        const { [tabId]: _sinPr, ...prByTab } = s.prByTab;
        return { prByTab };
      });
      deps.persistTabs();
      void mage.ghUnwatch(tabId).catch((err: unknown) => console.warn('No se pudo dejar de vigilar el PR:', String(err)));
    },

    applyGhPrUpdate: (update) => {
      const tab = findTab(update.key);
      // Una lectura de un PR que ya no es el vinculado (se quito o cambio mientras se leia) se descarta.
      if (tab === undefined || tab.prNumber === undefined) return;
      if (update.snapshot.kind === 'pr' && update.snapshot.pr.number !== tab.prNumber) return;
      setSnapshot(tab.id, update.snapshot);
      if (update.ciFinished) notifyCiFinished(tab, update.snapshot);
      runAutoFix(tab, update.snapshot);
      autoArchive(tab, update.snapshot);
    },

    insertCreatePrPrompt: (tabId) => deps.insertPrompt(tabId, CREATE_PR_PROMPT),

    setPrAutoFix: (tabId, enabled) => {
      patchTab(set, tabId, (t) => ({ ...t, prAutoFix: enabled }));
      deps.persistTabs();
      const tab = findTab(tabId);
      const snapshot = get().prByTab[tabId];
      // Al encenderlo con el PR ya roto, se actua sobre lo que hay (no se espera al siguiente sondeo).
      if (enabled && tab !== undefined && snapshot !== undefined) runAutoFix(tab, snapshot);
    },

    loadGhRuns: async (tabId) => {
      const tab = findTab(tabId);
      const snapshot = get().prByTab[tabId];
      if (tab === undefined || snapshot?.kind !== 'pr') return;
      const runs = await mage.ghRuns({ ...paramsOf(tab), branch: snapshot.pr.headRefName });
      set((s) => ({ ghRunsByTab: { ...s.ghRunsByTab, [tabId]: runs } }));
    },

    ghRunAction: async (tabId, runId, action) => {
      const tab = findTab(tabId);
      if (tab === undefined) return;
      await mage.ghRunAction({ ...paramsOf(tab), runId, action });
      await refreshAfterAction(tab);
    },

    setPrAutoMerge: async (tabId, enabled) => {
      const tab = findTab(tabId);
      if (tab?.prNumber === undefined) return;
      await mage.ghAutoMerge({ ...paramsOf(tab), number: tab.prNumber, enabled });
      await refreshAfterAction(tab);
    },

    setAutoArchiveOnPrClose: (enabled) => {
      set((s) => ({ settings: { ...s.settings, autoArchiveOnPrClose: enabled } }));
      deps.persistSettings();
    },

    setGhNoticeDismissed: (dismissed) => {
      set((s) => ({ settings: { ...s.settings, ghNoticeDismissed: dismissed } }));
      deps.persistSettings();
    },
  };

  // Tras escribir en GitHub: relee los runs y pide un sondeo ya del PR.
  async function refreshAfterAction(tab: Tab): Promise<void> {
    if (tab.prNumber !== undefined) watch(tab, tab.prNumber);
    const snapshot = get().prByTab[tab.id];
    if (snapshot?.kind !== 'pr') return;
    const runs = await mage.ghRuns({ ...paramsOf(tab), branch: snapshot.pr.headRefName });
    set((s) => ({ ghRunsByTab: { ...s.ghRunsByTab, [tab.id]: runs } }));
  }
}
