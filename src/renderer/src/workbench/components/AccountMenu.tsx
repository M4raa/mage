import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import { useDialogA11y } from '../a11y/useDialogA11y';
import { MODAL_PANEL_VARIANTS, MODAL_SCRIM_VARIANTS, POPOVER_VARIANTS } from '../motionPresets';
import type { Account } from '../types';
import { ColorSwatches, MenuItem } from './TabContextMenu';

// Menu contextual del avatar de una cuenta en la cabecera (P-028, puntos 2 y 30): el color de la
// cuenta (PERS-3) y «Eliminar cuenta…». Mismo patron que TabContextMenu (portal, clamp, Escape/clic
// fuera). La cuenta por defecto (`~/.claude`) no ofrece el borrado: no se puede eliminar.
export function AccountMenu({
  account,
  x,
  y,
  onClose,
  onRequestDelete,
}: {
  readonly account: Account;
  readonly x: number;
  readonly y: number;
  readonly onClose: () => void;
  readonly onRequestDelete: () => void;
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: MENU_WIDTH_PX, height: 0 });
  const colorIndex = useWorkbenchStore((s) => s.settings.accentByAccount[account.id]);
  const setAccountAccent = useWorkbenchStore((s) => s.setAccountAccent);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu !== null) setSize({ width: menu.offsetWidth, height: menu.offsetHeight });
  }, []);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"], button')?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const left = Math.max(0, Math.min(x, window.innerWidth - size.width - MENU_MARGIN_PX));
  const top = Math.max(0, Math.min(y, window.innerHeight - size.height - MENU_MARGIN_PX));

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <motion.div
        variants={POPOVER_VARIANTS}
        initial="initial"
        animate="animate"
        exit="exit"
        ref={menuRef}
        role="menu"
        aria-label={`Acciones de la cuenta ${account.alias}`}
        data-account-menu="true"
        style={{ position: 'fixed', left, top, zIndex: 9999, width: MENU_WIDTH_PX }}
        className="overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] text-[11.5px] text-mg-body mg-shadow-pop"
      >
        <div className="px-[10px] pt-[2px] text-[9.5px] font-bold tracking-[.06em] text-mg-ter">COLOR</div>
        <ColorSwatches
          label="Color de la cuenta"
          autoTip="Color automático, según su posición"
          selected={colorIndex}
          onPick={(index) => { setAccountAccent(account.id, index); onClose(); }}
        />
        {!account.isMain && (
          <>
            <div className="my-[3px] h-px bg-mg-border-subtle" />
            <MenuItem danger onClick={() => { onRequestDelete(); onClose(); }}>
              Eliminar cuenta…
            </MenuItem>
          </>
        )}
      </motion.div>
    </>,
    document.body,
  );
}

const MENU_WIDTH_PX = 220;
const MENU_MARGIN_PX = 10;

// Confirmacion del borrado (punto 30). Dice QUE se borra —login, carpeta y cuantas conversaciones
// privadas— y que las compartidas no se tocan. El recuento se pide al abrir: listar el historial de
// una cuenta es una lectura de prefijos, barata.
export function DeleteAccountDialog({
  account,
  onClose,
}: {
  readonly account: Account;
  readonly onClose: () => void;
}): React.JSX.Element {
  const deleteAccount = useWorkbenchStore((s) => s.deleteAccount);
  const privateCount = usePrivateConversationCount(account.id, account.providerId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogA11y({ onClose });

  const confirm = (): void => {
    setBusy(true);
    setError(null);
    deleteAccount(account.id)
      .then(onClose)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false));
  };

  return createPortal(
    <motion.div
      variants={MODAL_SCRIM_VARIANTS}
      initial="initial"
      animate="animate"
      exit="exit"
      className="fixed inset-0 z-50 flex items-center justify-center bg-mg-scrim"
      onClick={onClose}
    >
      <motion.div
        variants={MODAL_PANEL_VARIANTS}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        data-delete-account-dialog="true"
        onClick={(e) => e.stopPropagation()}
        className="flex w-[440px] flex-col gap-[12px] rounded-[11px] border border-mg-border-pop bg-mg-panel p-[18px] text-[12px] mg-shadow-modal"
      >
        <div id="delete-account-title" className="text-[13px] font-bold text-mg-text">
          Eliminar la cuenta {account.alias}
        </div>
        <div className="leading-[1.5] text-mg-body2">
          Se borra entera la carpeta <code className="break-all text-mg-body">{account.id}</code>:
          <ul className="mt-[4px] list-disc pl-[18px]">
            <li>su login y sus ajustes;</li>
            <li>{privateLine(privateCount)}</li>
          </ul>
          <p className="mt-[6px]">Las conversaciones compartidas no se tocan. No se puede deshacer.</p>
        </div>
        {error !== null && (
          <div role="alert" className="text-[11px] text-mg-danger">
            No se pudo eliminar: {error}
          </div>
        )}
        <div className="mt-[2px] flex justify-end gap-[8px]">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-[7px] border border-mg-border-emph px-[12px] py-[6px] text-mg-body2 hover:bg-mg-hover disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={busy}
            className="rounded-[7px] bg-mg-danger-strong px-[12px] py-[6px] font-semibold text-mg-danger-ink hover:bg-mg-danger-strong-hover disabled:opacity-50"
          >
            {busy ? 'Eliminando…' : 'Eliminar la cuenta'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

// null mientras se cuenta; si el historial no se puede leer, el error se ve en el texto (no se traga).
function usePrivateConversationCount(configDir: string, providerId: string): number | string | null {
  const [count, setCount] = useState<number | string | null>(null);
  useEffect(() => {
    if (providerId !== 'claude') { setCount(0); return; }
    let alive = true;
    window.mage
      .listConversations(configDir)
      .then((list) => alive && setCount(list.filter((c) => c.privacy === 'private').length))
      .catch((err: unknown) => alive && setCount(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
    };
  }, [configDir, providerId]);
  return count;
}

function privateLine(count: number | string | null): string {
  if (count === null) return 'sus conversaciones privadas (contando…);';
  if (typeof count === 'string') return `sus conversaciones privadas (no se pudieron contar: ${count});`;
  if (count === 0) return 'sus conversaciones privadas (no tiene ninguna);';
  return count === 1 ? 'su conversación privada (1);' : `sus ${count} conversaciones privadas;`;
}
