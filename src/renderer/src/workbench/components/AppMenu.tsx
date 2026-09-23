import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWorkbenchStore } from '../workbenchStore';
import { buildAppMenuModel, type AppMenu as AppMenuModel, type AppMenuItem } from '../appMenuModel';
import { nextIndexForArrow } from '../a11y/keyboardNav';
import { runGlobalAction } from '../keybindings/useGlobalKeybindings';

// Barra de menus PROPIA (2.9.b), que sustituye al `Menu` nativo. Los items se generan del catalogo de
// acciones (`appMenuModel`), asi que un atajo re-asignado en Configuracion se ve aqui sin tocar nada.
//
// Accesibilidad: es un patron ARIA entero (`menubar` + `menu` + flechas en las dos direcciones +
// Escape + Home/End), y en este repo el harness ya ha cazado TRES bugs de teclado. Por eso las flechas
// se resuelven con `nextIndexForArrow`, el mismo modulo puro que usan los otros dos tablists.
const isMac = navigator.platform.toLowerCase().includes('mac');

export function AppMenu({
  expanded,
  onExpandedChange,
}: {
  readonly expanded: boolean;
  readonly onExpandedChange: (value: boolean) => void;
}): React.JSX.Element {
  const overrides = useWorkbenchStore((s) => s.settings.keybindingOverrides);
  // Un selector por VALOR PRIMITIVO, nunca uno que devuelva un objeto nuevo: zustand compara el
  // resultado por identidad, y un objeto recien creado en cada llamada es un re-render infinito (la app
  // no llegaba ni a montar). El objeto se compone despues, con useMemo.
  const permissionPending = useWorkbenchStore((s) => s.pendingByChat[s.activeTabId] !== null && s.pendingByChat[s.activeTabId] !== undefined);
  const status = useWorkbenchStore((s) => s.statusByChat[s.activeTabId]);
  const dialogOpen = useWorkbenchStore((s) => s.settingsOpen || s.newTabOpen || s.addAccountOpen || s.handoffOpen);
  const menus = useMemo(
    () =>
      buildAppMenuModel({
        overrides,
        isMac,
        guardContext: {
          promptTextEmpty: true,
          permissionPending,
          turnRunning: status === 'streaming' || status === 'needs_permission',
          dialogOrPopoverOpen: dialogOpen,
          focusInEditableText: false,
        },
      }),
    [overrides, permissionPending, status, dialogOpen],
  );
  // PLEGADO por defecto (peticion del usuario, estilo IntelliJ). El estado lo lleva la CABECERA, no
  // este componente: al desplegarse, la barra de menus SUSTITUYE al resto del contenido (cuentas,
  // Preferencias) en vez de añadirse y empujarlo — que fue justo la queja del primer intento.
  const setExpanded = onExpandedChange;
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Punto del cursor en el momento de desplegar. Al hacerlo, las etiquetas aparecen justo DONDE estaba
  // el raton (encima del boton de tres puntos) y el `mouseenter` que provoca ese cambio de layout abria
  // "Conversación" sola — parecia que viniera con un clic ya dado.
  //
  // Se compara la POSICION en vez de esperar a un evento `mousemove`: un gate por evento se comia el
  // PRIMER hover de verdad, porque el `mouseenter` del boton llega antes de que React haya aplicado el
  // cambio de estado. Con un ref y las coordenadas no hay carrera: mientras el cursor siga en el mismo
  // punto, ese enter es el sintetico; en cuanto se mueve un pixel, es del usuario.
  const expandPointRef = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Clic FUERA de la barra: se pliega. Se escucha en fase de captura y en `mousedown` (no `click`)
  // para cerrar antes de que el clic llegue a lo que haya debajo, que es como se comporta una barra de
  // menus de verdad. El desplegable vive en un portal fuera de `barRef`, asi que se excluye por su
  // `role="menu"`: sin eso, elegir un item cerraria la barra antes de ejecutarlo.
  useEffect(() => {
    if (!expanded) {
      setOpenIndex(null);
      expandPointRef.current = null;
      return;
    }
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (barRef.current?.contains(target) === true) return;
      if ((target as Element).closest?.('[role="menu"]') !== null) return;
      setExpanded(false);
      setOpenIndex(null);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [expanded, setExpanded]);

  // Flechas IZQUIERDA/DERECHA entre menus: si hay uno abierto, se mueve la apertura (comportamiento de
  // una barra de menus de verdad); si no, solo el foco.
  const onBarKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      // Escape SOLO pliega si no hay ningun submenu abierto. Con uno abierto, el Escape es suyo: lo
      // cierra y devuelve el foco a su boton. Sin esta guarda se plegaba la barra entera de golpe, los
      // botones se desmontaban y el foco se perdia — lo canto la comprobacion de teclado, que mide
      // justo donde acaba el foco tras Escape.
      if (openIndex !== null) return;
      event.preventDefault();
      setExpanded(false);
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = openIndex ?? focusedButtonIndex(barRef.current);
    const next = nextIndexForArrow(menus.length, current, event.key);
    focusButton(barRef.current, next);
    if (openIndex !== null) setOpenIndex(next);
  };

  if (!expanded) {
    return (
      <button
        aria-label="Menú de la aplicación"
        aria-haspopup="menu"
        aria-expanded={false}
        data-app-menu-toggle="true"
        data-tip="Menú de la aplicación"
        onClick={(event) => {
          expandPointRef.current = { x: event.clientX, y: event.clientY };
          setExpanded(true);
        }}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        // Mismo alto que los botones de cuenta (26 px en una franja de 32): el primer intento lo dejo
        // en un glifo diminuto que no habia manera de acertar con el raton.
        className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] text-[16px] leading-none transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body"
      >
        ⋮
      </button>
    );
  }

  return (
    <div
      ref={barRef}
      role="menubar"
      aria-label="Menú de la aplicación"
      onKeyDown={onBarKeyDown}
      className="flex items-center gap-[2px]"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {menus.map((menu, index) => (
        <MenuButton
          key={menu.label}
          menu={menu}
          open={openIndex === index}
          onToggle={() => setOpenIndex((current) => (current === index ? null : index))}
          // Desplegada la barra, basta con PASAR EL RATON para abrir el submenu — es lo que se pidio y
          // es como se comporta IntelliJ tras pulsar su boton de menu. No hace falta clic previo: el
          // clic ya se dio en los tres puntos, y a partir de ahi la barra esta "armada".
          onHover={(event) => {
            const from = expandPointRef.current;
            // Mismo punto exacto que al desplegar = es el `mouseenter` que provoco el cambio de layout,
            // no un gesto del usuario. Se ignora una sola vez; cualquier movimiento real ya difiere.
            if (from !== null && event.clientX === from.x && event.clientY === from.y) return;
            expandPointRef.current = null;
            setOpenIndex(index);
          }}
          onClose={() => {
            setOpenIndex(null);
            focusButton(barRef.current, index);
          }}
        />
      ))}
    </div>
  );
}

