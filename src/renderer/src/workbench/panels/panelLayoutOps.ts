// Mutaciones PURAS del layout de paneles en vivo (F6 Fase 4, PLAN-F6-PANELES.md §6/§7): a diferencia
// de reconcileLayoutWithRegistry (shared/panelLayout.ts, arranque/migracion), estas funciones operan
// sobre un `PanelLayoutState` YA reconciliado, en respuesta a una interaccion del usuario (abrir/
// cerrar una zona, mover un panel a otra zona, confirmar un resize). Sin FS, sin DOM, sin React: el
// store (panelLayoutStore.ts) es el unico caller, y es quien persiste el resultado via IPC.

import {
  ANCHORS,
  DEFAULT_ZONE_SIZE_PX,
  MIN_ZONE_SIZE_PX,
  ZONE_KEYS,
  type Anchor,
  type PanelId,
  type PanelLayoutState,
  type ZoneKey,
  type ZoneState,
} from '@shared/panelLayout';

export interface ZoneLocation {
  readonly anchor: Anchor;
  readonly zone: ZoneKey;
}

// Reemplaza UNA zona del layout, preservando el resto (inmutable, sin mutar `layout`).
function withZone(layout: PanelLayoutState, anchor: Anchor, zone: ZoneKey, next: ZoneState): PanelLayoutState {
  return { ...layout, stripes: { ...layout.stripes, [anchor]: { ...layout.stripes[anchor], [zone]: next } } };
}

// Donde vive HOY un panel dentro del layout (a diferencia de su defaultAnchor/defaultZone del
// registro, que solo importa para reconciliar en frio). `undefined` si el id no aparece en ninguna
// zona — no deberia pasar tras reconciliar, pero la funcion no lo asume (nunca lanza).
export function locatePanel(layout: PanelLayoutState, panelId: PanelId): ZoneLocation | undefined {
  for (const anchor of ANCHORS) {
    for (const zone of ZONE_KEYS) {
      if (layout.stripes[anchor][zone].panelIds.includes(panelId)) return { anchor, zone };
    }
  }
  return undefined;
}

// Todos los paneles asignados a ALGUNA zona, mirando el layout COMPLETO (Ronda 3, item 19: cada dock
// calculaba su propio conjunto con solo las zonas de SU lado, asi que el menu "Añadir panel" del borde
// derecho seguia ofreciendo un panel ya abierto en el izquierdo — y pulsarlo lo hacia desaparecer de
// donde estaba, sin aviso). Mismo recorrido anchors x zonas que locatePanel.
export function allAssignedPanelIds(layout: PanelLayoutState): ReadonlySet<PanelId> {
  const assigned = new Set<PanelId>();
  for (const anchor of ANCHORS) {
    for (const zone of ZONE_KEYS) {
      for (const panelId of layout.stripes[anchor][zone].panelIds) assigned.add(panelId);
    }
  }
  return assigned;
}

// Alterna la visibilidad de `panelId` dentro de SU zona (§6: "Enter/Espacio sobre su icono en la
// stripe alterna la zona"): si ya es el activo, la cierra (null); si no lo es (incluida una zona
// cerrada o mostrando otro panel de la misma zona), lo abre/activa. `panelId` DEBE pertenecer a esa
// zona (precondicion de funcion publica, CLAUDE.md): lanza con el id recibido si no.
export function toggleZonePanel(layout: PanelLayoutState, anchor: Anchor, zone: ZoneKey, panelId: PanelId): PanelLayoutState {
  const current = layout.stripes[anchor][zone];
  if (!current.panelIds.includes(panelId)) {
    throw new Error(`toggleZonePanel: el panel "${panelId}" no pertenece a la zona ${anchor}/${zone}`);
  }
  const activePanelId = current.activePanelId === panelId ? null : panelId;
  return withZone(layout, anchor, zone, { ...current, activePanelId });
}

