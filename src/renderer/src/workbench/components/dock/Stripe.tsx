import { useRef, useState } from 'react';
import { isArrowNavKey, nextIndexForArrow } from '../../a11y/keyboardNav';
import type { PanelDefinition } from '../../panels/panelRegistry';
import type { PanelId, ZoneKey } from '@shared/panelLayout';
import { usePanelDragStore } from '../../panels/dragState';
import { resolveDropBeforeId } from '../../panels/panelLayoutOps';
import { Icon } from '../Icon';

// Mime propio para el arrastre de iconos entre zonas/bordes (F6, feedback del usuario: arrastrar Y
// PUNTO, sin un boton "⋮" dedicado por icono — el menu "Mover a..." de un icono existente solo se abre
// con clic derecho o su equivalente de teclado. El "⋮" que SI es visible en la stripe (al final) es
// otra cosa: añadir un panel que hoy no esta en este borde, como el "+"/"⋮" de la stripe de JetBrains).
export const DRAG_MIME = 'application/x-mage-panel-id';

// El panel que se arrastra vive en `usePanelDragStore` (panels/dragState.ts) y no en una variable de
// modulo: hace falta que TODAS las zonas se enteren a la vez para reservar su hueco al empezar el
// arrastre, y una variable suelta no re-pinta a nadie. El porque de reservarlo esta escrito alli.

export interface StripeProps {
  readonly ariaLabel: string;
  readonly zoneAPanels: readonly PanelDefinition[];
  readonly zoneAActiveId: PanelId | null;
  readonly zoneBPanels: readonly PanelDefinition[];
  readonly zoneBActiveId: PanelId | null;
  // El caller decide la semantica exacta de "pulsar este icono" (abrir/cambiar de activo/cerrar):
  // difiere segun cuantos paneles comparten la zona (LeftDock con 1 vs RightDock con 5, PLAN-F6 §7).
  readonly onToggle: (zone: ZoneKey, panelId: PanelId) => void;
  // "Mover a..." (§6): el caller (el Dock) es quien sabe renderizar el menu con los destinos reales
  // (moveDestinations) y llamar a movePanel — Stripe solo AVISA de la intencion con la posicion del
  // clic/icono, sin conocer el store de layout.
  readonly onRequestMove: (zone: ZoneKey, panelId: PanelId, x: number, y: number) => void;
  // Soltar un icono arrastrado sobre esta zona (F6, arrastre nativo — alternativa a "Mover a..." sin
  // pasar por ningun menu). El caller resuelve a que anchor/zone corresponde igual que con onToggle.
  // `beforeId`: icono ante el que cae (null = al final), para poder reordenar dentro de la misma zona.
  readonly onDropPanel: (zone: ZoneKey, panelId: PanelId, beforeId: PanelId | null) => void;
  // Paneles que HOY no viven en ningun icono de este borde y se podrian añadir (feedback del usuario:
  // boton "⋮" al final de la stripe, como el "+"/"⋮" de la stripe de JetBrains). Vacio => sin boton.
  readonly addablePanels: readonly PanelDefinition[];
  readonly onRequestAdd: (x: number, y: number) => void;
  // Ids de panel que deben llevar un punto de aviso sobre su icono (p.ej. `permissions` con un permiso
  // pendiente) — sustituye al aviso que antes vivia en la pestaña, ya eliminada (ver ZonePane.tsx).
  readonly badgedPanelIds?: ReadonlySet<PanelId>;
  readonly className?: string;
  // Tercera posicion "abajo" (2026-08-06, distinta de la zona 'b'/"medio" de este MISMO borde): sus
  // iconos viven en esta stripe pero targetean el panel COMPARTIDO de abajo (anchor 'bottom'), no el
  // de este lado — por eso llega como callbacks sueltos (sin ZoneKey: el caller ya sabe que es
  // bottom/a o bottom/b segun el lado) en vez de reusar onToggle/onRequestMove/onDropPanel de arriba.
  // Omitir `thirdPanels` (o dejarlo vacio) no pinta nada — no hace falta un cuarto callback "hayThird".
  readonly thirdPanels?: readonly PanelDefinition[];
  readonly thirdActiveId?: PanelId | null;
  readonly onToggleThird?: (panelId: PanelId) => void;
  readonly onRequestMoveThird?: (panelId: PanelId, x: number, y: number) => void;
  readonly onDropThird?: (panelId: PanelId, beforeId: PanelId | null) => void;
}

