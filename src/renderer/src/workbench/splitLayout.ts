import type { SplitLayout } from '@shared/state';

// Arbol de division del centro (I11, ampliado en I12): generaliza Ronda 3 item 13 ("como mucho 2
// paneles, fijos") a N paneles anidando divisiones binarias — el mismo modelo que usan los grupos de
// editor de VS Code/JetBrains. Desde I12 una HOJA es un GRUPO de pestañas (cada panel tiene su propia
// barra), no una sola pestaña. Modulo PURO: sin store ni DOM, para poder probar el arbol sin montar
// la UI. El TIPO vive en `@shared/state` (derivado del esquema Zod persistido, ver stateSchema.ts)
// para que un campo no pueda existir aqui sin existir en el esquema.
//
// TRES invariantes, garantizados por TODAS las funciones de este modulo:
//   1. `tabIds` de una hoja nunca esta vacia (una hoja vacia colapsa a su hermana).
//   2. `activeTabId` pertenece SIEMPRE a `tabIds`.
//   3. Una misma pestaña no aparece en dos hojas (Mage no muestra la misma conversacion dos veces).

export type SplitDirection = 'row' | 'col';
export type SplitPathStep = 'a' | 'b';
export type SplitPath = readonly SplitPathStep[];
export type SplitLeaf = Extract<SplitLayout, { kind: 'leaf' }>;

const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;

// Ancho/alto minimo de un panel EN PIXELES. `MIN_RATIO` es una fraccion, asi que en una ventana
// pequeña no impide que un panel quede en 40px; el renderer pasa el tamaño real y `resizeAt` acota
// tambien por pixeles. 320px = el minimo con el que el chat sigue siendo usable (prompt + burbujas).
export const MIN_PANE_PX = 320;

// Suelo PROPORCIONAL, para cuando el contenedor no da para dos minimos absolutos. Un cuarto del
// espacio deja el panel pequeño usable y al divisor la mitad central de recorrido.
export const MIN_PANE_FRACTION = 0.25;

// --- Construccion ------------------------------------------------------------------------------

// Hoja (grupo de pestañas). Valida los invariantes 1 y 2 en la frontera: un grupo mal construido
// rompe la UI mucho mas lejos de donde se creo.
export function leaf(tabIds: readonly string[], activeTabId: string): SplitLayout {
  if (tabIds.length === 0) throw new Error('leaf: un grupo no puede estar vacio (tabIds: [])');
  if (!tabIds.includes(activeTabId)) {
    throw new Error(`leaf: activeTabId "${activeTabId}" no esta en el grupo [${tabIds.join(', ')}]`);
  }
  return { kind: 'leaf', tabIds, activeTabId };
}

// Atajo para el caso de una sola pestaña (el 90% de las llamadas).
export function singleLeaf(tabId: string): SplitLayout {
  return { kind: 'leaf', tabIds: [tabId], activeTabId: tabId };
}

// --- Consulta ----------------------------------------------------------------------------------

// La pestaña ACTIVA de cada hoja, en orden de lectura: exactamente lo que hay pintado en pantalla.
export function visibleTabIds(layout: SplitLayout): readonly string[] {
  if (layout.kind === 'leaf') return [layout.activeTabId];
  return [...visibleTabIds(layout.a), ...visibleTabIds(layout.b)];
}

// TODAS las pestañas de todas las hojas (para podar, cerrar y reconciliar).
export function allTabIds(layout: SplitLayout): readonly string[] {
  if (layout.kind === 'leaf') return layout.tabIds;
  return [...allTabIds(layout.a), ...allTabIds(layout.b)];
}

// Camino ('a'/'b' desde la raiz) hasta la hoja que CONTIENE `tabId`, o null si no esta en el arbol.
export function findLeafPath(layout: SplitLayout, tabId: string): SplitPath | null {
  if (layout.kind === 'leaf') return layout.tabIds.includes(tabId) ? [] : null;
  const inA = findLeafPath(layout.a, tabId);
  if (inA !== null) return ['a', ...inA];
  const inB = findLeafPath(layout.b, tabId);
  return inB === null ? null : ['b', ...inB];
}

