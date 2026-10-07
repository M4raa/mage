import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { AnimatePresence } from 'motion/react';
import { selectAccount, useWorkbenchStore } from '../workbenchStore';
import type { Account, ChatStatus, Tab } from '../types';
import type { ConversationSummary } from '@shared/conversations';
import { filterConversationRows, formatSize, mergeConversationRows, relativeTime, rowRecency, type ConversationRow } from '../conversationList';
import { backgroundLabel, backgroundMoveBlockedReason, type BackgroundSession } from '../backgroundWork';
import { ConversationContextMenu, type ConversationTarget } from './ConversationContextMenu';
import type { ConversationPrivacy } from '@shared/state';
import { reportActionError } from '../notificationStore';
import type { ChatProject } from '@shared/settings';
import { projectForRow } from '../chatProjects';

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
}

// Nº de conversaciones visibles por seccion antes de "mostrar más" (#1 de AJUSTES) y tamaño del
// incremento de cada pulsacion: se revela DE 10 EN 10, no todo de golpe (feedback GUI A1).
const COLLAPSED_LIMIT = 5;
const REVEAL_STEP = 10;

// Sidebar (252px): cabecera de cuenta (alias/email/modelo) y lista de pestanas/conversaciones de la
// cuenta activa. El resumen de uso vive solo en el panel "Uso" del dock y en el hover de la StatusBar
// (feedback del usuario: repetirlo aqui tambien era redundante). Una pestana = una conversacion real.
export function ChatSidebar(): React.JSX.Element {
  const account = useWorkbenchStore((s) => selectAccount(s, s.activeAccountId));
  // Estado bruto (referencias estables) + useMemo para derivar. Nunca pasar a useWorkbenchStore un
  // selector que devuelva un array nuevo por render (bucle infinito en Zustand v5).
  const tabs = useWorkbenchStore((s) => s.tabs);
  const activeAccountId = useWorkbenchStore((s) => s.activeAccountId);
  const activeTabId = useWorkbenchStore((s) => s.activeTabId);
  const statusByChat = useWorkbenchStore((s) => s.statusByChat);
  const sessionIdByChat = useWorkbenchStore((s) => s.sessionIdByChat);
  const conversationHistory = useWorkbenchStore((s) => s.conversationHistory);
  // Sesiones que siguen vivas sin pestaña (cerrar con trabajo en vuelo no lo corta): su fila del
  // historial lo dice, que es donde el usuario decidio verlo.
  const backgroundSessions = useWorkbenchStore((s) => s.backgroundSessions);
  const setActiveTab = useWorkbenchStore((s) => s.setActiveTab);
  const createConversation = useWorkbenchStore((s) => s.createConversation);
  const openNewTabDialog = useWorkbenchStore((s) => s.openNewTabDialog);
  const openConversation = useWorkbenchStore((s) => s.openConversation);
  const renameConversation = useWorkbenchStore((s) => s.renameConversation);
  const deleteAccount = useWorkbenchStore((s) => s.deleteAccount);
  const accounts = useWorkbenchStore((s) => s.accounts);
  const projects = useWorkbenchStore((s) => s.settings.chatProjects);
  const saveChatProject = useWorkbenchStore((s) => s.saveChatProject);
  const deleteChatProject = useWorkbenchStore((s) => s.deleteChatProject);
  const assignChatProject = useWorkbenchStore((s) => s.assignChatProject);
  const deleteConversation = useWorkbenchStore((s) => s.deleteConversation);
  const moveConversation = useWorkbenchStore((s) => s.moveConversation);
  const openConversationInNewWindow = useWorkbenchStore((s) => s.openConversationInNewWindow);
  const dropConversationOutside = useWorkbenchStore((s) => s.dropConversationOutside);
  // Menu contextual (clic derecho, #2). Objetivo + posicion; null cuando esta cerrado.
  const [menu, setMenu] = useState<MenuState | null>(null);
  const openMenu = (target: ConversationTarget, x: number, y: number, item?: ConversationSummary, tabId?: string): void =>
    setMenu({ target, x, y, item, tabId });
  // Dos secciones (M2.6): compartido (por defecto) y privado. Cada una fusiona el HISTORIAL en disco
  // con las pestanas ABIERTAS. useMemo sobre estado bruto (nunca un selector que devuelva array nuevo
  // por render -> bucle en Zustand v5).
  // Busqueda de conversaciones (#4 de AJUSTES): filtra ambas secciones por titulo.
  const [search, setSearch] = useState('');
  const sharedRows = useMemo(
    () => filterConversationRows(mergeConversationRows(tabs, conversationHistory, sessionIdByChat, activeAccountId, 'shared'), search),
    [tabs, conversationHistory, sessionIdByChat, activeAccountId, search],
  );
  const privateRows = useMemo(
    () => filterConversationRows(mergeConversationRows(tabs, conversationHistory, sessionIdByChat, activeAccountId, 'private'), search),
    [tabs, conversationHistory, sessionIdByChat, activeAccountId, search],
  );
  const allRows = [...sharedRows, ...privateRows];
  const ungroupedShared = sharedRows.filter((row) => projectForRow(row, projects, sessionIdByChat) === undefined);
  const ungroupedPrivate = privateRows.filter((row) => projectForRow(row, projects, sessionIdByChat) === undefined);
  const [editingProject, setEditingProject] = useState<ChatProject | 'new' | null>(null);
  if (account === undefined) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-mg-panel p-4 text-center text-[11px] text-mg-muted">
        Descubriendo cuentas…
      </div>
    );
  }

  return (
    // Sin ancho ni borde propios (F6: el ancho lo fija la zona del dock via CSS var y el borde ya lo
    // pinta ZonePane.tsx, borderClassName — duplicarlo aqui solo grosaba la linea) y CON alto completo
    // (h-full) — sin esto, este panel solo media lo que medía su contenido (la lista de conversaciones),
    // dejando un hueco de fondo sin pintar antes del suelo de la ventana.
    <div className="flex h-full w-full flex-col bg-mg-panel">
      {/* Sin boton « de "ocultar panel" (Ronda 3, item 17): era el tercer disparador de lo mismo, y el
          unico que ademas no decia donde vuelve a aparecer el panel. El icono de la stripe/rail es el
          control unico de visibilidad. */}
      <header className="flex items-center gap-[9px] border-b border-mg-border-subtle p-[11px_12px]">
        <span aria-hidden="true" className="h-2 w-2 rounded-[3px]" style={{ background: account.accent.base }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-bold text-mg-text">{account.alias}</div>
          <div className="truncate text-[10px] text-mg-ter">
            {account.email ?? 'sin email'} · {account.defaultModel}
          </div>
        </div>
      </header>

      {/* Cuenta huérfana (sin login y no principal): permitir eliminarla para no dejarla a medias. */}
      {!account.isMain && account.loginStatus !== 'logged_in' && (
        <OrphanBanner account={account} onDelete={deleteAccount} />
      )}

      <div className="border-b border-mg-border-subtle p-[8px_10px]">
        <div className="flex items-center gap-[6px] rounded-[7px] border border-mg-border-ctrl bg-mg-window px-[8px] py-[5px] focus-within:border-mg-border-pop">
          <span aria-hidden="true" className="text-[11px] text-mg-muted">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar conversaciones…"
            aria-label="Buscar conversaciones"
            className="min-w-0 flex-1 bg-transparent text-[11.5px] text-mg-body placeholder:text-mg-muted outline-none"
          />
          {search.length > 0 && (
            <button
              onClick={() => setSearch('')}
              aria-label="Limpiar búsqueda"
              className="flex-none text-[11px] text-mg-muted hover:text-mg-body"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-[10px] overflow-y-auto p-[6px] text-[12px]">
        <section data-chat-projects="true">
          <div className="flex items-center justify-between">
            <SectionLabel icon={<Icon name="folder" size={12} />} text="PROYECTOS" hint={`${projects.length}`} />
            <button onClick={() => setEditingProject('new')} aria-label="Crear proyecto de chats" className="rounded-[5px] px-[7px] text-mg-icon hover:bg-mg-hover">＋</button>
          </div>
          {editingProject !== null && <ProjectEditor project={editingProject === 'new' ? null : editingProject}
            onSave={async (project) => { await saveChatProject(project); setEditingProject(null); }} onCancel={() => setEditingProject(null)} />}
          {projects.map((project) => (
            <div key={project.id} data-chat-project={project.id}>
              <div className="flex justify-end gap-[4px] pr-[5px]">
                <button onClick={() => setEditingProject(project)} aria-label={`Editar proyecto ${project.name}`} className="text-[10px] text-mg-muted hover:text-mg-body">Editar</button>
                <button onClick={() => deleteChatProject(project.id)} aria-label={`Eliminar proyecto ${project.name}`} className="text-[10px] text-mg-muted hover:text-mg-danger">Quitar</button>
              </div>
              <ConversationSection
                icon={<Icon name="folder" size={12} />} title={project.name.toUpperCase()}
                rows={allRows.filter((row) => projectForRow(row, projects, sessionIdByChat)?.id === project.id)}
                expandedByDefault={search.length > 0} account={account} activeTabId={activeTabId}
                statusByChat={statusByChat} sessionIdByChat={sessionIdByChat} backgroundSessions={backgroundSessions}
                onSelect={setActiveTab} onOpen={openConversation}
                onDragOutside={(item) => void dropConversationOutside(item).catch(reportNewWindowError)}
                onRename={renameConversation} onContextMenu={openMenu}
                onCreate={() => void createConversation('shared', { projectId: project.id, ...(project.cwd === null ? { scratch: true } : { cwd: project.cwd }) })}
                onCreateWithOptions={openNewTabDialog} emptyHint="Sin chats en este proyecto." />
            </div>
          ))}
        </section>
        <SectionLabel icon="◷" text="RECIENTES" hint={`${ungroupedShared.length + ungroupedPrivate.length}`} />
        <ConversationSection
          icon="◇"
          title="COMPARTIDO"
          rows={ungroupedShared}
          expandedByDefault={search.length > 0}
          account={account}
          activeTabId={activeTabId}
          statusByChat={statusByChat}
          sessionIdByChat={sessionIdByChat}
          backgroundSessions={backgroundSessions}
          onSelect={setActiveTab}
          onOpen={openConversation}
          onDragOutside={(item) => void dropConversationOutside(item).catch(reportNewWindowError)}
          onRename={renameConversation}
          onContextMenu={openMenu}
          onCreate={() => void createConversation('shared')}
          onCreateWithOptions={openNewTabDialog}
          emptyHint={search.length > 0 ? 'Sin coincidencias.' : 'Sin conversaciones compartidas.'}
        />
        <ConversationSection
          icon={<Icon name="lock" size={12} />}
          title="PRIVADO"
          rows={ungroupedPrivate}
          expandedByDefault={search.length > 0}
          account={account}
          activeTabId={activeTabId}
          statusByChat={statusByChat}
          sessionIdByChat={sessionIdByChat}
          backgroundSessions={backgroundSessions}
          onSelect={setActiveTab}
          onOpen={openConversation}
          onDragOutside={(item) => void dropConversationOutside(item).catch(reportNewWindowError)}
          onRename={renameConversation}
          onContextMenu={openMenu}
          onCreate={() => void createConversation('private')}
          onCreateWithOptions={openNewTabDialog}
          emptyHint={search.length > 0 ? 'Sin coincidencias.' : 'Sin conversaciones privadas.'}
        />
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
              assignChatProject(menu.target.sessionId, menu.tabId, projectId);
              setMenu(null);
            }}
            activeAccountId={activeAccountId}
            onClose={() => setMenu(null)}
            onOpenInNewTab={
              menu.item === undefined
                ? undefined
                : () => {
                    const item = menu.item;
                    if (item !== undefined) void openConversation(item);
                    setMenu(null);
                  }
            }
            onOpenInNewWindow={
              menu.item === undefined
                ? undefined
                : () => {
                    const item = menu.item;
                    if (item !== undefined) void openConversationInNewWindow(item).catch(reportNewWindowError);
                    setMenu(null);
                  }
            }
            newWindowBlockedReason={menu.item === undefined ? null : backgroundMoveBlockedReason(backgroundSessions[menu.item.sessionId])}
            onDelete={() => {
              void deleteConversation(menu.target.sessionId ?? '', menu.target.cwd, menu.target.privacy);
              setMenu(null);
            }}
            onMove={(destAccountDir: string, destPrivacy: ConversationPrivacy) => {
              moveConversation(menu.target.sessionId ?? '', menu.target.cwd, menu.target.privacy, destAccountDir, destPrivacy).catch(
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

// Abrir en otra ventana puede fallar (main rechaza la pestaña, sigue trabajando en segundo plano): se
// avisa en vez de tragarse; la conversacion sigue aqui.
function reportNewWindowError(err: unknown): void {
  reportActionError('No se pudo abrir la conversación en otra ventana', err, 'window');
}

function ProjectEditor({ project, onSave, onCancel }: {
  readonly project: ChatProject | null;
  readonly onSave: (project: ChatProject) => Promise<void>;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(project?.name ?? '');
  const [instructions, setInstructions] = useState(project?.instructions ?? '');
  const [cwd, setCwd] = useState<string | null>(project?.cwd ?? null);
  return (
    <form data-chat-project-editor="true" onSubmit={(event) => {
      event.preventDefault();
      if (name.trim().length === 0) return;
      void onSave({ id: project?.id ?? crypto.randomUUID(), name: name.trim(), instructions, cwd, sessionIds: project?.sessionIds ?? [] })
        .catch((err: unknown) => reportActionError('No se pudo guardar el proyecto', err, 'projects'));
    }} className="mx-[3px] flex flex-col gap-[6px] rounded-[7px] border border-mg-border-ctrl bg-mg-window p-[8px] text-[11px]">
      <label className="flex flex-col gap-[2px]">Nombre del proyecto
        <input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80}
          className="rounded-[5px] border border-mg-border-ctrl bg-mg-panel p-[5px] text-mg-body outline-none focus:border-mg-border-pop" />
      </label>
      <label className="flex flex-col gap-[2px]">Reglas del proyecto
        <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} rows={4} maxLength={8000}
          placeholder="Instrucciones para los chats de este proyecto (al abrir la sesión)"
          className="resize-y rounded-[5px] border border-mg-border-ctrl bg-mg-panel p-[5px] text-mg-body outline-none focus:border-mg-border-pop" />
      </label>
      <div className="flex items-center gap-[5px]">
        <button type="button" onClick={() => void window.mage.pickDirectory().then((picked) => { if (picked !== null) setCwd(picked); })}
          className="rounded-[5px] border border-mg-border-ctrl px-[6px] py-[3px] hover:bg-mg-hover">Vincular aplicación…</button>
        {cwd !== null && <button type="button" onClick={() => setCwd(null)} aria-label="Desvincular aplicación">✕</button>}
      </div>
      {cwd !== null && <span className="break-all font-mono text-[10px] text-mg-muted">{cwd}</span>}
      <div className="flex justify-end gap-[6px]">
        <button type="button" onClick={onCancel} className="rounded-[5px] px-[7px] py-[4px] hover:bg-mg-hover">Cancelar</button>
        <button type="submit" disabled={name.trim().length === 0} className="rounded-[5px] bg-mg-activity px-[7px] py-[4px] text-mg-window disabled:opacity-40">Guardar</button>
      </div>
    </form>
  );
}

// Aviso de cuenta huérfana (sin login) con confirmación EN LA APP (no dialogo nativo del SO).
function OrphanBanner({
  account,
  onDelete,
}: {
  readonly account: Account;
  readonly onDelete: (configDir: string) => Promise<void>;
}): React.JSX.Element {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="flex items-center justify-between gap-[8px] border-b border-mg-border-subtle bg-mg-danger-bg p-[7px_12px] text-[10.5px] text-mg-danger">
        <span>Cuenta sin login válido.</span>
        <button
          onClick={() => setConfirming(true)}
          className="rounded-[6px] border border-mg-danger-border px-[8px] py-[3px] text-mg-danger hover:bg-mg-danger-bg"
        >
          Eliminar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[7px] border-b border-mg-border-subtle bg-mg-danger-bg p-[8px_12px] text-[10.5px] text-mg-danger">
      <span>
        ¿Eliminar <b>{account.alias}</b>? Se borra su carpeta entera, incluidas sus conversaciones
        privadas; las compartidas NO se tocan.
      </span>
      <div className="flex justify-end gap-[6px]">
        <button
          onClick={() => setConfirming(false)}
          className="rounded-[6px] border border-mg-border-emph px-[8px] py-[3px] text-mg-body2 hover:bg-mg-hover"
        >
          Cancelar
        </button>
        <button
          onClick={() => void onDelete(account.id)}
          className="rounded-[6px] bg-mg-danger-strong px-[8px] py-[3px] font-semibold text-mg-danger-ink hover:bg-mg-danger-strong-hover"
        >
          Sí, eliminar
        </button>
      </div>
    </div>
  );
}

function SectionLabel({
  icon,
  text,
  hint,
}: {
  readonly icon: React.ReactNode;
  readonly text: string;
  readonly hint: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-[7px] p-[8px_8px_4px] text-[10px] font-bold tracking-[.08em] text-mg-ter">
      <span>{icon}</span>
      {text}
      <span className="ml-auto truncate font-normal text-mg-muted">{hint}</span>
    </div>
  );
}

// Una seccion de conversaciones (M2.6): compartido o privado. Fusiona el historial en disco con las
// pestanas abiertas (rows) y ofrece su propio boton de "nueva conversacion" (sin dialogo).
function ConversationSection({
  icon,
  title,
  rows,
  expandedByDefault,
  account,
  activeTabId,
  statusByChat,
  sessionIdByChat,
  backgroundSessions,
  onSelect,
  onOpen,
  onDragOutside,
  onRename,
  onContextMenu,
  onCreate,
  onCreateWithOptions,
  emptyHint,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly rows: readonly ConversationRow[];
  readonly expandedByDefault: boolean; // al buscar, se muestran todas las coincidencias sin cap
  readonly account: Account;
  readonly activeTabId: string;
  readonly statusByChat: Readonly<Record<string, ChatStatus>>;
  readonly sessionIdByChat: Readonly<Record<string, string>>;
  readonly backgroundSessions: Readonly<Record<string, BackgroundSession>>;
  readonly onSelect: (tabId: string) => void;
  readonly onOpen: (item: ConversationSummary) => void;
  // Se solto la fila fuera de la ventana (P-028, 36): a otra ventana de Mage o a una nueva.
  readonly onDragOutside: (item: ConversationSummary) => void;
  readonly onRename: (tabId: string, title: string) => void;
  readonly onContextMenu: (target: ConversationTarget, x: number, y: number, item?: ConversationSummary, tabId?: string) => void;
  readonly onCreate: () => void;
  readonly onCreateWithOptions: () => void;
  readonly emptyHint: string;
}): React.JSX.Element {
  // Tope inicial de 5 y luego +10 por pulsacion (#1 + A1). Al buscar se muestran todas las
  // coincidencias sin tope (el filtro ya reduce la lista).
  const [limit, setLimit] = useState(COLLAPSED_LIMIT);
  const showAll = expandedByDefault;
  const visible = showAll ? rows : rows.slice(0, limit);
  const hidden = rows.length - visible.length;
  const nextStep = Math.min(hidden, REVEAL_STEP);
  return (
    <section className="flex flex-col gap-px">
      <SectionLabel icon={icon} text={title} hint={`${rows.length}`} />
      {rows.length === 0 && <div className="p-[8px_9px] text-[11px] text-mg-muted">{emptyHint}</div>}
      {visible.map((row) =>
        row.kind === 'tab' ? (
          <TabItem
            key={row.tab.id}
            tab={row.tab}
            history={row.history}
            recencyMs={rowRecency(row)}
            status={statusByChat[row.tab.id] ?? 'idle'}
            account={account}
            selected={row.tab.id === activeTabId}
            onClick={() => onSelect(row.tab.id)}
            onRename={onRename}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(
                { sessionId: sessionIdByChat[row.tab.id] ?? row.tab.resumeSessionId, cwd: row.tab.cwd, privacy: row.tab.privacy, title: row.tab.title },
                e.clientX,
                e.clientY,
                undefined,
                row.tab.id,
              );
            }}
          />
        ) : (
          <HistoryItem
            key={`h:${row.item.sessionId}`}
            item={row.item}
            account={account}
            background={backgroundSessions[row.item.sessionId]}
            onOpen={() => onOpen(row.item)}
            onDragOutside={() => onDragOutside(row.item)}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(
                { sessionId: row.item.sessionId, cwd: row.item.cwd, privacy: row.item.privacy, title: row.item.title },
                e.clientX,
                e.clientY,
                row.item,
              );
            }}
          />
        ),
      )}
      {!showAll && hidden > 0 && (
        <button
          onClick={() => setLimit((current) => current + REVEAL_STEP)}
          className="mx-[2px] mt-[2px] rounded-[6px] p-[5px_9px] text-left text-[11px] text-mg-icon transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body"
        >
          Mostrar {nextStep} más… <span className="text-mg-muted">({hidden} restantes)</span>
        </button>
      )}
      {!showAll && limit > COLLAPSED_LIMIT && (
        <button
          onClick={() => setLimit(COLLAPSED_LIMIT)}
          className="mx-[2px] mt-[2px] rounded-[6px] p-[5px_9px] text-left text-[11px] text-mg-icon transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body"
        >
          Mostrar menos
        </button>
      )}
      {/* Camino POR DEFECTO: carpeta temporal y valores por defecto, sin formulario. El dialogo de
          "elegir cuenta/carpeta/proveedor/modelo" sigue ahi, como accion SECUNDARIA (clic derecho),
          igual que el resto de menus contextuales de la app. */}
      <button
        onClick={onCreate}
        onContextMenu={(e) => {
          e.preventDefault();
          onCreateWithOptions();
        }}
        data-tip="Nueva conversación · clic derecho para elegir carpeta y modelo"
        aria-label="Nueva conversación (clic derecho: elegir carpeta y modelo)"
        className="mx-[2px] mt-[6px] rounded-[7px] border border-dashed border-mg-border-emph p-[6px_10px] text-center text-[11px] text-mg-icon transition-colors duration-150 ease-out hover:bg-mg-hover"
      >
        ＋ nueva conversación
      </button>
    </section>
  );
}

