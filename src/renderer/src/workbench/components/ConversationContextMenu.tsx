import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import type { ConversationPrivacy } from '@shared/state';
import type { Account } from '../types';
import type { ChatProject } from '@shared/settings';
import { POPOVER_VARIANTS } from '../motionPresets';

// Descriptor de la conversacion sobre la que se abrio el menu (clic derecho). sessionId puede faltar
// si la pestana aun no ha arrancado sesion (no hay nada en disco -> eliminar/mover deshabilitados).
export interface ConversationTarget {
  readonly sessionId: string | undefined;
  readonly cwd: string;
  readonly privacy: ConversationPrivacy;
  readonly title: string;
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
}): React.JSX.Element {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
              Abrir en una pestaña nueva
            </MenuItem>
            {onOpenInNewWindow !== undefined && (
              <MenuItem disabled={!hasSession || newWindowBlockedReason !== null} tip={newWindowBlockedReason} onClick={onOpenInNewWindow}>
                Abrir en una ventana nueva
              </MenuItem>
            )}
            <div className="my-[3px] h-px bg-mg-border-subtle" />
          </>
        )}

        {/* Mover a la otra seccion de la MISMA cuenta. */}
        {onAssignProject !== undefined && (
          <>
            <div className="px-[10px] pt-[5px] text-[9.5px] font-bold tracking-[.06em] text-mg-ter">PROYECTO</div>
            {projects.map((project) => <MenuItem key={project.id} onClick={() => onAssignProject(project.id)}>{project.name}</MenuItem>)}
            <MenuItem onClick={() => onAssignProject(null)}>Quitar del proyecto</MenuItem>
            <div className="my-[3px] h-px bg-mg-border-subtle" />
          </>
        )}
        <MenuItem
          disabled={!hasSession}
          onClick={() => onMove(activeAccountId, oppositePrivacy)}
        >
          Mover a {oppositePrivacy === 'private' ? 'Privado' : 'Compartido'}
        </MenuItem>

        {/* Mover a otra cuenta (conserva la privacidad de origen). */}
        {otherAccounts.length > 0 && (
          <>
            <div className="px-[10px] pt-[5px] text-[9.5px] font-bold tracking-[.06em] text-mg-ter">MOVER A OTRA CUENTA</div>
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

        <div className="my-[3px] h-px bg-mg-border-subtle" />

        {/* Eliminar (con confirmacion en el propio menu). */}
        {!confirmingDelete ? (
          <MenuItem disabled={!hasSession} danger onClick={() => setConfirmingDelete(true)}>
            <Icon name="trash" size={12} /> Eliminar conversación
          </MenuItem>
        ) : (
          <div className="px-[10px] py-[6px]">
            <div className="mb-[6px] text-[10.5px] text-mg-danger">¿Eliminar de forma permanente?</div>
            <div className="flex justify-end gap-[6px]">
              <button
                onClick={onClose}
                className="rounded-[5px] border border-mg-border-emph px-[8px] py-[3px] text-[10.5px] text-mg-body2 hover:bg-mg-hover"
              >
                Cancelar
              </button>
              <button
                onClick={onDelete}
                className="rounded-[5px] bg-mg-danger-strong px-[8px] py-[3px] text-[10.5px] font-semibold text-mg-danger-ink hover:bg-mg-danger-strong-hover"
              >
                Eliminar
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </>,
    document.body,
  );
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