// La hoja que hay al final de `path`. Lanza si el camino no llega a una hoja (contrato de error del
// proyecto: el mensaje lleva el valor recibido).
export function leafAt(layout: SplitLayout, path: SplitPath): SplitLeaf {
  const node = nodeAt(layout, path);
  if (node === null || node.kind !== 'leaf') {
    throw new Error(`leafAt: el path [${path.join(',')}] no señala a ninguna hoja`);
  }
  return node;
}

function nodeAt(layout: SplitLayout, path: SplitPath): SplitLayout | null {
  if (path.length === 0) return layout;
  if (layout.kind === 'leaf') return null;
  const [step, ...rest] = path;
  return nodeAt(step === 'a' ? layout.a : layout.b, rest);
}

// Camino a la PRIMERA hoja en orden de lectura. Siempre existe: el arbol nunca esta vacio.
export function firstLeafPath(layout: SplitLayout): SplitPath {
  return layout.kind === 'leaf' ? [] : ['a', ...firstLeafPath(layout.a)];
}

// --- Transformaciones sobre un camino ----------------------------------------------------------

// Sustituye el subarbol que hay en `path` por `replacement`. Devuelve la MISMA referencia si no hay
// cambio real (el renderer compara por referencia para no repintar).
function replaceAt(layout: SplitLayout, path: SplitPath, replacement: SplitLayout): SplitLayout {
  if (path.length === 0) return replacement;
  if (layout.kind === 'leaf') throw new Error(`replaceAt: el path [${path.join(',')}] atraviesa una hoja`);
  const [step, ...rest] = path;
  if (step === 'a') {
    const a = replaceAt(layout.a, rest, replacement);
    return a === layout.a ? layout : { ...layout, a };
  }
  const b = replaceAt(layout.b, rest, replacement);
  return b === layout.b ? layout : { ...layout, b };
}

// --- Operaciones sobre pestañas -----------------------------------------------------------------

// Activa `tabId` dentro de SU hoja, sin mover nada de sitio. Sin cambios si no esta en el arbol o si
// ya estaba activa.
export function activateTab(layout: SplitLayout, tabId: string): SplitLayout {
  const path = findLeafPath(layout, tabId);
  if (path === null) return layout;
  const target = leafAt(layout, path);
  if (target.activeTabId === tabId) return layout;
  return replaceAt(layout, path, { kind: 'leaf', tabIds: target.tabIds, activeTabId: tabId });
}

// Quita `tabId` de su grupo. Si el grupo se queda vacio, la hoja colapsa y su hermana sube un nivel;
// si era la ultima pestaña del arbol entero, devuelve null (no queda nada que pintar). Sin cambios
// (misma referencia) si `tabId` no estaba en el arbol.
export function closeTab(layout: SplitLayout, tabId: string): SplitLayout | null {
  if (layout.kind === 'leaf') {
    if (!layout.tabIds.includes(tabId)) return layout;
    const kept = layout.tabIds.filter((id) => id !== tabId);
    if (kept.length === 0) return null;
    return leaf(kept, layout.activeTabId === tabId ? kept[0]! : layout.activeTabId);
  }
  const a = closeTab(layout.a, tabId);
  if (a === null) return layout.b;
  const b = closeTab(layout.b, tabId);
  if (b === null) return layout.a;
  return a === layout.a && b === layout.b ? layout : { ...layout, a, b };
}

