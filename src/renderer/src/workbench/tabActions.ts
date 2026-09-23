import type { ChatStatus, Tab } from './types';

// Decisiones PURAS del menu contextual de pestañas (Ronda 3, item 12): que se cierra en cada accion en
// masa, en que orden se pintan y de que color va cada pestaña. Sin store ni DOM: TabBar/workbenchStore
// las consumen, y asi las reglas ("anclar protege de los cierres en masa", "inactiva = sin agente
// trabajando") se pueden probar sin montar la UI.

// Nº de acentos del tema. Los VALORES viven en index.css (--mg-accent-<i>-*), los mismos que usan las
// cuentas — no se inventa una paleta nueva solo para las pestañas.
export const TAB_COLOR_COUNT = 6;

// Mime propio del arrastre de pestañas al centro (I11-drag, mismo patron que `DRAG_MIME` de
// `dock/Stripe.tsx` para los iconos de panel de F6): un tipo de dato PROPIO en vez de "text/plain"
// para que un arrastre de fuera de la app (un fichero, un enlace) nunca cuente como pestaña soltada.
export const TAB_DRAG_MIME = 'application/x-mage-tab-id';

// Color del punto/indicador de una pestaña: su override manual si lo tiene, si no el acento de su
// cuenta. Devuelve una referencia a variable CSS, asi conmuta con el tema sin recolorear en JS.
// Tolera indices fuera de rango (estado persistido manipulado a mano) en vez de pintar `undefined`.
export function tabColorVar(colorIndex: number | undefined, accountAccent: string): string {
  if (colorIndex === undefined || !Number.isInteger(colorIndex)) return accountAccent;
  const index = ((colorIndex % TAB_COLOR_COUNT) + TAB_COLOR_COUNT) % TAB_COLOR_COUNT;
  return `var(--mg-accent-${index}-base)`;
}

// Pestañas que cierra "Cerrar todas": todas menos las ANCLADAS — proteger de un cierre en masa es
// justamente para lo que sirve anclar.
export function tabsToCloseAll(tabs: readonly Tab[]): readonly Tab[] {
  return tabs.filter((tab) => tab.pinned !== true);
}

// Pestañas que cierra "Cerrar las inactivas": ni ancladas, ni con el agente trabajando, ni con un
// permiso pendiente o un error sin ver. Una pestaña sin entrada en `statusByChat` nunca arrancó
// sesion, asi que cuenta como inactiva.
export function tabsToCloseInactive(
  tabs: readonly Tab[],
  statusByChat: Readonly<Record<string, ChatStatus | undefined>>,
): readonly Tab[] {
  return tabs.filter((tab) => tab.pinned !== true && (statusByChat[tab.id] ?? 'idle') === 'idle');
}

// Orden de la barra: las ancladas primero, conservando el orden relativo dentro de cada grupo (un
// `sort` no vale: no es estable respecto a lo que espera el usuario si mezcla los dos grupos).
export function orderTabsForDisplay(tabs: readonly Tab[]): readonly Tab[] {
  const pinned = tabs.filter((tab) => tab.pinned === true);
  if (pinned.length === 0 || pinned.length === tabs.length) return tabs; // nada que reordenar
  return [...pinned, ...tabs.filter((tab) => tab.pinned !== true)];
}
