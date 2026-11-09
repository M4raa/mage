import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { selectAccount, useWorkbenchStore } from '../workbenchStore';
import type { Account } from '../types';
import type { ConversationSummary } from '@shared/conversations';
import { backgroundMoveBlockedReason, backgroundOfConversation } from '../backgroundWork';
import { ConversationContextMenu, type ConversationTarget } from './ConversationContextMenu';
import type { ConversationPrivacy } from '@shared/state';
import { reportActionError } from '../notificationStore';
import type { ChatProject } from '@shared/settings';
import { conversationIdOfTab } from '../conversationId';
import { accountRecovery } from '../accountRecovery';
import { CliLoginPanel, useCliLogin } from './CliLoginPanel';
import { t as translate, useT } from '../../i18n/uiLanguage';
import { displayTitle } from '../conversationTitle';
import { accountToOpenWith, sidebarRowId, type SidebarRow } from '../sidebarModel';
import { SidebarHeader } from './sidebar/SidebarHeader';
import { SidebarRowItem } from './sidebar/SidebarRowItem';
import { FlatGroup, PROJECTS_COLLAPSED_LIMIT, ProjectGroupView, RowList, SectionLabel } from './sidebar/SidebarGroups';
import { useSidebarModel } from './sidebar/useSidebarModel';
import { TasksSection } from '../tasks/TasksSection';

// Estado del menu contextual abierto (posicion + conversacion objetivo).
interface MenuState {
  readonly target: ConversationTarget;
  readonly x: number;
  readonly y: number;
  // La fila del HISTORIAL sobre la que se abrio el menu, si venia de ahi. Es lo que hace falta para
  // "Abrir en una pestaña nueva": `ConversationTarget` no lleva cwd/configDir/updatedAtMs, y
  // `openConversation` los necesita para reanudar con `--resume` en vez de abrir una pestaña vacia.
  readonly item: ConversationSummary | undefined;
  readonly tabId: string | undefined;
  readonly tabPinned: boolean;
}

function menuTargetOf(row: SidebarRow, sessionId: string | undefined, title: string): ConversationTarget {
  const cwd = row.kind === 'tab' ? row.tab.cwd : row.item.cwd;
  const privacy = row.kind === 'tab' ? row.tab.privacy : row.item.privacy;
  return { sessionId, cwd, privacy, title, accountId: row.accountId };
}

function rowKey(row: SidebarRow): string {
  return row.kind === 'tab' ? `t:${row.tab.id}` : `h:${row.item.providerId ?? 'claude'}:${row.item.sessionId}`;
}