// Mete `tabId` en la barra de la hoja de `path` y lo deja ACTIVO. Si la pestaña ya estaba en otra
// hoja se saca de alli primero (invariante 3), aunque eso colapse aquella hoja: por eso el destino se
// vuelve a localizar DESPUES del borrado, por una pestaña ancla y no por el camino (que puede haber
// dejado de existir).
export function addTabToLeaf(layout: SplitLayout, path: SplitPath, tabId: string): SplitLayout {
  const target = leafAt(layout, path);
  if (target.tabIds.includes(tabId)) return activateTab(layout, tabId);
  const anchorTabId = target.activeTabId;
  const without = closeTab(layout, tabId) ?? layout;
  const anchorPath = findLeafPath(without, anchorTabId);
  if (anchorPath === null) throw new Error(`addTabToLeaf: la hoja destino desaparecio al mover "${tabId}"`);
  const destination = leafAt(without, anchorPath);
  return replaceAt(without, anchorPath, leaf([...destination.tabIds, tabId], tabId));
}

// Mover una pestaña de una barra a otra (arrastre entre barras). Es `addTabToLeaf` con los argumentos
// en el orden natural del gesto; el borrado del origen ya lo hace aquel.
export function moveTabToLeaf(layout: SplitLayout, tabId: string, targetPath: SplitPath): SplitLayout {
  return addTabToLeaf(layout, targetPath, tabId);
}

// --- Tamaño de los paneles ----------------------------------------------------------------------

function clampToRange(ratio: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, ratio));
}

// Traduce un minimo en PIXELES a fraccion y acota `ratio` con el, encima del acotado por fraccion.
// Casos limite, a proposito y no por descuido:
// - `totalPx <= 0` (panel aun sin medir, ventana minimizada): no hay pixeles que repartir, se acota
//   solo por fraccion.
// - el minimo no cabe dos veces en el total (ventana mas estrecha que 2*minPanePx): reparto a
//   medias, que es lo menos malo — no hay ningun ratio que respete el minimo en los dos lados.
export function clampRatioForSize(ratio: number, totalPx: number, minPanePx: number): number {
  if (!Number.isFinite(ratio)) throw new Error(`clampRatioForSize: ratio no finito (${ratio})`);
  if (!Number.isFinite(totalPx) || !Number.isFinite(minPanePx) || minPanePx < 0) {
    throw new Error(`clampRatioForSize: tamaños invalidos (totalPx: ${totalPx}, minPanePx: ${minPanePx})`);
  }
  if (totalPx <= 0) return clampToRange(ratio, MIN_RATIO, MAX_RATIO);
  // El minimo EFECTIVO es el menor de los dos: el absoluto en pixeles, y una fraccion del contenedor.
  //
  // Las dos versiones anteriores fallaron, cada una por un extremo, y las dos las cazo `verify:gui`:
  //  - Exigir 320 px siempre: en una ventana de 800 el centro son ~287, el minimo pedia 640 y el
  //    divisor se quedaba CLAVADO en 0.5. Un minimo que convierte el divisor en adorno no sirve.
  //  - Ceder del todo cuando no cabe: entonces volvia `MIN_RATIO`=0.1 y un panel se quedaba en 57 px
  //    con ese mismo contenedor — justo "tan pequeño que rompe la distribucion", que es lo que esto
  //    venia a impedir, y encima solo en las ventanas pequeñas, que es cuando mas duele.
  // Con el minimo proporcional el divisor SIEMPRE se puede mover (queda el 50% central de recorrido)
  // y ningun panel baja nunca de una cuarta parte del espacio.
  // El absoluto cuando CABE dos veces; si no, el proporcional. Al reves —quedarse siempre con el menor
  // de los dos— anularia el minimo en pixeles en cuanto el contenedor bajase de `2 * minPanePx`, que
  // es justo donde tiene que seguir mandando.
  const absoluta = minPanePx / totalPx;
  const minFraction = absoluta * 2 <= 1 ? absoluta : MIN_PANE_FRACTION;
  return clampToRange(ratio, Math.max(MIN_RATIO, minFraction), Math.min(MAX_RATIO, 1 - minFraction));
}

