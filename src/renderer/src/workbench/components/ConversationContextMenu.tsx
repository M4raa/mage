import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import type { ConversationPrivacy } from '@shared/state';
import type { Account } from '../types';
import type { ChatProject } from '@shared/settings';
import { POPOVER_VARIANTS } from '../motionPresets';
import { useT } from '../../i18n/uiLanguage';
import { CODEX_PROVIDER_ID } from '@shared/providers';
import { useWorkbenchStore } from '../workbenchStore';
import { conversationIdOfTab } from '../conversationId';
import { describeError } from '../describeError';
import { notify, reportActionError } from '../notificationStore';

// Descriptor de la conversacion sobre la que se abrio el menu (clic derecho). sessionId puede faltar
// si la pestana aun no ha arrancado sesion (no hay nada en disco -> eliminar/mover deshabilitados).
export interface ConversationTarget {
  readonly sessionId: string | undefined;
  readonly cwd: string;
  readonly privacy: ConversationPrivacy;
  readonly title: string;
  // Cuenta de la fila (el lateral enseña todas las cuentas): borrar y mover actúan sobre ELLA, no sobre la activa.
  readonly accountId: string;
}

// Menu contextual de una conversacion (#2 de AJUSTES): eliminar y mover (entre Compartido/Privado y a
// otra cuenta). Portal a body con posicion fija (no lo recorta el overflow del sidebar). Se cierra al
// hacer clic fuera o con Escape. La eliminacion pide confirmacion EN EL MENU (no dialogo nativo).
export function ConversationContextMenu({
  target,
  x,
  y,
  accounts,
  activeAccountId,
  onClose,
  onDelete,
  onMove,
  onOpenInNewTab,
  onOpenInNewWindow,
  newWindowBlockedReason = null,
  projects = [],
  onAssignProject,
  pinned = false,
  archived = false,
  onTogglePinned,
  onToggleArchived,
}: {
  readonly target: ConversationTarget;
  readonly x: number;
  readonly y: number;
  readonly accounts: readonly Account[];
  readonly activeAccountId: string;
  readonly onClose: () => void;
  readonly onDelete: () => void;
  readonly onMove: (destAccountDir: string, destPrivacy: ConversationPrivacy) => void;
  // Reanuda ESTA conversacion en una pestaña. Solo lo pasa el HISTORIAL: una conversacion que ya tiene
  // pestaña abierta no se puede "abrir en una nueva" (dos procesos del CLI sobre la misma transcripcion
  // la corromperian), asi que ahi la opcion no existe en vez de existir deshabilitada.
  readonly onOpenInNewTab?: (() => void) | undefined;
  // Reanudarla en una ventana NUEVA (P-028, 36). Tambien solo desde el historial.
  readonly onOpenInNewWindow?: (() => void) | undefined;
  // Sigue trabajando en segundo plano: el item se desactiva con este motivo.
  readonly newWindowBlockedReason?: string | null;
  readonly projects?: readonly ChatProject[];
  readonly onAssignProject?: (projectId: string | null) => void;
  // Fijar y archivar (lateral): el estado actual decide el texto de cada entrada.
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly onTogglePinned?: () => void;
  readonly onToggleArchived?: () => void;
}): React.JSX.Element {
  const t = useT();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingUpdate, setConfirmingUpdate] = useState(false);
  const legacy = useLegacyCodexUpdate(target.sessionId, activeAccountId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const hasSession = target.sessionId !== undefined && target.sessionId.length > 0;
  const otherAccounts = accounts.filter((a) => a.id !== activeAccountId);
  const oppositePrivacy: ConversationPrivacy = target.privacy === 'private' ? 'shared' : 'private';

  // Clamp para no salir de la ventana (el menu mide ~200x?; se aproxima con un margen).
  const left = Math.min(x, window.innerWidth - 220);
  const top = Math.min(y, window.innerHeight - 260);

  return createPortal(
    <>
      {/* Capa invisible: un clic fuera cierra el menu. */}
      <div className="fixed inset-0 z-[9998]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <motion.div
        variants={POPOVER_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        role="menu"
        style={{ position: 'fixed', left, top, zIndex: 9999 }}
        className="w-[210px] overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] text-[11.5px] text-mg-body mg-shadow-pop"
      >
        <div className="truncate px-[10px] py-[5px] text-[10px] text-mg-muted">{target.title}</div>
        <div className="my-[3px] h-px bg-mg-border-subtle" />

        {/* Abrir (reanudar) ESTA conversacion en una pestaña nueva. */}
        {onOpenInNewTab !== undefined && (
          <>
            <MenuItem disabled={!hasSession} onClick={onOpenInNewTab}>
              {t('sidebar.contextMenu.openInNewTab')}
            </MenuItem>
            {onOpenInNewWindow !== undefined && (
              <MenuItem disabled={!hasSession || newWindowBlockedReason !== null} tip={newWindowBlockedReason} onClick={onOpenInNewWindow}>
                {t('sidebar.contextMenu.openInNewWindow')}
              </MenuItem>
            )}
            <div className="my-[3px] h-px bg-mg-border-subtle" />
          </>
        )}

        {onTogglePinned !== undefined && (
          <MenuItem disabled={!hasSession} onClick={onTogglePinned}>
            {pinned ? t('sidebar.contextMenu.unpin') : t('sidebar.contextMenu.pin')}
          </MenuItem>
        )}
        {onToggleArchived !== undefined && (
          <MenuItem disabled={!hasSession} onClick={onToggleArchived}>
            {archived ? t('sidebar.contextMenu.unarchive') : t('sidebar.contextMenu.archive')}
          </MenuItem>
        )}
        {(onTogglePinned !== undefined || onToggleArchived !== undefined) && <div className="my-[3px] h-px bg-mg-border-subtle" />}

        {/* Mover a la otra seccion de la MISMA cuenta. */}
        {onAssignProject !== undefined && (
          <>
            <div className="px-[10px] pt-[5px] text-[9.5px] font-bold tracking-[.06em] text-mg-ter">{t('sidebar.contextMenu.projectHeader')}</div>
            {projects.map((project) => <MenuItem key={project.id} onClick={() => onAssignProject(project.id)}>{project.name}</MenuItem>)}
            <MenuItem onClick={() => onAssignProject(null)}>{t('sidebar.contextMenu.removeFromProject')}</MenuItem>
            <div className="my-[3px] h-px bg-mg-border-subtle" />
          </>
        )}
        <MenuItem
          disabled={!hasSession}
          onClick={() => onMove(activeAccountId, oppositePrivacy)}
        >
          {oppositePrivacy === 'private' ? t('sidebar.contextMenu.moveToPrivate') : t('sidebar.contextMenu.moveToShared')}
        </MenuItem>

        {/* Mover a otra cuenta (conserva la privacidad de origen). */}
        {otherAccounts.length > 0 && (
          <>
            <div className="px-[10px] pt-[5px] text-[9.5px] font-bold tracking-[.06em] text-mg-ter">{t('sidebar.contextMenu.moveToAccountHeader')}</div>
            {otherAccounts.map((account) => (
              <MenuItem key={account.id} disabled={!hasSession} onClick={() => onMove(account.id, target.privacy)}>
                <span className="inline-flex items-center gap-[7px]">
                  <span className="h-[7px] w-[7px] flex-none rounded-[2px]" style={{ background: account.accent.base }} />
                  <span className="truncate">{account.alias}</span>
                </span>
              </MenuItem>
            ))}
          </>
        )}

        {/* Actualizar una conversacion de Codex de una version anterior (K07), con su confirmacion aqui mismo. */}
        {legacy.isLegacy && (
          <>
            <div className="my-[3px] h-px bg-mg-border-subtle" />
            {!confirmingUpdate ? (
              <MenuItem onClick={() => setConfirmingUpdate(true)}>{t('history.legacyCodex.update')}</MenuItem>
            ) : (
              <div data-legacy-update-confirm="true" className="px-[10px] py-[6px]">
                <div className="mb-[6px] text-[10.5px] text-mg-body">{t('history.legacyCodex.confirm')}</div>
                <div className="flex justify-end gap-[6px]">
                  <button onClick={onClose} className="rounded-[5px] border border-mg-border-emph px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover">
                    {t('chat.rewind.cancel')}
                  </button>
                  <button
                    onClick={() => { onClose(); legacy.update(); }}
                    className="rounded-[5px] bg-mg-sel px-[8px] py-[3px] text-[10.5px] font-semibold text-mg-text hover:bg-mg-hover"
                  >
                    {t('history.legacyCodex.update')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="my-[3px] h-px bg-mg-border-subtle" />

        {/* Eliminar (con confirmacion en el propio menu). */}
        {!confirmingDelete ? (
          <MenuItem disabled={!hasSession} danger onClick={() => setConfirmingDelete(true)}>
            <Icon name="trash" size={12} /> {t('sidebar.contextMenu.delete')}
          </MenuItem>
        ) : (
          <div className="px-[10px] py-[6px]">
            <div className="mb-[6px] text-[10.5px] text-mg-danger">{t('sidebar.contextMenu.deleteConfirm')}</div>
            <div className="flex justify-end gap-[6px]">
              <button
                onClick={onClose}
                className="rounded-[5px] border border-mg-border-emph px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
              >
                {t('sidebar.contextMenu.deleteCancel')}
              </button>
              <button
                onClick={onDelete}
                className="rounded-[5px] bg-mg-danger-strong px-[8px] py-[3px] text-[10.5px] font-semibold text-mg-danger-ink hover:bg-mg-danger-strong-hover"
              >
                {t('sidebar.contextMenu.deleteAccept')}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </>,
    document.body,
  );
}

// «Actualizar esta conversación» (K07): solo para una conversación de Codex de una versión anterior. El menú
// pregunta a main al abrirse; la entrada sale solo si la respuesta es «legacy».
function useLegacyCodexUpdate(sessionId: string | undefined, accountDir: string): { readonly isLegacy: boolean; readonly update: () => void } {
  const t = useT();
  const isCodex = useWorkbenchStore((s) => s.conversationHistory.some((item) => item.sessionId === sessionId && item.providerId === CODEX_PROVIDER_ID));
  const openTabId = useWorkbenchStore((s) => s.tabs.find((tab) => conversationIdOfTab(tab, s.sessionIdByChat[tab.id]) === sessionId)?.id ?? null);
  const updateLegacyCodex = useWorkbenchStore((s) => s.updateLegacyCodex);
  const [isLegacy, setIsLegacy] = useState(false);

  useEffect(() => {
    if (!isCodex || sessionId === undefined || sessionId.length === 0) return;
    let cancelled = false;
    window.mage.codexLegacyStatus({ accountDir, threadId: sessionId }).then(
      (status) => { if (!cancelled) setIsLegacy(status.legacy); },
      // No se oculta el fallo: se queda en la consola de la ventana, y la entrada no sale.
      (err: unknown) => console.warn(`No se pudo comprobar si la conversación ${JSON.stringify(sessionId)} de Codex es antigua:`, describeError(err)),
    );
    return () => { cancelled = true; };
  }, [isCodex, sessionId, accountDir]);

  const update = (): void => {
    if (sessionId === undefined) return;
    updateLegacyCodex(openTabId, accountDir, sessionId).then(
      (backupDir) => notify({ level: 'success', title: t('history.legacyCodex.done', { backupDir }), source: 'history' }),
      (err: unknown) => reportActionError(t('history.legacyCodex.update'), err, 'history'),
    );
  };
  return { isLegacy, update };
}

function MenuItem({
  children,
  onClick,
  disabled = false,
  danger = false,
  tip = null,
}: {
  readonly children: React.ReactNode;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly danger?: boolean;
  readonly tip?: string | null;
}): React.JSX.Element {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      data-tip={tip ?? undefined}
      className={`block w-full px-[10px] py-[5px] text-left transition-colors duration-150 ease-out disabled:opacity-40 ${
        danger ? 'text-mg-danger hover:bg-mg-danger-bg' : 'hover:bg-mg-hover'
      }`}
    >
      {children}
    </button>
  );
}