// ¿La transicion `before` -> `after` de UNA zona representa "abrirla" (estaba cerrada, ahora tiene un
// panel activo)? Decision PURA que el store usa para decidir si debe robar el foco (§6: solo una
// apertura EXPLICITA lo hace — nunca un simple cambio de pestaña dentro de una zona ya abierta, ni un
// cierre). Separada de toggleZonePanel para poder testear el criterio de foco sin IPC/DOM: el store
// (panelLayoutStore.ts) que la consume toca `window.mage` y, como el resto de stores de Zustand del
// proyecto que hacen lo mismo (workbenchStore.ts), no se testea de forma directa.
export function didZoneJustOpen(before: ZoneState, after: ZoneState): boolean {
  return before.activePanelId === null && after.activePanelId !== null;
}

// Mueve `panelId` de su zona actual a {toAnchor, toZone} (§6, menu "Mover a..."): sale de
// `panelIds` de origen (con fallback de activePanelId al primero que quede, o null si no queda
// ninguno) y entra al FINAL de `panelIds` del destino, activo alli (mover implica ver el panel en su
// nuevo sitio). Si el destino estaba vacio, hereda el tamaño por defecto de su borde; si ya tenia
// contenido, conserva el sizePx existente de esa zona (no saltar de tamaño por la llegada de un panel).
export function movePanelToZone(layout: PanelLayoutState, panelId: PanelId, toAnchor: Anchor, toZone: ZoneKey): PanelLayoutState {
  const from = locatePanel(layout, panelId);
  if (from === undefined) {
    throw new Error(`movePanelToZone: el panel "${panelId}" no esta en ninguna zona del layout actual`);
  }
  if (from.anchor === toAnchor && from.zone === toZone) {
    throw new Error(`movePanelToZone: el panel "${panelId}" ya esta en ${toAnchor}/${toZone}`);
  }

  const fromZone = layout.stripes[from.anchor][from.zone];
  const remainingIds = fromZone.panelIds.filter((id) => id !== panelId);
  const fromActive = fromZone.activePanelId === panelId ? (remainingIds[0] ?? null) : fromZone.activePanelId;
  const afterLeaving = withZone(layout, from.anchor, from.zone, { ...fromZone, panelIds: remainingIds, activePanelId: fromActive });

  const toZoneState = afterLeaving.stripes[toAnchor][toZone];
  const toSizePx = toZoneState.panelIds.length === 0 ? DEFAULT_ZONE_SIZE_PX[toAnchor] : toZoneState.sizePx;
  return withZone(afterLeaving, toAnchor, toZone, { panelIds: [...toZoneState.panelIds, panelId], activePanelId: panelId, sizePx: toSizePx });
}

// Coloca en {toAnchor, toZone} un panel que HOY no esta en ninguna zona: es la mitad "entrar" de
// `movePanelToZone`, y el caso del menu "Añadir panel" — que solo ofrece paneles escondidos, o sea
// justo los que `movePanelToZone` rechaza por no estar en ningun sitio.
//
// Es funcion aparte y no una guarda dentro de `movePanelToZone` a proposito: alli, un panel sin zona ES
// un error (significa que el layout y el registro no casan), y tragarselo esconderia el fallo. Aqui es
// la precondicion normal, y por eso se exige al reves.
export function placePanelInZone(layout: PanelLayoutState, panelId: PanelId, toAnchor: Anchor, toZone: ZoneKey): PanelLayoutState {
  if (locatePanel(layout, panelId) !== undefined) {
    throw new Error(`placePanelInZone: el panel "${panelId}" ya esta en una zona; usa movePanelToZone`);
  }
  const zone = layout.stripes[toAnchor][toZone];
  const sizePx = zone.panelIds.length === 0 ? DEFAULT_ZONE_SIZE_PX[toAnchor] : zone.sizePx;
  return withZone(layout, toAnchor, toZone, { panelIds: [...zone.panelIds, panelId], activePanelId: panelId, sizePx });
}