// Cambia el reparto (0..1, fraccion de `a`) del nodo de division señalado por `path`. Se acota a
// [MIN_RATIO, MAX_RATIO] y, si el caller pasa `totalPx` (el tamaño real del contenedor en el eje de
// la division), tambien a `MIN_PANE_PX` pixeles por panel. Lanza si el camino no señala a un nodo de
// division real — contrato de error del proyecto (mensaje con el valor).
export function resizeAt(layout: SplitLayout, path: SplitPath, ratio: number, totalPx = 0): SplitLayout {
  if (layout.kind === 'leaf') {
    throw new Error(`resizeAt: el path no señala a ningun nodo de division (quedan ${path.length} pasos sobre una hoja)`);
  }
  if (path.length === 0) {
    return { ...layout, ratio: clampRatioForSize(ratio, totalPx, MIN_PANE_PX) };
  }
  const [step, ...rest] = path;
  return step === 'a'
    ? { ...layout, a: resizeAt(layout.a, rest, ratio, totalPx) }
    : { ...layout, b: resizeAt(layout.b, rest, ratio, totalPx) };
}

// --- Migracion y reconciliacion del estado persistido -------------------------------------------

// Migracion (I11): forma persistida ANTERIOR (splitTabId/splitDirection, como mucho un segundo panel)
// a un arbol. `splitTabId: null` -> un solo panel. (La migracion de la hoja vieja `{kind:'leaf',
// tabId}` a grupo la hace el propio esquema Zod, ver `SPLIT_LAYOUT_SCHEMA`.)
export function fromLegacySplit(activeTabId: string, splitTabId: string | null, splitDirection: SplitDirection): SplitLayout {
  if (splitTabId === null) return singleLeaf(activeTabId);
  return { kind: 'split', direction: splitDirection, ratio: 0.5, a: singleLeaf(activeTabId), b: singleLeaf(splitTabId) };
}

// Reconcilia el arbol tras cerrar `closedTabId`, cuando la pestaña activa pasa a `newActiveTabId`
// (ya decidida por el caller: la primera que quede, o "" si no queda ninguna). Casos:
// - `closedTabId` no estaba en el arbol -> sin cambios.
// - Tras quitarla no queda ninguna hoja -> un panel unico con la nueva activa.
// - `newActiveTabId` sigue en alguna hoja -> solo se activa alli (no se mueve nada de sitio).
// - Si no, la nueva activa entra en la barra donde estaba la cerrada (o en la primera, si esa hoja
//   colapso al vaciarse).
export function reconcileSplitLayoutAfterClose(layout: SplitLayout, closedTabId: string, newActiveTabId: string): SplitLayout {
  const closedPath = findLeafPath(layout, closedTabId);
  if (closedPath === null) return layout;
  const without = closeTab(layout, closedTabId);
  if (without === null) return singleLeaf(newActiveTabId);
  if (findLeafPath(without, newActiveTabId) !== null) return activateTab(without, newActiveTabId);
  const stillALeaf = nodeAt(without, closedPath)?.kind === 'leaf';
  return addTabToLeaf(without, stillALeaf ? closedPath : firstLeafPath(without), newActiveTabId);
}

// Poda el arbol persistido a las pestañas SUPERVIVIENTES (cuenta borrada entre arranques, M2.5) y, de
// paso, hace cumplir el invariante 3 en la frontera: si un fichero persistido trae la misma pestaña en
// dos hojas, se queda en la PRIMERA en orden de lectura. Devuelve null si no sobrevive ninguna.
export function pruneSplitLayout(layout: SplitLayout, survivingTabIds: ReadonlySet<string>): SplitLayout | null {
  return pruneWithSeen(layout, survivingTabIds, new Set());
}

