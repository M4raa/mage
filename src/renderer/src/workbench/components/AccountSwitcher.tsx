import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { useWorkbenchStore } from '../workbenchStore';
import type { Account } from '../types';
import { loginDot, loginLabel } from './accountBadge';
import { AccountMenu, DeleteAccountDialog } from './AccountMenu';

// Selector de cuenta de la CABECERA (peticion del usuario). Antes vivia en la columna izquierda a
// 36 px por cuenta, apilado en vertical, y ahi crecia sin techo con el numero de cuentas.
//
// SIN SCROLL, y es lo que se corrigio tras el primer intento: aquella version llevaba
// `overflow-x-auto`, y en cuanto el grupo se quedaba justo aparecian barras de scroll dentro de una
// franja de 32 px — dos scrolls diminutos en la cabecera, que es peor que el problema que evitaban.
// Los botones ocupan todo el alto disponible de la barra y punto; si algun dia hay tantas cuentas que
// no caben a lo ancho, la solucion sera un desplegable, no un scroll de 26 px.
//
// `no-drag` en el contenedor: la cabecera es region de arrastre de ventana y sin esto el clic se lo
// come el arrastre. Vale para todos los hijos, asi que no se repite por boton.
export function AccountSwitcher(): React.JSX.Element | null {
  const accounts = useWorkbenchStore((s) => s.accounts);
  const activeAccountId = useWorkbenchStore((s) => s.activeAccountId);
  // Con una conversacion abierta de otra cuenta no basta con cambiar la activa (P-026 2.7).
  const requestAccountSwitch = useWorkbenchStore((s) => s.requestAccountSwitch);
  const openAddAccount = useWorkbenchStore((s) => s.openAddAccount);
  // Menu contextual del avatar (P-028, 2 y 30) y la confirmacion de borrado que abre.
  const [menu, setMenu] = useState<{ readonly account: Account; readonly x: number; readonly y: number } | null>(null);
  const [deleting, setDeleting] = useState<Account | null>(null);

  // Sin cuentas descubiertas todavia no se pinta nada: un grupo con solo "＋" en la cabecera es ruido
  // durante el arranque, que dura milisegundos.
  if (accounts.length === 0) return null;

  return (
    <div
      className="flex items-center gap-[4px]"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      role="group"
      aria-label="Cuentas"
    >
      {/* "Nueva cuenta" va a la IZQUIERDA de las cuentas (peticion del usuario). No lleva `aria-pressed`
          a proposito: no es una cuenta seleccionable, y la comprobacion de GUI cuenta las cuentas por
          ese atributo. */}
      <button
        onClick={openAddAccount}
        data-tip="Añadir cuenta"
        aria-label="Añadir cuenta"
        className={`flex shrink-0 items-center justify-center rounded-[7px] text-[13px] text-mg-muted transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body ${SIZE}`}
      >
        ＋
      </button>
      {accounts.map((account) => (
        <CompactAccount
          key={account.id}
          account={account}
          active={account.id === activeAccountId}
          onClick={() => requestAccountSwitch(account.id)}
          onContextMenu={(x, y) => setMenu({ account, x, y })}
        />
      ))}
      <AnimatePresence>
        {menu !== null && (
          <AccountMenu
            key="account-menu"
            account={menu.account}
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            onRequestDelete={() => setDeleting(menu.account)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {deleting !== null && <DeleteAccountDialog key="delete-account" account={deleting} onClose={() => setDeleting(null)} />}
      </AnimatePresence>
    </div>
  );
}

// Alto/ancho de los controles de la cabecera. La franja mide 32 px, asi que 26 la llena dejando 3 px
// de aire arriba y abajo: era lo que pedia el usuario ("los cuadrados mas grandes a lo vertical, para
// ocupar todo su espacio disponible"). Se comparte con el boton de "añadir" para que la fila quede
// alineada — dos alturas distintas en 32 px se ven como un error de maquetacion.
const SIZE = 'h-[26px] w-[26px]';

// Misma semantica visual que el avatar del rail (acento de la cuenta, punto de login) a escala de
// cabecera. El borde de la activa se mantiene en 2 px: es lo unico que dice de un vistazo cual esta
// seleccionada, y a 1 px es indistinguible del resto.
function CompactAccount({
  account,
  active,
  onClick,
  onContextMenu,
}: {
  readonly account: Account;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly onContextMenu: (x: number, y: number) => void;
}): React.JSX.Element {
  const { accent } = account;
  const style: React.CSSProperties = active
    ? { border: `2px solid ${accent.base}`, background: accent.bgActive, color: accent.tint }
    : { border: `1px solid ${accent.borderInactive}`, color: accent.tint, opacity: 0.85 };

  const dot = loginDot(account);
  return (
    <button
      onClick={onClick}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      // Shift+F10 / tecla de menu: el mismo menu sin raton (contrato de pestañas e iconos del dock).
      onKeyDown={(e) => {
        if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        onContextMenu(rect.left, rect.bottom);
      }}
      style={style}
      aria-pressed={active}
      // El hover faltaba (reporte del usuario). No puede ser `hover:bg-*`: el fondo lo fija el acento
      // de la cuenta por `style`, y una utilidad de Tailwind no gana a un estilo en linea. Se resuelve
      // con lo que SI queda libre — el brillo y la opacidad—, que ademas funciona igual en la activa
      // (que ya va a opacidad plena) y en las inactivas (que van al 85 %).
      className={`relative flex shrink-0 items-center justify-center rounded-[7px] text-[11px] font-bold transition-[filter,opacity] duration-150 ease-out hover:!opacity-100 hover:brightness-125 ${SIZE}`}
      data-tip={`${account.alias} · ${account.provider} · ${loginLabel(account)}`}
      aria-label={`Cuenta ${account.alias}, ${account.provider}, ${loginLabel(account)}`}
    >
      {account.monogram}
      <span
        aria-hidden="true"
        className={`absolute -bottom-[2px] -right-[2px] h-[8px] w-[8px] rounded-full border-2 border-mg-rail ${dot.className}`}
        style={dot.style}
      />
    </button>
  );
}