// Caja fija del icono de un panel (16 px, rejilla de la suite): mismo tamaño en todos, sin depender del glifo.
export const PANEL_ICON_PX = 16;

const STRIPE_BUTTON_SELECTOR = 'button[data-stripe-btn="true"]';

// Punto de agarre de la imagen de arrastre dentro del icono (28x28): su centro.
const DRAG_IMAGE_OFFSET_PX = 14;

// Ancho de una columna de iconos: 4 px de aire a cada lado + el icono de 28, MAS el pixel del borde que
// las dos columnas llevan (`border-r` en el rail izquierdo, `border-l` en la stripe derecha). Con
// `box-sizing: border-box` ese borde sale del hueco de CONTENIDO, asi que con 36 quedaban 27 px utiles
// para un icono de 28: ese pixel de sobra sacaba una barra de scroll HORIZONTAL de 11 px en las dos
// barras (reporte del usuario), y esos 11 px de alto robado eran los que luego sacaban la vertical.
// En UN solo sitio porque lo usan las dos barras —esta y la de la izquierda, que vive dentro de
// AccountRail— y el usuario reporto justo eso: "la de la izquierda es mas gorda, iguala el ancho a la
// de la derecha". Con el numero repetido en dos ficheros, volver a divergir es cuestion de tiempo.
export const STRIPE_WIDTH_CLASS = 'w-[37px]';
export const STRIPE_PAD_CLASS = 'p-[4px]';

// Clases del contenedor que SCROLLEA los iconos cuando no caben. Dos cosas que no son de adorno:
//
// - `overflow-x-hidden` EXPLICITO: con `overflow-y:auto` a secas el navegador promociona el otro eje de
//   `visible` a `auto` (regla de la especificacion), asi que cualquier pixel que sobre a lo ancho en una
//   columna de 28 px saca barra horizontal. El eje X de una barra de iconos no tiene nada que scrollear.
// - El ocultado de la barra vive en la clase `mg-noscrollbar` de index.css y NO en utilidades
//   `[scrollbar-width:none]`: index.css declara `* { scrollbar-width: thin }` SIN @layer, y todo lo que
//   genera Tailwind vive en `@layer utilities` — que por definicion de cascada pierde contra lo no
//   capado, gane o no en especificidad. La utilidad estaba puesta y no hacia nada.
export const STRIPE_SCROLL_CLASS = 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden mg-noscrollbar';

// Roving tabindex compartido por cualquier contenedor role="toolbar" de iconos-panel (la stripe
// completa, o un grupo suelto como los que AccountRail.tsx incrusta en su propia columna — ver
// DockZoneToolbar mas abajo). Extraido para no duplicar la misma consulta+calculo dos veces.
function useStripeToolbarKeyDown(): { readonly containerRef: React.RefObject<HTMLDivElement | null>; readonly onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void } {
  const containerRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!isArrowNavKey(e.key)) return;
    const buttons = containerRef.current?.querySelectorAll<HTMLElement>(STRIPE_BUTTON_SELECTOR);
    if (buttons === undefined || buttons.length === 0) return;
    e.preventDefault();
    const current = Array.from(buttons).indexOf(document.activeElement as HTMLElement);
    const nextIndex = nextIndexForArrow(buttons.length, Math.max(0, current), e.key);
    buttons[nextIndex]?.focus();
  };
  return { containerRef, onKeyDown };
}