// Lateral de conversaciones de TODAS las cuentas con historial (D6): Fijadas → Proyectos (por carpeta y los
// del usuario) → Sin proyecto → Privadas; la cuenta y el proveedor son filtros. Una pestaña = una conversación
// real. El modelo (fusión, grupos, filtros) vive en `sidebarModel.ts` y `useSidebarModel`; esto solo pinta.
export function ChatSidebar(): React.JSX.Element {
  const t = useT();
  const account = useWorkbenchStore((s) => selectAccount(s, s.activeAccountId));
  const activeAccountId = useWorkbenchStore((s) => s.activeAccountId);
  const accounts = useWorkbenchStore((s) => s.accounts);
  const projects = useWorkbenchStore((s) => s.settings.chatProjects);
  const pinnedIds = useWorkbenchStore((s) => s.settings.pinnedConversations);
  const archivedIds = useWorkbenchStore((s) => s.settings.archivedConversations);
  const backgroundSessions = useWorkbenchStore((s) => s.backgroundSessions);
  const sessionIdByChat = useWorkbenchStore((s) => s.sessionIdByChat);
  const actions = useSidebarActions();
  const filter = useWorkbenchStore((s) => s.sidebarFilter);
  const setFilter = useWorkbenchStore((s) => s.setSidebarFilter);
  const view = useSidebarModel(filter);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [editingProject, setEditingProject] = useState<ChatProject | 'new' | null>(null);

  if (account === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-mg-panel p-4 text-center text-[11px] text-mg-muted">
        {t('sidebar.discoveringAccounts')}
      </div>
    );
  }

  const openMenu = (row: SidebarRow, x: number, y: number): void => {
    const sessionId = sidebarRowId(row, sessionIdByChat);
    const title = displayTitle(row.kind === 'tab' ? row.tab.title : row.item.title, t);
    setMenu({
      target: menuTargetOf(row, sessionId, title),
      x,
      y,
      item: row.kind === 'history' ? row.item : undefined,
      tabId: row.kind === 'tab' ? row.tab.id : undefined,
      tabPinned: row.kind === 'tab' && row.tab.pinned === true,
    });
  };
  const renderRow = (row: SidebarRow): React.ReactNode => (
    <SidebarRowItem
      key={rowKey(row)}
      row={row}
      account={view.accountOf(row)}
      missingOwner={view.missingOwnerOf(row)}
      status={view.statusOf(row)}
      indicator={view.indicatorOf(row)}
      background={view.backgroundOf(row)}
      onSelectTab={actions.setActiveTab}
      onOpenHistory={(historyRow) => {
        if (historyRow.kind === 'history') void actions.openConversation(historyRow.item, accountToOpenWith(historyRow, { id: account.id, providerId: account.providerId }));
      }}
      onRename={actions.renameConversation}
      onDragOutside={(historyRow) => {
        if (historyRow.kind === 'history') void actions.dropConversationOutside(historyRow.item).catch(reportNewWindowError);
      }}
      onMenu={openMenu}
    />
  );
  const { groups } = view;
  const isEmpty = groups.pinned.length + groups.unassigned.length + groups.private.length === 0 && groups.projects.every((group) => group.rows.length === 0);
  const menuSessionId = menu?.target.sessionId ?? '';

  return (
    // Sin ancho ni borde propios (F6: el ancho lo fija la zona del dock via CSS var y el borde ya lo
    // pinta ZonePane.tsx, borderClassName — duplicarlo aqui solo grosaba la linea) y CON alto completo
    // (h-full) — sin esto, este panel solo media lo que medía su contenido (la lista de conversaciones),
    // dejando un hueco de fondo sin pintar antes del suelo de la ventana.
    <div data-chat-sidebar="true" className="flex h-full w-full flex-col bg-mg-panel">
      <SidebarHeader
        filter={filter}
        onFilter={setFilter}
        onNewConversation={() => void actions.createConversation('shared')}
        onNewWithOptions={actions.openNewTabDialog}
        workingCount={view.workingCount}
        providers={view.providers}
        accounts={view.accounts}
        hiddenCount={view.hiddenCount}
      />

      {/* Cuenta sin login válido (#18): iniciar sesión otra vez (Claude) y, si no es la principal, eliminarla. */}
      <OrphanBanner key={account.id} account={account} onDelete={actions.deleteAccount} />

      <div data-sidebar-list="true" className="flex flex-1 flex-col gap-[6px] overflow-y-auto p-[2px_6px_8px] text-[12px]">
        {!filter.archived && <TasksSection />}
        {filter.archived && isEmpty && <div data-volatile-text="true" className="p-[8px_9px] text-[11px] text-mg-muted">{t('sidebar.archived.empty')}</div>}
        {!filter.archived && isEmpty && projects.length === 0 && (
          <div data-volatile-text="true" className="p-[8px_9px] text-[11px] text-mg-muted">{view.filterActive ? t('sidebar.search.noMatches') : t('sidebar.shared.empty')}</div>
        )}
        {groups.pinned.length > 0 && <FlatGroup kind="pinned" title={t('sidebar.pinned.title')} rows={groups.pinned} renderRow={renderRow} unlimited />}
        {(groups.projects.length > 0 || !filter.archived) && (
          <div className="flex flex-col gap-px">
            {groups.projects.length > 0 && <SectionLabel text={t('sidebar.projects.title')} hint={`${groups.projects.length}`} />}
            {editingProject !== null && <ProjectEditor project={editingProject === 'new' ? null : editingProject}
              onSave={async (project) => { await actions.saveChatProject(project); setEditingProject(null); }} onCancel={() => setEditingProject(null)} />}
            <RowList rows={groups.projects.filter((group) => !filter.archived || group.rows.length > 0)} unlimited={view.filterActive} collapsed={PROJECTS_COLLAPSED_LIMIT} renderRow={(group) => {
              const userProject = group.projectId === null ? undefined : projects.find((p) => p.id === group.projectId);
              return (
                <ProjectGroupView
                  key={group.key}
                  group={group}
                  renderRow={renderRow}
                  indicatorOf={view.indicatorOf}
                  unlimited={view.filterActive}
                  forceOpen={view.filterActive}
                  emptyHint={t('sidebar.projects.empty')}
                  onCreate={() => void actions.createConversation('shared', userProject === undefined
                    ? (group.cwd === null ? {} : { cwd: group.cwd })
                    : { projectId: userProject.id, ...(userProject.cwd === null ? { scratch: true } : { cwd: userProject.cwd }) })}
                  onEdit={userProject === undefined ? null : () => setEditingProject(userProject)}
                  onRemove={userProject === undefined ? null : () => actions.deleteChatProject(userProject.id)}
                />
              );
            }} />
            {!filter.archived && (
              <button onClick={() => setEditingProject('new')} aria-label={t('sidebar.projects.create')} className="mx-[2px] mt-[2px] rounded-[6px] p-[4px_9px] text-left text-[11px] text-mg-icon hover:bg-mg-hover hover:text-mg-body">
                ＋ {t('sidebar.projects.create')}
              </button>
            )}
          </div>
        )}
        {groups.unassigned.length > 0 && <FlatGroup kind="unassigned" title={t('sidebar.unassigned.title')} rows={groups.unassigned} renderRow={renderRow} unlimited={view.filterActive} />}
        {groups.private.length > 0 && <FlatGroup kind="private" title={t('sidebar.private.title')} rows={groups.private} renderRow={renderRow} unlimited={view.filterActive} />}
      </div>

      <AnimatePresence>
        {menu !== null && (
          <ConversationContextMenu
            key="conversation-context-menu"
            target={menu.target}
            x={menu.x}
            y={menu.y}
            accounts={accounts}
            projects={projects}
            onAssignProject={(projectId) => {
              actions.assignChatProject(menu.target.sessionId, menu.tabId, projectId);
              setMenu(null);
            }}
            activeAccountId={menu.target.accountId}
            pinned={menu.tabPinned || pinnedIds.includes(menuSessionId)}
            archived={archivedIds.includes(menuSessionId)}
            onTogglePinned={() => {
              actions.togglePinnedConversation(menuSessionId);
              setMenu(null);
            }}
            onToggleArchived={() => {
              actions.setConversationArchived(menuSessionId, !archivedIds.includes(menuSessionId));
              setMenu(null);
            }}
            onClose={() => setMenu(null)}
            onOpenInNewTab={
              menu.item === undefined
                ? undefined
                : () => {
                    const item = menu.item;
                    if (item !== undefined) void actions.openConversation(item, menu.target.accountId);
                    setMenu(null);
                  }
            }
            onOpenInNewWindow={
              menu.item === undefined
                ? undefined
                : () => {
                    const item = menu.item;
                    if (item !== undefined) void actions.openConversationInNewWindow(item).catch(reportNewWindowError);
                    setMenu(null);
                  }
            }
            newWindowBlockedReason={menu.item === undefined ? null : backgroundMoveBlockedReason(backgroundOfConversation(backgroundSessions, menu.item.sessionId))}
            onDelete={() => {
              void actions.deleteConversation(menuSessionId, menu.target.cwd, menu.target.privacy, menu.target.accountId);
              setMenu(null);
            }}
            onMove={(destAccountDir: string, destPrivacy: ConversationPrivacy) => {
              actions.moveConversation(menuSessionId, menu.target.cwd, menu.target.privacy, destAccountDir, destPrivacy, menu.target.accountId).catch(
                (err: unknown) => console.error('No se pudo mover la conversacion:', err instanceof Error ? err.message : String(err)),
              );
              setMenu(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// Las acciones del store que usa el lateral, agrupadas (selectores estables: las funciones del store no cambian).
function useSidebarActions(): {
  readonly setActiveTab: (tabId: string) => void;
  readonly createConversation: ReturnType<typeof useWorkbenchStore.getState>['createConversation'];
  readonly openNewTabDialog: () => void;
  readonly openConversation: ReturnType<typeof useWorkbenchStore.getState>['openConversation'];
  readonly renameConversation: (tabId: string, title: string) => void;
  readonly deleteAccount: (configDir: string) => Promise<void>;
  readonly saveChatProject: (project: ChatProject) => Promise<void>;
  readonly deleteChatProject: (projectId: string) => void;
  readonly assignChatProject: ReturnType<typeof useWorkbenchStore.getState>['assignChatProject'];
  readonly deleteConversation: ReturnType<typeof useWorkbenchStore.getState>['deleteConversation'];
  readonly moveConversation: ReturnType<typeof useWorkbenchStore.getState>['moveConversation'];
  readonly openConversationInNewWindow: ReturnType<typeof useWorkbenchStore.getState>['openConversationInNewWindow'];
  readonly dropConversationOutside: ReturnType<typeof useWorkbenchStore.getState>['dropConversationOutside'];
  readonly togglePinnedConversation: (sessionId: string) => void;
  readonly setConversationArchived: (sessionId: string, archived: boolean) => void;
} {
  return {
    setActiveTab: useWorkbenchStore((s) => s.setActiveTab),
    createConversation: useWorkbenchStore((s) => s.createConversation),
    openNewTabDialog: useWorkbenchStore((s) => s.openNewTabDialog),
    openConversation: useWorkbenchStore((s) => s.openConversation),
    renameConversation: useWorkbenchStore((s) => s.renameConversation),
    deleteAccount: useWorkbenchStore((s) => s.deleteAccount),
    saveChatProject: useWorkbenchStore((s) => s.saveChatProject),
    deleteChatProject: useWorkbenchStore((s) => s.deleteChatProject),
    assignChatProject: useWorkbenchStore((s) => s.assignChatProject),
    deleteConversation: useWorkbenchStore((s) => s.deleteConversation),
    moveConversation: useWorkbenchStore((s) => s.moveConversation),
    openConversationInNewWindow: useWorkbenchStore((s) => s.openConversationInNewWindow),
    dropConversationOutside: useWorkbenchStore((s) => s.dropConversationOutside),
    togglePinnedConversation: useWorkbenchStore((s) => s.togglePinnedConversation),
    setConversationArchived: useWorkbenchStore((s) => s.setConversationArchived),
  };
}

// Abrir en otra ventana puede fallar (main rechaza la pestaña, sigue trabajando en segundo plano): se
// avisa en vez de tragarse; la conversacion sigue aqui.
function reportNewWindowError(err: unknown): void {
  reportActionError(translate('sidebar.newWindowFailed'), err, 'window');
}

function ProjectEditor({ project, onSave, onCancel }: {
  readonly project: ChatProject | null;
  readonly onSave: (project: ChatProject) => Promise<void>;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const t = useT();
  const [name, setName] = useState(project?.name ?? '');
  const [instructions, setInstructions] = useState(project?.instructions ?? '');
  const [cwd, setCwd] = useState<string | null>(project?.cwd ?? null);
  return (
    <form data-chat-project-editor="true" onSubmit={(event) => {
      event.preventDefault();
      if (name.trim().length === 0) return;
      void onSave({ id: project?.id ?? crypto.randomUUID(), name: name.trim(), instructions, cwd, sessionIds: project?.sessionIds ?? [] })
        .catch((err: unknown) => reportActionError(t('sidebar.projectEditor.saveFailed'), err, 'projects'));
    }} className="mx-[3px] flex flex-col gap-[6px] rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[8px] text-[11px]">
      <label className="flex flex-col gap-[2px]">{t('sidebar.projectEditor.name')}
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80}
          className="rounded-[5px] border border-mg-border-ctrl bg-mg-panel p-[5px] text-mg-body outline-none focus:border-mg-border-pop" />
      </label>
      <label className="flex flex-col gap-[2px]">{t('sidebar.projectEditor.rules')}
        <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={4} maxLength={8000}
          placeholder={t('sidebar.projectEditor.rulesPlaceholder')}
          className="resize-y rounded-[5px] border border-mg-border-ctrl bg-mg-panel p-[5px] text-mg-body outline-none focus:border-mg-border-pop" />
      </label>
      <div className="flex items-center gap-[5px]">
        <button type="button" onClick={() => void window.mage.pickDirectory().then((picked) => { if (picked !== null) setCwd(picked); })}
          className="rounded-[5px] border border-mg-border-ctrl px-[6px] py-[3px] hover:bg-mg-hover">{t('sidebar.projectEditor.linkApp')}</button>
        {cwd !== null && <button type="button" onClick={() => setCwd(null)} aria-label={t('sidebar.projectEditor.unlinkApp')}>✕</button>}
      </div>
      {cwd !== null && <span className="break-all font-mono text-[10px] text-mg-muted">{cwd}</span>}
      <div className="flex justify-end gap-[6px]">
        <button type="button" onClick={onCancel} className="rounded-[5px] px-[7px] py-[4px] hover:bg-mg-hover">{t('sidebar.projectEditor.cancel')}</button>
        <button type="submit" disabled={name.trim().length === 0} className="rounded-[5px] bg-mg-activity px-[7px] py-[4px] text-mg-window disabled:opacity-40">{t('sidebar.projectEditor.save')}</button>
      </div>
    </form>
  );
}

// Aviso de cuenta sin login válido, con confirmación EN LA APP (no dialogo nativo del SO). #18: ofrece
// iniciar sesión de nuevo con el CLI oficial sobre la MISMA cuenta (conserva sus conversaciones); el
// siguiente arranque de sus sesiones ya lee las credenciales nuevas de su config dir.
function OrphanBanner({
  account,
  onDelete,
}: {
  readonly account: Account;
  readonly onDelete: (configDir: string) => Promise<void>;
}): React.JSX.Element | null {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const refreshAccounts = useWorkbenchStore((s) => s.refreshAccounts);
  const login = useCliLogin(() => {
    void refreshAccounts().catch((err: unknown) => reportActionError(t('sidebar.orphan.refreshFailed'), err, 'accounts'));
  });
  const recovery = accountRecovery(account);
  if (recovery === null) return null;
  if (confirming) return <DeleteAccountConfirm account={account} onCancel={() => setConfirming(false)} onDelete={onDelete} />;

  return (
    <div data-account-recovery="true" className="flex flex-col gap-[6px] border-b border-mg-border-subtle bg-mg-danger-bg p-[7px_12px] text-[10.5px] text-mg-danger">
      <div className="flex items-center justify-between gap-[8px]">
        <span>{t('sidebar.orphan.message')}</span>
        <div className="flex gap-[6px]">
          {recovery.relogin && (
            <button
              onClick={() => login.begin(account.id, account.email)}
              disabled={login.phase === 'starting' || login.phase === 'submitting'}
              className="rounded-[6px] border border-mg-danger-border px-[8px] py-[3px] text-mg-danger hover:bg-mg-danger-bg disabled:opacity-50"
            >
              {t('sidebar.orphan.login')}
            </button>
          )}
          {recovery.remove && (
            <button onClick={() => setConfirming(true)} className="rounded-[6px] border border-mg-danger-border px-[8px] py-[3px] text-mg-danger hover:bg-mg-danger-bg">
              {t('sidebar.orphan.delete')}
            </button>
          )}
        </div>
      </div>
      <CliLoginPanel login={login} />
    </div>
  );
}

function DeleteAccountConfirm({
  account,
  onCancel,
  onDelete,
}: {
  readonly account: Account;
  readonly onCancel: () => void;
  readonly onDelete: (configDir: string) => Promise<void>;
}): React.JSX.Element {
  const t = useT();
  return (
    <div className="flex flex-col gap-[7px] border-b border-mg-border-subtle bg-mg-danger-bg p-[8px_12px] text-[10.5px] text-mg-danger">
      <span>
        {t('sidebar.deleteAccount.confirmStart')} <b>{account.alias}</b>
        {t('sidebar.deleteAccount.confirmEnd')}
      </span>
      <div className="flex justify-end gap-[6px]">
        <button
          onClick={onCancel}
          className="rounded-[6px] border border-mg-border-emph px-[8px] py-[3px] text-mg-body2 hover:bg-mg-hover"
        >
          {t('sidebar.deleteAccount.cancel')}
        </button>
        <button
          onClick={() => void onDelete(account.id)}
          className="rounded-[6px] bg-mg-danger-strong px-[8px] py-[3px] font-semibold text-mg-danger-ink hover:bg-mg-danger-strong-hover"
        >
          {t('sidebar.deleteAccount.confirm')}
        </button>
      </div>
    </div>
  );
}