// La fila de la conversacion a la que llevo el clic en una notificacion (P-028 40): se trae a la vista y
// se resalta un momento. No se reabre: cortaria la sesion viva en segundo plano.
const HIGHLIGHT_MS = 4000;

function useHighlight(sessionId: string): { readonly on: boolean; readonly ref: React.RefObject<HTMLButtonElement | null> } {
  const on = useWorkbenchStore((s) => s.highlightedSessionId === sessionId);
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!on) return;
    ref.current?.scrollIntoView({ block: 'nearest' });
    const id = setTimeout(() => useWorkbenchStore.setState({ highlightedSessionId: null }), HIGHLIGHT_MS);
    return () => clearTimeout(id);
  }, [on]);
  return { on, ref };
}

// Entrada de HISTORIAL (conversacion en disco no abierta): al pulsar, la reanuda (abre pestana).
function HistoryItem({
  item,
  account,
  background,
  onOpen,
  onDragOutside,
  onContextMenu,
}: {
  readonly item: ConversationSummary;
  readonly account: Account;
  // Presente = esta conversacion se cerro con trabajo en vuelo y su CLI sigue vivo.
  readonly background: BackgroundSession | undefined;
  readonly onOpen: () => void;
  readonly onDragOutside: () => void;
  readonly onContextMenu: (e: React.MouseEvent) => void;
}): React.JSX.Element {
  const state = background?.state;
  // Arrastrarla fuera de Mage la abre en otra ventana (P-028, 36); trabajando en segundo plano, no.
  const draggableOut = backgroundMoveBlockedReason(background) === null;
  const highlighted = useHighlight(item.sessionId);
  return (
    <button
      ref={highlighted.ref}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      draggable={draggableOut}
      data-history-session={item.sessionId}
      onDragStart={(e) => {
        // Tipo propio: que ningun campo de texto (el prompt) acepte la fila como texto soltado.
        e.dataTransfer.setData('application/x-mage-conversation', item.sessionId);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={(e) => {
        if (e.dataTransfer.dropEffect === 'none') onDragOutside();
      }}
      data-history-highlighted={highlighted.on ? 'true' : undefined}
      data-tip={background === undefined ? item.title : `${item.title} · ${backgroundLabel(background.state)} (se corta y se reanuda al abrirla)`}
      aria-label={background === undefined ? item.title : `${item.title}, ${backgroundLabel(background.state)}`}
      className={`flex items-center gap-2 rounded-[6px] p-[7px_9px] text-left transition-colors duration-150 ease-out hover:bg-mg-hover ${highlighted.on ? 'bg-mg-sel ring-1 ring-mg-border-emph' : ''}`}
    >
      <span
        aria-hidden="true"
        className={`h-[6px] w-[6px] flex-none rounded-full ${state === 'working' ? 'bg-mg-activity mg-pulse' : 'bg-mg-idle'}`}
        style={{ borderColor: account.accent.base }}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-[5px]">
          <span className="truncate text-mg-sec">{item.title}</span>
          {/* La empezo una tarea programada, no el usuario (P-026, D20). */}
          {item.isScheduled && (
            <span data-scheduled-badge="true" className="flex-none rounded-full border border-mg-border-subtle px-[5px] text-[9px] text-mg-muted">
              programada
            </span>
          )}
        </span>
        <span className="block truncate text-[10px] text-mg-muted">
          {background === undefined ? relativeTime(item.updatedAtMs) : backgroundLabel(background.state)}
          {/* El PESO de la conversacion (peticion del usuario): dice de un vistazo cual es la larga y
              cual la de dos mensajes, y cuanto va a tardar en reabrirse. Solo acompaña a la fecha —
              cuando la fila dice algo mas urgente ("en segundo plano"), no compite con ello. */}
          {background === undefined && item.sizeBytes > 0 && (
            <>
              <span aria-hidden="true"> · </span>
              <span title={`${item.sizeBytes.toLocaleString('es-ES')} bytes en disco`}>{formatSize(item.sizeBytes)}</span>
            </>
          )}
        </span>
      </span>
      {/* Solo las dos que piden algo del usuario llevan pastilla; "en segundo plano" ya se ve en el
          punto que late y en la linea de abajo. */}
      {(state === 'needs_action' || state === 'done') && (
        <span
          data-background-badge={state}
          className={`rounded-full border px-[6px] py-px text-[9.5px] font-bold ${
            state === 'needs_action' ? 'border-mg-warn-border text-mg-warn-text' : 'border-mg-focus text-mg-text'
          }`}
        >
          {state === 'needs_action' ? 'ACCIÓN' : 'REVISAR'}
        </span>
      )}
    </button>
  );
}

function TabItem({
  tab,
  history,
  recencyMs,
  status,
  account,
  selected,
  onClick,
  onRename,
  onContextMenu,
}: {
  readonly tab: Tab;
  // Resumen de su transcripcion en disco; undefined en una conversacion que aun no tiene fichero.
  readonly history: ConversationSummary | undefined;
  readonly recencyMs: number;
  readonly status: ChatStatus; // estado real del motor para esa pestana
  readonly account: Account;
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly onRename: (tabId: string, title: string) => void;
  readonly onContextMenu: (e: React.MouseEvent) => void;
}): React.JSX.Element {
  const active = status === 'streaming' || status === 'needs_permission';
  const [editing, setEditing] = useState(false);
  const commit = (value: string): void => {
    setEditing(false);
    onRename(tab.id, value);
  };

  // Modo edicion de titulo (doble clic): input inline en vez del boton (no anidar input en button).
  if (editing) {
    return (
      <div
        style={{ borderLeft: `2px solid ${account.accent.base}` }}
        className="flex items-center gap-2 rounded-[6px] bg-mg-sel p-[7px_9px]"
      >
        <span aria-hidden="true" className="h-[6px] w-[6px] flex-none rounded-full bg-mg-idle" />
        <input
          autoFocus
          defaultValue={tab.title}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            else if (e.key === 'Escape') setEditing(false);
          }}
          onBlur={(e) => commit(e.target.value)}
          aria-label="Renombrar conversación"
          className="min-w-0 flex-1 bg-transparent text-[12px] font-semibold text-mg-text outline-none"
        />
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      onDoubleClick={() => setEditing(true)}
      onContextMenu={onContextMenu}
      aria-current={selected}
      aria-label={`${tab.title}, ${tab.provider} ${tab.model}, ${statusLabel(status)}`}
      data-tip={`${tab.provider} · ${tab.model} · doble clic para renombrar · clic derecho para más`}
      style={selected ? { borderLeft: `2px solid ${account.accent.base}` } : undefined}
      className={`flex items-center gap-2 rounded-[6px] p-[7px_9px] text-left transition-colors duration-150 ease-out ${selected ? 'bg-mg-sel' : 'hover:bg-mg-hover'}`}
    >
      <span aria-hidden="true" className={`h-[6px] w-[6px] flex-none rounded-full ${active ? 'bg-mg-activity mg-pulse' : 'bg-mg-idle'}`} />
      <span className="min-w-0 flex-1">
        <span className={`block truncate font-semibold ${selected ? 'text-mg-text' : 'text-mg-body2'}`}>
          {tab.title}
        </span>
        {/* La MISMA linea que una conversacion cerrada (P-026, D19): cuando y cuanto pesa. Proveedor y
            modelo van al tooltip y al nombre accesible. Sin fichero todavia, solo el tiempo («ahora»). */}
        <span data-row-meta="true" className="block truncate text-[10px] text-mg-ter">
          {relativeTime(recencyMs === 0 ? Date.now() : recencyMs)}
          {history !== undefined && history.sizeBytes > 0 && <span aria-hidden="true"> · {formatSize(history.sizeBytes)}</span>}
        </span>
      </span>
      {status === 'needs_permission' && (
        <span className="rounded-full border border-mg-focus px-[6px] py-px text-[9.5px] font-bold text-mg-text">PERMISO</span>
      )}
    </button>
  );
}

// Estado de la conversacion en palabras (para el nombre accesible de la pestaña del sidebar).
function statusLabel(status: ChatStatus): string {
  switch (status) {
    case 'streaming':
      return 'generando';
    case 'needs_permission':
      return 'permiso pendiente';
    case 'error':
      return 'error';
    default:
      return 'en espera';
  }
}
