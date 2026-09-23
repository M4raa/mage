import { useRef } from 'react';
import type { Anchor, PanelId, StripeState, ZoneKey } from '@shared/panelLayout';
import { resolvePanelDefinitions } from '../../panels/panelRegistry';
import { usePanelLayoutStore } from '../../panelLayoutStore';
import { ZonePane } from './ZonePane';
import { DOCK_SPLIT_SIZE_VAR, DOCK_ZONE_SIZE_VAR, ZoneResizeHandle } from './ZoneResizeHandle';

export interface DockZoneProps {
  readonly anchor: Anchor;
  readonly zone: ZoneKey;
  readonly panelIds: readonly PanelId[];
  readonly activePanelId: PanelId | null;
  readonly sizePx: number;
  // Nodo que HOSPEDA la variable CSS del tamaño (la raiz de SplitZones, comun a las dos zonas del
  // borde): el arrastre en vivo la muta ahi para que AMBOS panes crezcan a la vez — ver SplitZones.
  readonly sizeHostRef: React.RefObject<HTMLElement | null>;
  readonly borderClassName: string;
  readonly resizeAriaLabel: string;
}

// Pane + divisor de resize de UNA zona, ya orientados segun el borde (F6 Fase 4, §3.2/§6): el divisor
// vive siempre en el lado de la zona que MIRA al centro (izquierda->su derecha, derecha->su izquierda,
// abajo->su arriba) — es el unico borde de la zona que tiene sentido resizear (los otros tres tocan el
// borde de la ventana o la stripe de iconos, fijos). `null` si la zona esta cerrada: no ocupa hueco en
// la rejilla (§3.2, "la columna/fila colapsa a 0").
export function DockZone({ anchor, zone, panelIds, activePanelId, sizePx, sizeHostRef, borderClassName, resizeAriaLabel }: DockZoneProps): React.JSX.Element | null {
  const zoneRef = useRef<HTMLDivElement>(null);
  const resizeZone = usePanelLayoutStore((s) => s.resizeZone);
  if (activePanelId === null) return null;

  const pane = (
    <ZonePane
      zoneRef={zoneRef}
      anchor={anchor}
      zone={zone}
      panels={resolvePanelDefinitions(panelIds)}
      activePanelId={activePanelId}
      sizePx={sizePx}
      borderClassName={borderClassName}
    />
  );
  const handle = (
    <ZoneResizeHandle anchor={anchor} sizePx={sizePx} paneRef={sizeHostRef} onCommit={(px) => resizeZone(anchor, px)} ariaLabel={resizeAriaLabel} />
  );

  const containerAxis = anchor === 'bottom' ? 'flex-col' : 'flex-row';
  const handleFirst = anchor !== 'left'; // left: pane luego handle; right/bottom: handle luego pane
  // flex-1 es el fix real: sin el, esta zona solo mide lo que mide su CONTENIDO (el pane no llega al
  // suelo, y el divisor de resize — que vive dentro de esta misma caja — se queda igual de corto, dando
  // la sensacion de que "se separa" del resto del borde). El eje que crece lo decide el padre (columna
  // en left/right, fila en bottom), asi que el mismo flex-1 vale para los tres bordes.
  return (
    <div className={`flex min-h-0 min-w-0 flex-1 ${containerAxis}`}>
      {handleFirst ? (
        <>
          {handle}
          {pane}
        </>
      ) : (
        <>
          {pane}
          {handle}
        </>
      )}
    </div>
  );
}

export interface SplitZonesProps {
  readonly anchor: Anchor;
  readonly stripe: StripeState;
  readonly borderClassNameA: string;
  readonly borderClassNameB: string;
  readonly resizeAriaLabelA: string;
  readonly resizeAriaLabelB: string;
  readonly splitAriaLabel: string;
  // LeftDock/BottomDock son la RAIZ de su borde (su tamaño lo fija el contenido, no deben crecer
  // contra su propio padre — el rail de la app, no esta stripe). RightDock envuelve esto junto a
  // ContextFooterConnected en el MISMO flex-col: ahi SI hace falta `flex-1` para que las zonas se
  // repartan el hueco que dejaria libre el footer. Vacio por defecto (el caso mas comun).
  readonly className?: string;
}