// Quita `panelId` de su zona SIN ponerlo en ninguna otra (Ronda 3, item 11, "Esconder icono"): hasta
// ahora solo se podia MOVER entre zonas, nunca sacar el icono de la barra. Es la mitad "salir" de
// movePanelToZone; el panel no se pierde (vuelve a estar disponible en el menu "Añadir panel" de
// cualquier borde, porque allAssignedPanelIds deja de contarlo). Idempotente: un panel que ya no esta
// en ninguna zona devuelve el layout tal cual, no lanza.
export function removePanelFromLayout(layout: PanelLayoutState, panelId: PanelId): PanelLayoutState {
  const from = locatePanel(layout, panelId);
  if (from === undefined) return layout;

  const fromZone = layout.stripes[from.anchor][from.zone];
  const remainingIds = fromZone.panelIds.filter((id) => id !== panelId);
  const activePanelId = fromZone.activePanelId === panelId ? (remainingIds[0] ?? null) : fromZone.activePanelId;
  return withZone(layout, from.anchor, from.zone, { ...fromZone, panelIds: remainingIds, activePanelId });
}

// Fija el tamaño de una zona (confirmado por el caller: al soltar el raton, o al momento en teclado —
// §6). Clamp defensivo al minimo (nunca deja una zona ilegible), igual que sanitizeSizePx en la
// reconciliacion; el maximo lo decide el caller (depende del viewport, ajeno a este modulo puro).
export function resizeZone(layout: PanelLayoutState, anchor: Anchor, zone: ZoneKey, sizePx: number): PanelLayoutState {
  const current = layout.stripes[anchor][zone];
  return withZone(layout, anchor, zone, { ...current, sizePx: Math.max(sizePx, MIN_ZONE_SIZE_PX) });
}

// Fija el reparto entre 'a' y 'b' de UNA stripe cuando ambas estan abiertas (feedback del usuario,
// 2026-08-06: "los paneles divididos no se pueden agrandar o hacer mas pequeños"). Mismo clamp
// defensivo al minimo que resizeZone; el caller (el divisor de split) solo lo llama con ambas zonas
// abiertas, pero esta funcion no lo asume — fijar el reparto de una stripe con una sola zona abierta
// no rompe nada, simplemente no se ve hasta que se abra la segunda.
export function resizeSplit(layout: PanelLayoutState, anchor: Anchor, splitPx: number): PanelLayoutState {
  return { ...layout, stripes: { ...layout.stripes, [anchor]: { ...layout.stripes[anchor], splitPx: Math.max(splitPx, MIN_ZONE_SIZE_PX) } } };
}

export interface MoveDestination {
  readonly anchor: Anchor;
  readonly zone: ZoneKey;
  readonly label: string;
}

// Las 6 zonas posibles con su etiqueta exacta (2026-08-06: 'b' de izquierda/derecha renombrada de
// "abajo" a "medio" para no confundirla con la zona compartida de abajo, que es un anchor distinto).
const ALL_DESTINATIONS: readonly MoveDestination[] = [
  { anchor: 'left', zone: 'a', label: 'Izquierda arriba' },
  { anchor: 'left', zone: 'b', label: 'Izquierda medio' },
  { anchor: 'right', zone: 'a', label: 'Derecha arriba' },
  { anchor: 'right', zone: 'b', label: 'Derecha medio' },
  { anchor: 'bottom', zone: 'a', label: 'Abajo izquierda' },
  { anchor: 'bottom', zone: 'b', label: 'Abajo derecha' },
];

// Destinos del menu "Mover a..." (§6): las 6 zonas EXCLUYENDO la actual.
export function moveDestinations(current: ZoneLocation): readonly MoveDestination[] {
  return ALL_DESTINATIONS.filter((d) => !(d.anchor === current.anchor && d.zone === current.zone));
}