function pruneWithSeen(layout: SplitLayout, surviving: ReadonlySet<string>, seen: Set<string>): SplitLayout | null {
  if (layout.kind === 'leaf') {
    const kept = layout.tabIds.filter((id) => surviving.has(id) && !seen.has(id));
    kept.forEach((id) => seen.add(id));
    if (kept.length === 0) return null;
    if (kept.length === layout.tabIds.length && kept.includes(layout.activeTabId)) return layout;
    return leaf(kept, kept.includes(layout.activeTabId) ? layout.activeTabId : kept[0]!);
  }
  const a = pruneWithSeen(layout.a, surviving, seen);
  if (a === null) return pruneWithSeen(layout.b, surviving, seen);
  const b = pruneWithSeen(layout.b, surviving, seen);
  if (b === null) return a;
  return a === layout.a && b === layout.b ? layout : { ...layout, a, b };
}

// --- Arrastrar una pestaña a un panel (I11-drag): estilo VS Code/IntelliJ, sin boton -----------

// Las 5 zonas de suelta dentro de un panel. 'center' mueve la pestaña al GRUPO de ese panel (I12:
// antes sustituia el panel entero); las otras 4 crean una division nueva pegada a ese borde.
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

// Rectangulo minimo que necesita `zoneFromPoint` — NO es `DOMRect` a proposito: este modulo no toca
// el DOM, y un objeto plano se puede construir en un test sin `document`.
export interface DropRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

// Fraccion (0..1) del ancho/alto que ocupa la zona CENTRAL a cada lado de su punto medio: cuanto mas
// pequeña, mas facil acertar en un borde; cuanto mas grande, mas facil acertar en el centro. 0.2 deja
// una franja central del 40% del panel, el resto se reparte en las 4 diagonales de borde.
const CENTER_HALF_WIDTH = 0.2;

// Zona bajo el puntero (posicion ABSOLUTA en pantalla) dentro de `rect`. Divide el panel en una cruz:
// el eje con MAYOR desviacion del centro decide el borde (izq/dcha si la desviacion horizontal es
// mayor que la vertical, arriba/abajo si es al reves); dentro del cuadrado central, ningun eje dista
// lo bastante y gana 'center'. Es el mismo reparto visual que usa VS Code al arrastrar una pestaña.
export function zoneFromPoint(rect: DropRect, clientX: number, clientY: number): DropZone {
  const dx = (clientX - rect.left) / rect.width - 0.5;
  const dy = (clientY - rect.top) / rect.height - 0.5;
  if (Math.abs(dx) < CENTER_HALF_WIDTH && Math.abs(dy) < CENTER_HALF_WIDTH) return 'center';
  return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'top' : 'bottom';
}

// Punto de entrada UNICO para un soltar real (lo que llama el store). El destino es el CAMINO del
// panel sobre el que se suelta, no una pestaña: con grupos, un panel ya no se identifica por su
// contenido. 'center' mueve la pestaña a ese grupo; las 4 zonas de borde crean una division nueva con
// la arrastrada sola en su propio grupo. Si el panel destino solo tiene a la arrastrada, dividir no
// haria nada: se devuelve el arbol sin cambios.
export function applyDrop(layout: SplitLayout, draggedTabId: string, targetPath: SplitPath, zone: DropZone): SplitLayout {
  const target = leafAt(layout, targetPath);
  if (zone === 'center') return moveTabToLeaf(layout, draggedTabId, targetPath);
  const anchorTabId = target.tabIds.find((id) => id !== draggedTabId);
  if (anchorTabId === undefined) return layout; // la arrastrada es la UNICA del panel destino
  const without = closeTab(layout, draggedTabId) ?? layout;
  const anchorPath = findLeafPath(without, anchorTabId);
  if (anchorPath === null) throw new Error(`applyDrop: la hoja destino desaparecio al mover "${draggedTabId}"`);
  const remaining = leafAt(without, anchorPath);
  const draggedGoesFirst = zone === 'left' || zone === 'top';
  const node: SplitLayout = {
    kind: 'split',
    direction: zone === 'left' || zone === 'right' ? 'row' : 'col',
    ratio: 0.5,
    a: draggedGoesFirst ? singleLeaf(draggedTabId) : remaining,
    b: draggedGoesFirst ? remaining : singleLeaf(draggedTabId),
  };
  return replaceAt(without, anchorPath, node);
}