function MenuButton({
  menu,
  open,
  onToggle,
  onHover,
  onClose,
}: {
  readonly menu: AppMenuModel;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onHover: (event: React.MouseEvent<HTMLButtonElement>) => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<{ readonly x: number; readonly y: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setAnchor(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect !== undefined) setAnchor({ x: rect.left, y: rect.bottom });
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        onMouseEnter={onHover}
        className={`rounded-[5px] px-[8px] py-[2px] transition-colors duration-150 ease-out hover:bg-mg-hover hover:text-mg-body ${open ? 'bg-mg-hover text-mg-body' : ''}`}
      >
        {menu.label}
      </button>
      {open && anchor !== null && <MenuDropdown menu={menu} anchor={anchor} onClose={onClose} />}
    </>
  );
}

// El desplegable, con el MISMO patron que `TabContextMenu`: portal a body, posicion fija con clamp
// medido, `role="menu"`, Escape y clic fuera cierran, foco en el primer item al abrir.
function MenuDropdown({
  menu,
  anchor,
  onClose,
}: {
  readonly menu: AppMenuModel;
  readonly anchor: { readonly x: number; readonly y: number };
  readonly onClose: () => void;
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: MENU_MIN_WIDTH_PX, height: 0 });

  useEffect(() => {
    const element = menuRef.current;
    if (element === null) return;
    setSize({ width: element.offsetWidth, height: element.offsetHeight });
    element.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Flechas ARRIBA/ABAJO entre items (y Home/End), con el mismo modulo puro que los tablists.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (items.length === 0) return;
    const current = items.findIndex((item) => item === document.activeElement);
    const next = nextIndexForArrow(items.length, current < 0 ? 0 : current, event.key);
    if (next === current) return;
    event.preventDefault();
    items[next]?.focus();
  };

  const left = Math.max(0, Math.min(anchor.x, window.innerWidth - size.width - MENU_MARGIN_PX));
  const top = Math.max(0, Math.min(anchor.y, window.innerHeight - size.height - MENU_MARGIN_PX));

  return createPortal(
    <>
      {/* SIN backdrop a pantalla completa. Habia uno (`fixed inset-0`) y tapaba la cabecera: el raton
          nunca llegaba a las otras etiquetas, asi que el hover no conmutaba de menu y un clic en
          "Sesión" caia en el velo y solo cerraba. El clic fuera lo gestiona `AppMenu` con un listener
          de `mousedown` en captura, que ademas sabe distinguir la barra y el propio desplegable. */}
      <div
        ref={menuRef}
        role="menu"
        aria-label={menu.label}
        onKeyDown={onKeyDown}
        style={{ position: 'fixed', left, top, zIndex: 9999, minWidth: MENU_MIN_WIDTH_PX }}
        className="overflow-hidden rounded-[8px] border border-mg-border-pop bg-mg-popover py-[4px] text-[11.5px] text-mg-body mg-shadow-pop"
      >
        {menu.items.map((item) => (
          <MenuRow key={item.label} item={item} onClose={onClose} />
        ))}
      </div>
    </>,
    document.body,
  );
}

function MenuRow({ item, onClose }: { readonly item: AppMenuItem; readonly onClose: () => void }): React.JSX.Element {
  const activate = (): void => {
    onClose();
    // Dos mundos: las acciones de Mage salen del catalogo y las de EDICION son de `webContents` (las
    // que daba el menu nativo). Sin las segundas, quitar el menu nativo dejaria a macOS sin Cmd+C.
    if (item.editCommand !== undefined) {
      void window.mage.runEditCommand(item.editCommand).catch((err: unknown) => console.warn('Comando de edición:', err));
      return;
    }
    if (item.actionId !== null) runGlobalAction(item.actionId);
  };

  return (
    <button
      role="menuitem"
      disabled={!item.enabled}
      onClick={activate}
      className="flex w-full items-center gap-[18px] px-[10px] py-[5px] text-left transition-colors duration-150 ease-out hover:bg-mg-hover disabled:opacity-40 disabled:hover:bg-transparent"
    >
      <span className="flex-1">{item.label}</span>
      {item.shortcut !== null && <span className="flex-none font-mono text-[10px] text-mg-muted">{item.shortcut}</span>}
    </button>
  );
}

const MENU_MIN_WIDTH_PX = 220;
const MENU_MARGIN_PX = 8;

function focusedButtonIndex(bar: HTMLDivElement | null): number {
  const buttons = [...(bar?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]') ?? [])];
  const index = buttons.findIndex((button) => button === document.activeElement);
  return index < 0 ? 0 : index;
}

function focusButton(bar: HTMLDivElement | null, index: number): void {
  const buttons = [...(bar?.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]') ?? [])];
  buttons[index]?.focus();
}