// Toolbar MINIMA para un solo grupo de iconos de zona, sin el envoltorio completo de <Stripe> (fondo/
// padding/spacer/"añadir"/dos zonas): la usa AccountRail.tsx, que funde la stripe izquierda dentro de
// su propia columna en vez de pintarla como bloque aparte (F6, feedback del usuario: "no deberian ser
// 2 barras separadas"). Sin esto, esos iconos quedaban en el Tab normal pero SIN flechas ni
// role="toolbar" — un hueco de accesibilidad frente a como se navegan en RightDock/BottomDock.
export function DockZoneToolbar({
  ariaLabel,
  children,
}: {
  readonly ariaLabel: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const { containerRef, onKeyDown } = useStripeToolbarKeyDown();
  return (
    <div ref={containerRef} role="toolbar" aria-label={ariaLabel} aria-orientation="vertical" onKeyDown={onKeyDown}>
      {children}
    </div>
  );
}

// Linea que separa dos grupos de iconos de una misma barra (arriba / medio / abajo). El color NO sale
// de `--color-mg-border`: ese token solo se rellena si el tema importado trae `panel.border` o alguno
// de sus candidatos (vscodeTheme.ts), y muchos temas de VS Code no declaran NINGUNO — entonces se
// queda el valor base de index.css (un gris casi negro) sobre el fondo del tema, y con un tema oscuro
// de rail claro, o al reves, la linea desaparece. Reporte del usuario: "hay una divisoria pero, segun
// el tema, no se ve".
//
// Se deriva del color de TEXTO (`bg-mg-body` + opacidad), que por definicion contrasta con el fondo de
// SU tema: `--color-mg-body` sale de `editor.foreground`/`foreground`, que todo tema trae. Un 30% de
// ese color es una linea sutil pero visible con cualquier tema importado, claro u oscuro, sin depender
// de ningun token opcional.
export function StripeSeparator(): React.JSX.Element {
  return <div aria-hidden="true" className="my-[3px] h-px w-full shrink-0 bg-mg-body opacity-30" />;
}

// Stripe de iconos de un borde (F6, PLAN-F6-PANELES.md §3.2/§6, ajustada con el feedback del usuario
// tras verla en vivo): role="toolbar", NO "tablist" — en una stripe pueden estar varias zonas abiertas
// a la vez (una por zona), asi que no es seleccion unica. Zona 'a' se pinta al principio, zona 'b' al
// final (separador flexible entre medias): arriba/abajo en left/right, izquierda/derecha en bottom. Sin
// ningun panel asignado a ninguna zona, la stripe entera ni se pinta (§4.1) — es el caso de hoy para el
// borde inferior.
export function Stripe({
  ariaLabel,
  zoneAPanels,
  zoneAActiveId,
  zoneBPanels,
  zoneBActiveId,
  onToggle,
  onRequestMove,
  onDropPanel,
  addablePanels,
  onRequestAdd,
  badgedPanelIds,
  className = '',
  thirdPanels = [],
  thirdActiveId = null,
  onToggleThird,
  onRequestMoveThird,
  onDropThird,
}: StripeProps): React.JSX.Element | null {
  // El hook va ANTES de la guarda: React exige el mismo numero de hooks en cada render del mismo
  // componente, y esta stripe pasa de pintar a no pintar EN UNA ACTUALIZACION (mover su ultimo icono a
  // otro borde), no en un remontaje — con la llamada detras del `return null` eso era un
  // "Rendered fewer hooks than expected" y el arbol se iba al ErrorBoundary.
  //
  // Roving tabindex sobre TODOS los botones-icono de la stripe (ambas zonas + "añadir"), mismo modulo
  // puro que ya usan TabBar/Inspector (a11y/keyboardNav.ts) para su propio tablist — aqui sobre un
  // toolbar.
  const { containerRef, onKeyDown } = useStripeToolbarKeyDown();
  if (zoneAPanels.length === 0 && zoneBPanels.length === 0 && addablePanels.length === 0 && thirdPanels.length === 0) return null;

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      onKeyDown={onKeyDown}
      className={`flex flex-col ${STRIPE_WIDTH_CLASS} min-h-0 items-center gap-[2px] bg-mg-rail ${STRIPE_PAD_CLASS} ${className}`}
    >
      {/* Los iconos van dentro de un contenedor que scrollea y los controles de abajo ("añadir") fuera,
          siempre a la vista. Sin esto, con muchos paneles en un mismo borde la columna crecia por encima
          del alto de la ventana y empujaba el scroll a la PAGINA — reporte del usuario, medido primero
          en la barra izquierda y luego otra vez en esta. */}
      <div data-stripe-scroll="true" className={`flex w-full flex-col items-center gap-[2px] ${STRIPE_SCROLL_CLASS}`}>
      <StripeZoneButtons
        panels={zoneAPanels}
        activeId={zoneAActiveId}
        badgedPanelIds={badgedPanelIds}
        onClick={(id) => onToggle('a', id)}
        onRequestMove={(id, x, y) => onRequestMove('a', id, x, y)}
        onDrop={(id, beforeId) => onDropPanel('a', id, beforeId)}
      />
      {/* Separador entre "arriba" y "medio" (feedback del usuario, 2026-08-06: en JetBrains van
          pegadas arriba, separadas por una linea — no "medio" empujada al fondo por el hueco
          flexible, que es lo que le pasaba a la "abajo" real). */}
      <StripeSeparator />
      <StripeZoneButtons
        panels={zoneBPanels}
        activeId={zoneBActiveId}
        badgedPanelIds={badgedPanelIds}
        onClick={(id) => onToggle('b', id)}
        onRequestMove={(id, x, y) => onRequestMove('b', id, x, y)}
        onDrop={(id, beforeId) => onDropPanel('b', id, beforeId)}
      />
      <div className="flex-1" />
      {/* Se monta SIEMPRE que el caller soporte la tercera posicion, aunque hoy este vacia (Ronda 3,
          item 7: con la guarda `thirdPanels.length > 0` el grupo ni existia en el DOM, asi que no habia
          nada que escuchara dragover/drop y era imposible arrastrar un icono a la posicion vacia — solo
          se podia llegar por el menu "Mover a...", y desde entonces el arrastre ya funcionaba). El
          min-h-7 de StripeZoneButtons le da area de suelta aun sin iconos. */}
      {/* Separador antes de "abajo", igual que en AccountRail.tsx: sin el, la tercera posicion no se
          distingue del hueco elastico y una zona de suelta que no se ve es una zona que nadie usa. */}
      {onDropThird !== undefined && <StripeSeparator />}
      {onDropThird !== undefined && (
        <StripeZoneButtons
          panels={thirdPanels}
          activeId={thirdActiveId}
          onClick={(id) => onToggleThird?.(id)}
          onRequestMove={(id, x, y) => onRequestMoveThird?.(id, x, y)}
          onDrop={onDropThird}
        />
      )}
      </div>
      {addablePanels.length > 0 && (
        <button
          data-stripe-btn="true"
          onClick={(e) => onRequestAdd(e.clientX, e.clientY)}
          aria-label="Añadir panel a este borde"
          data-tip="Añadir panel a este borde"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[13px] text-mg-muted hover:bg-mg-hover hover:text-mg-body"
        >
          <Icon name="ellipsis" size={PANEL_ICON_PX} />
        </button>
      )}
    </div>
  );
}