// Las dos zonas de UNA stripe + el divisor de SPLIT entre ellas (2026-08-06, feedback del usuario: "los
// paneles divididos no se pueden agrandar o hacer mas pequeños") — hasta ahora, con 'a' y 'b' abiertas
// a la vez, ambas se repartian el hueco 50/50 vía `flex-1` en las dos, sin ningun mecanismo para
// ajustar ese reparto. Zona 'a' pasa a vivir en un envoltorio con tamaño FIJO (`stripe.splitPx`, eje de
// apilado: alto en left/right, ancho en bottom) solo mientras 'b' TAMBIEN esta abierta; con 'b' cerrada,
// 'a' vuelve a ocupar todo el hueco (flex-1) exactamente como antes. Extraido aqui (no en cada Dock) para
// no triplicar la misma logica en LeftDock/RightDock/BottomDock.
export function SplitZones({ anchor, stripe, borderClassNameA, borderClassNameB, resizeAriaLabelA, resizeAriaLabelB, splitAriaLabel, className = '' }: SplitZonesProps): React.JSX.Element {
  const resizeSplit = usePanelLayoutStore((s) => s.resizeSplit);
  const splitRef = useRef<HTMLDivElement>(null);
  // La variable del tamaño vive AQUI, en la raiz comun de las dos zonas del borde, no en cada pane
  // (Ronda 3, items 14b+15). Antes cada zona fijaba su PROPIO ancho: al agrandar solo 'a', la columna
  // entera se ensanchaba (align-items: stretch) pero 'b' seguia en su ancho viejo, dejando un hueco
  // transparente que enseñaba el bg-mg-window de detras ("doble color de fondo") y estirando el
  // divisor de split ("el separador cambia de tamaño"). Con un unico valor por borde —hospedado aqui,
  // heredado por los dos panes y mutado aqui tambien durante el arrastre— crecen los dos a la vez.
  const sizeHostRef = useRef<HTMLDivElement>(null);
  const aOpen = stripe.a.activePanelId !== null;
  const bothOpen = aOpen && stripe.b.activePanelId !== null;
  const axisClass = anchor === 'bottom' ? 'flex-row' : 'flex-col';
  // Con 'a' cerrada manda el tamaño de 'b'. Los dos valores persistidos se igualan en el primer
  // resize (ver resizeZone en panelLayoutStore); mientras tanto, uno de los dos es el que se aplica.
  const sizePx = aOpen ? stripe.a.sizePx : stripe.b.sizePx;
  // `0 1` y NO `0 0`: la zona 'a' no crece (su tamaño lo manda `splitPx`) pero SI PUEDE ENCOGER.
  //
  // Con `flex-shrink: 0`, un `splitPx` guardado con la ventana grande sobrevivia a encoger la ventana:
  // el envoltorio se quedaba clavado en, p.ej., 700 px de alto dentro de un borde de 500, y aunque la
  // caja del borde si encoge (`min-h-0`), su CONTENIDO desbordaba hacia abajo. Ese desborde es visible,
  // asi que ampliaba el area scrollable del DOCUMENTO: la barra de scroll aparecia en la PAGINA entera
  // y el prompt y la barra de estado se iban de la vista. Es el reporte "el drawer izquierdo es mas
  // grande a lo vertical y crea un scroll de toda la app", y por eso reaparecia tras dos arreglos que
  // solo miraban las columnas de iconos: el tamaño problematico no era el de los iconos, era este.
  //
  // Con shrink a 1, el reparto de espacio NEGATIVO se lo come 'a' (la 'b' tiene basis 0, asi que no
  // aporta nada a encoger) y el borde vuelve a caber en la ventana. `splitPx` NO se toca: al agrandar
  // la ventana, 'a' recupera exactamente el reparto que el usuario habia dejado.
  const aWrapperStyle: React.CSSProperties = bothOpen
    ? { flex: `0 1 var(${DOCK_SPLIT_SIZE_VAR}, ${stripe.splitPx}px)`, [DOCK_SPLIT_SIZE_VAR as string]: `${stripe.splitPx}px` }
    : { flex: '1 1 0%' };

  return (
    <div
      ref={sizeHostRef}
      style={{ [DOCK_ZONE_SIZE_VAR as string]: `${sizePx}px` } as React.CSSProperties}
      className={`flex min-h-0 min-w-0 ${axisClass} ${className}`}
    >
      {aOpen && (
        <div ref={splitRef} className={`flex min-h-0 min-w-0 ${axisClass}`} style={aWrapperStyle}>
          <DockZone anchor={anchor} zone="a" panelIds={stripe.a.panelIds} activePanelId={stripe.a.activePanelId} sizePx={sizePx} sizeHostRef={sizeHostRef} borderClassName={borderClassNameA} resizeAriaLabel={resizeAriaLabelA} />
        </div>
      )}
      {bothOpen && (
        <ZoneResizeHandle
          anchor={anchor}
          axis="split"
          sizeVar={DOCK_SPLIT_SIZE_VAR}
          sizePx={stripe.splitPx}
          paneRef={splitRef}
          onCommit={(px) => resizeSplit(anchor, px)}
          ariaLabel={splitAriaLabel}
        />
      )}
      <DockZone anchor={anchor} zone="b" panelIds={stripe.b.panelIds} activePanelId={stripe.b.activePanelId} sizePx={sizePx} sizeHostRef={sizeHostRef} borderClassName={borderClassNameB} resizeAriaLabel={resizeAriaLabelB} />
    </div>
  );
}
