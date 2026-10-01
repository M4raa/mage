import { sanitizeAlwaysAllow } from './permissionRules';
import type { PersistedTab, PersistedWorkspace, SplitLayout } from '@shared/state';
import { WORKSPACE_STATE_VERSION } from '@shared/state';
import { isPermissionMode } from '@shared/ipc';
import type { Tab } from './types';
import { findLeafPath, fromLegacySplit, singleLeaf, pruneSplitLayout } from './splitLayout';

// Mapeo PURO entre el estado del workbench y el workspace persistido (M2.5). Sin IPC ni store: el
// store llama a estas funciones y delega el I/O en window.mage.{load,save}Workspace.

// Construye el snapshot a persistir. El sessionId de cada pestana es el de su sesion VIVA si existe
// (sessionIdByChat), o el `resumeSessionId` heredado de un arranque anterior (para no perder la
// posibilidad de reanudar una pestana restaurada que aun no se ha usado en esta sesion).
export function toPersistedWorkspace(
  tabs: readonly Tab[],
  activeTabId: string,
  sessionIdByChat: Readonly<Record<string, string>>,
  splitLayout: SplitLayout = singleLeaf(activeTabId),
): PersistedWorkspace {
  const persistedTabs = tabs.map((tab): PersistedTab => {
    const sessionId = sessionIdByChat[tab.id] ?? tab.resumeSessionId;
    return {
      id: tab.id,
      accountId: tab.accountId,
      accountAlias: tab.accountAlias,
      cwd: tab.cwd,
      model: tab.model,
      provider: tab.provider,
      title: tab.title,
      privacy: tab.privacy,
      ...(tab.resolvedConfigDir === undefined ? {} : { resolvedConfigDir: tab.resolvedConfigDir }),
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(tab.effort === undefined ? {} : { effort: tab.effort }),
      ...(tab.maxBudgetUsdCents === undefined ? {} : { maxBudgetUsdCents: tab.maxBudgetUsdCents }),
      ...(isPermissionMode(tab.permissionMode) ? { permissionMode: tab.permissionMode } : {}),
      // Vacia NO se guarda: en el workspace, "sin reglas" y "sin campo" son lo mismo (el estado
      // duradero de las reglas vive en el indice de conversaciones, que si distingue los dos casos).
      ...(tab.alwaysAllowTools === undefined || tab.alwaysAllowTools.length === 0 ? {} : { alwaysAllowTools: tab.alwaysAllowTools }),
      ...(tab.createdAtMs === undefined ? {} : { createdAtMs: tab.createdAtMs }),
      ...(tab.lastMessageAtMs === undefined ? {} : { lastMessageAtMs: tab.lastMessageAtMs }),
      ...(tab.pinned === undefined ? {} : { pinned: tab.pinned }),
      ...(tab.colorIndex === undefined ? {} : { colorIndex: tab.colorIndex }),
      ...(tab.pendingCliTitle === undefined ? {} : { pendingCliTitle: tab.pendingCliTitle }),
      ...prFields(tab),
    };
  });
  return {
    version: WORKSPACE_STATE_VERSION,
    activeTabId,
    tabs: persistedTabs,
    // Un panel unico no significa nada distinto de "sin campo": no se guarda para no meter ruido en
    // el fichero (mismo criterio que el `splitTabId: null` de antes de I11).
    ...(splitLayout.kind === 'leaf' && splitLayout.tabIds.length === 1 && splitLayout.tabIds[0] === activeTabId
      ? {}
      : { splitLayout }),
  };
}

export interface RestoredTabs {
  readonly tabs: readonly Tab[];
  readonly activeTabId: string;
  // Arbol de division restaurado, ya podado contra las pestañas supervivientes (I11).
  readonly splitLayout: SplitLayout;
}

// Reconstruye las pestanas desde el workspace persistido, descartando las de cuentas que ya no
// existen (cuenta borrada entre arranques) para no dejar pestanas huerfanas sin cuenta valida. El
// sessionId persistido pasa a `resumeSessionId` (la sesion NO se arranca aqui: resume perezoso). La
// pestana activa se conserva si sigue presente; si no, la primera; si no hay ninguna, "".
export function restoreTabs(
  persisted: PersistedWorkspace,
  existingAccountIds: ReadonlySet<string>,
): RestoredTabs {
  const tabs = persisted.tabs
    .filter((t) => existingAccountIds.has(t.accountId))
    .map((t): Tab => ({
      id: t.id,
      accountId: t.accountId,
      accountAlias: t.accountAlias,
      cwd: t.cwd,
      model: t.model,
      provider: t.provider,
      title: t.title,
      privacy: t.privacy,
      ...(t.resolvedConfigDir === undefined ? {} : { resolvedConfigDir: t.resolvedConfigDir }),
      ...(t.sessionId === undefined ? {} : { resumeSessionId: t.sessionId }),
      ...(t.effort === undefined ? {} : { effort: t.effort }),
      ...(t.maxBudgetUsdCents === undefined ? {} : { maxBudgetUsdCents: t.maxBudgetUsdCents }),
      ...(t.permissionMode === undefined ? {} : { permissionMode: t.permissionMode }),
      // Saneado al ENTRAR: el fichero pudo escribirlo otra version de Mage o una mano humana.
      ...(t.alwaysAllowTools === undefined ? {} : { alwaysAllowTools: sanitizeAlwaysAllow(t.alwaysAllowTools) }),
      ...(t.createdAtMs === undefined ? {} : { createdAtMs: t.createdAtMs }),
      ...(t.lastMessageAtMs === undefined ? {} : { lastMessageAtMs: t.lastMessageAtMs }),
      ...(t.pinned === undefined ? {} : { pinned: t.pinned }),
      ...(t.colorIndex === undefined ? {} : { colorIndex: t.colorIndex }),
      ...(t.pendingCliTitle === undefined ? {} : { pendingCliTitle: t.pendingCliTitle }),
      ...prFields(t),
    }));

  const activeTabId = tabs.some((t) => t.id === persisted.activeTabId)
    ? persisted.activeTabId
    : (tabs[0]?.id ?? '');
  const survivingIds = new Set(tabs.map((t) => t.id));
  // I11: `splitLayout` es la forma nueva y manda si esta presente; si no, se migra la forma vieja
  // (`splitTabId`/`splitDirection`, como mucho un segundo panel) a un arbol de un solo nivel. Podado
  // contra las pestañas supervivientes por si una cuenta borrada se llevo alguna hoja por delante.
  const rawLayout: SplitLayout =
    persisted.splitLayout ?? fromLegacySplit(activeTabId, persisted.splitTabId ?? null, persisted.splitDirection === 'col' ? 'col' : 'row');
  const pruned = activeTabId.length === 0 ? null : pruneSplitLayout(rawLayout, survivingIds);
  const splitLayout = pruned === null || findLeafPath(pruned, activeTabId) === null ? singleLeaf(activeTabId) : pruned;
  return { tabs, activeTabId, splitLayout };
}

// Los tres campos del PR vinculado (grupo D) viajan igual en las dos direcciones; ausentes no se escriben.
function prFields(tab: Pick<Tab, 'prNumber' | 'prDismissed' | 'prAutoFix'>): Pick<Tab, 'prNumber' | 'prDismissed' | 'prAutoFix'> {
  return {
    ...(tab.prNumber === undefined ? {} : { prNumber: tab.prNumber }),
    ...(tab.prDismissed === undefined ? {} : { prDismissed: tab.prDismissed }),
    ...(tab.prAutoFix === undefined ? {} : { prAutoFix: tab.prAutoFix }),
  };
}