export function StripeZoneButtons({
  panels,
  activeId,
  onClick,
  onRequestMove,
  onDrop,
  badgedPanelIds,
}: {
  readonly panels: readonly PanelDefinition[];
  readonly activeId: PanelId | null;
  readonly onClick: (panelId: PanelId) => void;
  readonly onRequestMove: (panelId: PanelId, x: number, y: number) => void;
  readonly onDrop: (panelId: PanelId, beforeId: PanelId | null) => void;
  readonly badgedPanelIds?: ReadonlySet<PanelId>;
}): React.JSX.Element {
  // Roving tabindex: el boton activo es el foco por defecto de esta zona; si ninguno lo esta (zona
  // cerrada), cae al primero — nunca deja la zona sin ningun boton alcanzable con Tab.
  const hasActive = panels.some((p) => p.id === activeId);
  const [dragOver, setDragOver] = useState(false);
  // Donde caeria el icono dentro de ESTA zona: sobre que icono esta el puntero y si en su mitad de arriba.
  // Solo alimenta la linea de insercion (superpuesta, no cambia tamaños) y el `beforeId` de la suelta.
  const [target, setTarget] = useState<{ readonly id: PanelId; readonly before: boolean } | null>(null);

  // Zona de SUELTA (F6, arrastre nativo): soltar aqui un icono arrastrado desde OTRA zona lo mueve. El
  // borde con feedback visual solo mientras dura el "dragover" (nunca queda pegado tras soltar/salir).
  const onDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    setDragOver(true);
    if (e.target === e.currentTarget) setTarget(null); // hueco entre iconos o zona vacia: al final
  };
  const onDragOverIcon = (e: React.DragEvent<HTMLButtonElement>, id: PanelId): void => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    const before = isUpperHalf(e.currentTarget, e.clientY);
    setTarget((t) => (t !== null && t.id === id && t.before === before ? t : { id, before }));
  };
  const endDrag = usePanelDragStore((s) => s.end);
  const onDropZone = (e: React.DragEvent<HTMLDivElement>): void => {
    const panelId = e.dataTransfer.getData(DRAG_MIME);
    // El destino sale de la PROPIA suelta, no del `target` del ultimo render: si el `dragover` final no
    // llego a pintarse (arrastre rapido, o un drop sintetico), el estado aun dice null y el icono se iba
    // al final en vez de a su sitio (medido con verify:gui: el orden no cambiaba).
    const dropped = dropTargetOf(e);
    const beforeId = dropped === null ? null : resolveDropBeforeId(panels.map((p) => p.id), dropped.id, dropped.before);
    setDragOver(false);
    setTarget(null);
    endDrag();
    if (panelId.length === 0) return;
    e.preventDefault();
    onDrop(panelId, beforeId);
  };

  // Hueco fantasma en la posicion EXACTA que ocuparia el icono al soltarlo: al final del grupo, que es
  // donde lo mete `movePanelToZone`.
  //
  // Se reserva mientras dura el arrastre ENTERO, no solo al pasar por encima. Antes aparecia con el
  // `dragover` y desaparecia al salir, y eso movia el layout justo debajo del cursor: en la zona de
  // abajo —empujada contra el fondo por un hueco elastico, o sea que crece hacia ARRIBA— el hueco
  // apartaba la zona del puntero, el puntero salia, el hueco se iba, la zona volvia... un bucle sin
  // fin que el usuario describio como "crece, no crece, crece, no crece". Con el sitio reservado desde
  // el `dragstart`, el `dragover` solo RESALTA y el layout no se mueve.
  //
  // Solo si viene de OTRA zona: arrastrar un icono sobre su propio grupo no lo mueve a ningun sitio, y
  // reservarle hueco ahi seria mentir.
  const dragging = usePanelDragStore((s) => s.dragging);
  const incoming = dragging !== null && !panels.some((p) => p.id === dragging.id) ? dragging : null;

  // El hueco minimo de una zona VACIA solo se reserva MIENTRAS SE ARRASTRA, que es cuando hace falta
  // como destino de suelta (reporte del usuario: "si no hay ningun icono arriba pero si en medio,
  // arriba queda un espacio muerto"). En reposo la zona vacia mide 0 y no ocupa nada; en cuanto
  // empieza un arrastre recupera su area de suelta y ademas pinta el hueco fantasma, asi que sigue
  // siendo visible y soltable — que era lo que este minimo vino a arreglar.
  const minSizeClass = dragging === null ? '' : 'min-h-7';

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => {
        setDragOver(false);
        setTarget(null);
      }}
      onDrop={onDropZone}
      // En columna, como la stripe (todas son verticales: la horizontal no llego a usarse y se quito).
      // min-h de un icono (feedback del usuario: "no deja arrastrar a una zona vacia") — sin paneles, este
      // div media 0x0 (sin hijos) y dejaba de existir como area de suelta valida; con el minimo, sigue
      // habiendo algo donde soltar aunque la zona este vacia.
      // `outline-offset:-2px` no es cosmetico: el contenedor que scrollea los iconos lleva
      // `overflow-y-auto`/`overflow-x-hidden` (STRIPE_SCROLL_CLASS) y la columna mide justo un icono
      // (28 px de icono en 29 de hueco util), asi que un outline pintado HACIA FUERA se comia el
      // recorte por los dos lados y la marca de suelta salia cortada (reporte del usuario). Dibujado
      // hacia dentro cabe entero sin tocar el ancho de la barra ni el de los iconos.
      className={`flex flex-col ${minSizeClass} gap-[2px] rounded-[6px] outline outline-2 [outline-offset:-2px] transition-[outline-color,background-color] duration-150 ease-out ${dragOver ? 'bg-mg-sel outline-mg-focus' : 'outline-transparent'}`}
    >
      {panels.map((p, i) => (
        <StripeIconButton
          key={p.id}
          panel={p}
          active={p.id === activeId}
          badged={badgedPanelIds?.has(p.id) ?? false}
          tabIndex={p.id === activeId || (!hasActive && i === 0) ? 0 : -1}
          onClick={() => onClick(p.id)}
          onRequestMove={(x, y) => onRequestMove(p.id, x, y)}
          onDragOverIcon={(e) => onDragOverIcon(e, p.id)}
          dropLine={target !== null && target.id === p.id && dragging?.id !== p.id ? (target.before ? 'top' : 'bottom') : null}
        />
      ))}
      {incoming !== null && (
        <span
          aria-hidden="true"
          data-drop-ghost="true"
          // Mas marcado bajo el cursor que en reposo: con el sitio reservado en TODAS las zonas a la
          // vez, la opacidad es lo unico que dice cual recibiria la suelta.
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-dashed border-mg-focus text-[13px] text-mg-focus transition-opacity duration-150 ease-out ${
            dragOver ? 'opacity-100' : 'opacity-45'
          }`}
        >
          <Icon name={incoming.icon} size={PANEL_ICON_PX} />
        </span>
      )}
    </div>
  );
}

// Icono de un panel + su afordancia de "mover a otra zona" (§6, ajustado con el feedback del usuario
// tras verlo en vivo): arrastrar-y-soltar como via PRINCIPAL (nativa, sin menu), clic derecho o su
// equivalente de teclado (tecla de menu/Shift+F10) para abrir "Mover a..." — SIN boton "⋮" visible por
// icono: el usuario lo encontro feo/redundante con el arrastre.
function StripeIconButton({
  panel,
  active,
  badged,
  tabIndex,
  onClick,
  onRequestMove,
  onDragOverIcon,
  dropLine,
}: {
  readonly panel: PanelDefinition;
  readonly active: boolean;
  readonly badged: boolean;
  readonly tabIndex: 0 | -1;
  readonly onClick: () => void;
  readonly onRequestMove: (x: number, y: number) => void;
  readonly onDragOverIcon: (e: React.DragEvent<HTMLButtonElement>) => void;
  // Linea de insercion pintada en el borde de arriba/abajo de ESTE icono (superpuesta: no mueve nada).
  readonly dropLine: 'top' | 'bottom' | null;
}): React.JSX.Element {
  const onContextMenu = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    onRequestMove(e.clientX, e.clientY);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    const isMenuKey = e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);
    if (!isMenuKey) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    onRequestMove(rect.right, rect.top);
  };
  const startDrag = usePanelDragStore((s) => s.start);
  const endDrag = usePanelDragStore((s) => s.end);
  const dragging = usePanelDragStore((s) => s.dragging?.id === panel.id);
  const onDragStart = (e: React.DragEvent<HTMLButtonElement>): void => {
    e.dataTransfer.setData(DRAG_MIME, panel.id);
    e.dataTransfer.effectAllowed = 'move';
    // La imagen del arrastre se FIJA aqui, con el icono todavia en su sitio: un tick despues las
    // zonas reservan su hueco fantasma y el boton se mueve, y sin esto Chromium sacaba la foto ya
    // desplazada (o vacia).
    e.dataTransfer.setDragImage(e.currentTarget, DRAG_IMAGE_OFFSET_PX, DRAG_IMAGE_OFFSET_PX);
    // Y el estado de arrastre se publica en el SIGUIENTE tick, no dentro del `dragstart`: reservar el
    // hueco fantasma cambia el DOM, y si ese cambio esta POR ENCIMA del icono que se acaba de coger,
    // lo desplaza hacia abajo mientras Chromium aun esta arrancando el gesto y el arrastre muere al
    // instante. Eso explica exactamente el reporte del usuario ("el arrastre no funciona en la zona de
    // en medio, ni en la barra izquierda ni en la derecha, pero soltar ahi si"): desde la zona de
    // ARRIBA los huecos que aparecen quedan todos por debajo y no mueven al origen, desde la de EN
    // MEDIO el hueco de la zona de arriba si lo mueve. Con el aplazamiento el navegador ya tiene el
    // arrastre en marcha cuando llega el re-render, y el resultado visible es el mismo.
    window.setTimeout(() => startDrag(panel), 0);
  };
  // Tambien en `drop`, no solo en `dragend`: si se suelta sobre una zona el orden de los dos eventos no
  // esta garantizado, y quedarse con el hueco reservado despues de soltar deja la barra descuadrada.
  const onDragEnd = (): void => endDrag();
  return (
    <button
      data-stripe-btn="true"
      data-panel-id={panel.id}
      draggable
      tabIndex={tabIndex}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOverIcon}
      aria-pressed={active}
      aria-label={panel.title}
      data-tip={panel.title}
      className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[13px] transition-opacity duration-150 ease-out hover:text-mg-body ${
        active ? 'bg-mg-sel text-mg-body' : 'text-mg-icon'
      } ${dragging ? 'opacity-40' : ''}`}
    >
      <Icon name={panel.icon} size={PANEL_ICON_PX} />
      {dropLine !== null && (
        <span
          aria-hidden="true"
          data-drop-line={dropLine}
          className={`pointer-events-none absolute left-[2px] right-[2px] h-[2px] rounded-full bg-mg-focus ${dropLine === 'top' ? 'top-0' : 'bottom-0'}`}
        />
      )}
      {badged && <span aria-hidden="true" className="absolute right-[3px] top-[3px] h-[5px] w-[5px] rounded-full bg-mg-focus" />}
    </button>
  );
}

// ¿Cae el puntero en la mitad de arriba del icono? Decide si la suelta va antes o despues de el.
function isUpperHalf(icon: Element, clientY: number): boolean {
  const rect = icon.getBoundingClientRect();
  return clientY < rect.top + rect.height / 2;
}

// Icono sobre el que se suelta (dentro de la zona que atiende la suelta) y en que mitad; null si se
// suelta en un hueco, que significa «al final».
function dropTargetOf(e: React.DragEvent<HTMLElement>): { readonly id: PanelId; readonly before: boolean } | null {
  const icon = (e.target as Element).closest<HTMLElement>('[data-panel-id]');
  if (icon === null || !e.currentTarget.contains(icon)) return null;
  const id = icon.dataset.panelId as PanelId | undefined;
  if (id === undefined) return null;
  return { id, before: isUpperHalf(icon, e.clientY) };
}
