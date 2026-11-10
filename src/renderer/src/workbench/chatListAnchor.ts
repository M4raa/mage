// Ancla de la lista virtualizada del chat: calcula el `firstItemIndex` de Virtuoso al anteponer historial.

// Virtuoso exige que `firstItemIndex` solo baje al anteponer; partir de un número grande deja anteponer sin llegar a 0.
export const FIRST_ITEM_INDEX_BASE = 1_000_000;

export interface ListAnchor {
  readonly firstIndex: number;
  readonly firstKey: string | null;
  readonly generation: number;
}

export const INITIAL_ANCHOR: ListAnchor = { firstIndex: FIRST_ITEM_INDEX_BASE, firstKey: null, generation: 0 };

// Devuelve el ancla para `items`. Misma referencia que `prev` cuando el primer elemento no cambia (cada delta de streaming: O(1)).
export function nextListAnchor<T>(prev: ListAnchor, items: readonly T[], keyOf: (item: T) => string): ListAnchor {
  if (items.length === 0) return { firstIndex: FIRST_ITEM_INDEX_BASE, firstKey: null, generation: prev.generation };
  // Seguro: `items.length > 0` arriba (el índice no comprobado devuelve T | undefined).
  const firstKey = keyOf(items[0] as T);
  if (prev.firstKey === null) return { firstIndex: prev.firstIndex, firstKey, generation: prev.generation };
  if (firstKey === prev.firstKey) return prev;
  const shift = items.findIndex((item) => keyOf(item) === prev.firstKey);
  // Se antepusieron `shift` filas.
  if (shift > 0 && prev.firstIndex - shift >= 0) return { firstIndex: prev.firstIndex - shift, firstKey, generation: prev.generation };
  // Contenido sustituido (rebobinar, recarga): se remonta la lista.
  return { firstIndex: FIRST_ITEM_INDEX_BASE, firstKey, generation: prev.generation + 1 };
}

// Claves añadidas al FINAL de la lista desde el estado anterior (`prev`): son las filas que llegan «en
// vivo» y las únicas que animan su entrada. Sin ancla (primer pintado), con el final sustituido o con
// historial antepuesto no hay ninguna: eso es hidratar, y hidratar no se anima.
export function appendedTailKeys(prev: { readonly length: number; readonly lastKey: string | null }, keys: readonly string[]): readonly string[] {
  if (prev.lastKey === null) return [];
  const at = keys.lastIndexOf(prev.lastKey);
  return at < 0 ? [] : keys.slice(at + 1);
}

// Por debajo de este margen el usuario cuenta como «pegado» al final (mismo valor que `useStickToBottom`, el del panel de Actividad).
export const STICK_TO_BOTTOM_PX = 80;

// A esta distancia (o menos) se está EN el final: es lo único que vuelve a pegar tras haber subido a propósito.
export const AT_BOTTOM_PX = 2;

// Teclas con las que el usuario sube a leer o baja hacia el final (con el foco en el hilo).
const SCROLL_UP_KEYS: ReadonlySet<string> = new Set(['PageUp', 'ArrowUp', 'Home']);
const SCROLL_DOWN_KEYS: ReadonlySet<string> = new Set(['PageDown', 'ArrowDown', 'End', ' ']);

// «El usuario se fue del final a propósito» y «desde entonces hizo un gesto hacia abajo». Lo comparte quien vuelve a
// pegar a mano (enviar un mensaje): `resetAway` lo limpia.
export interface AwayState {
  away: boolean;
  downIntent: boolean;
}

export function resetAway(state: AwayState): void {
  state.away = false;
  state.downIntent = false;
}

// Lo que llega de la rueda y del teclado (en tests, objetos planos).
export interface ScrollIntentEvent {
  readonly deltaY?: number;
  readonly key?: string;
}

type ScrollerEventType = 'scroll' | 'wheel' | 'keydown' | 'pointerdown' | 'pointerup';

// Lo que el seguimiento del final necesita del scroller (en tests, un objeto plano).
export interface WatchedScroller<T> {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly firstElementChild: { readonly children: ArrayLike<T> } | null;
  addEventListener(type: ScrollerEventType, listener: (event: ScrollIntentEvent) => void, options: { readonly passive: true }): void;
  removeEventListener(type: ScrollerEventType, listener: (event: ScrollIntentEvent) => void): void;
}

export interface SizeObserver<T> {
  observe(target: T | WatchedScroller<T>): void;
  disconnect(): void;
}

export function distanceToBottom(scroller: Pick<WatchedScroller<unknown>, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): number {
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
}

// Al final REAL del DOM, no al que calcula Virtuoso con alturas que puede no haber medido aún (V7, R59).
export function pinToBottom(scroller: Pick<WatchedScroller<unknown>, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): void {
  scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
}

// Sigue el final del chat. «Pegado» solo cambia con un scroll: encoger la vista (un dock que aparece) o crecer el
// contenido no despega. Mientras está pegado, cualquier cambio de tamaño del scroller o de los hijos de su viewport
// (cabecera, lista y pie de Virtuoso) vuelve a pegarlo. Devuelve la función que lo desmonta.
//
// P-038: la rueda hacia arriba (o ↑/RePág/Inicio) despega EN EL ACTO y solo vuelve a pegar al llegar al final real
// TRAS UN GESTO DEL USUARIO hacia abajo (rueda abajo, ↓/AvPág/Fin/espacio, arrastrar la barra). Antes, con el margen de
// 80 px, un golpe de rueda corto quedaba dentro del margen y el texto en streaming lo devolvía abajo; y MEDIDO después
// (verify:gui, instrumentado): Virtuoso, al medir el texto que llega, emite un scroll con distancia 0 que el usuario no
// ha hecho, y «llegar al final» con cualquier scroll lo reenganchaba igual.
//
// Y al revés (informe del usuario, 10-11: «al volver a un chat a veces se queda por medio»): un scroll SIN gesto
// tampoco despega. Al remontar la lista, Virtuoso corrige `scrollTop` mientras mide las filas; si esa corrección caía a
// más de 80 px del final, despegaba y ya nadie volvía a bajar. Ahora solo despegan la rueda, las teclas y arrastrar la
// barra.
export function watchChatBottom<T>(
  scroller: WatchedScroller<T>,
  stuck: { current: boolean },
  createObserver: (onResize: () => void) => SizeObserver<T>,
  state: AwayState = { away: false, downIntent: false },
): () => void {
  const leave = (): void => {
    state.away = true;
    state.downIntent = false;
    stuck.current = false;
  };
  // Arrastrando la barra (puntero pulsado sobre el scroller): la dirección solo se sabe por el scroll.
  let dragging = false;
  const onScroll = (): void => {
    const distance = distanceToBottom(scroller);
    if (distance <= AT_BOTTOM_PX && state.downIntent) resetAway(state);
    else if (dragging && distance > STICK_TO_BOTTOM_PX) state.away = true;
    // Sin re-pegar aquí: el scroll ajeno es de Virtuoso, y empujarlo dentro de su propio scroll le descuadra el
    // «estoy al final» con el que sigue el contenido que crece (medido: se quedaba a 787 px). Re-pegan el observador y
    // `settleAtBottom`.
    stuck.current = !state.away;
  };
  const onWheel = (event: ScrollIntentEvent): void => {
    dragging = false;
    const deltaY = event.deltaY ?? 0;
    if (deltaY < 0) leave();
    else if (deltaY > 0) state.downIntent = true;
  };
  const onKey = (event: ScrollIntentEvent): void => {
    if (event.key === undefined) return;
    if (SCROLL_UP_KEYS.has(event.key)) leave();
    else if (SCROLL_DOWN_KEYS.has(event.key)) state.downIntent = true;
  };
  // Arrastrar la barra: no se sabe la dirección hasta el scroll, así que cuenta como gesto hacia abajo si acaba al final.
  const onPointer = (): void => {
    state.downIntent = true;
    dragging = true;
  };
  const onPointerUp = (): void => {
    dragging = false;
  };
  const observer = createObserver(() => {
    if (stuck.current) pinToBottom(scroller);
  });
  observer.observe(scroller);
  for (const child of Array.from(scroller.firstElementChild?.children ?? [])) observer.observe(child);
  scroller.addEventListener('scroll', onScroll, { passive: true });
  scroller.addEventListener('wheel', onWheel, { passive: true });
  scroller.addEventListener('keydown', onKey, { passive: true });
  scroller.addEventListener('pointerdown', onPointer, { passive: true });
  scroller.addEventListener('pointerup', onPointerUp, { passive: true });
  return () => {
    observer.disconnect();
    scroller.removeEventListener('scroll', onScroll);
    scroller.removeEventListener('wheel', onWheel);
    scroller.removeEventListener('keydown', onKey);
    scroller.removeEventListener('pointerdown', onPointer);
    scroller.removeEventListener('pointerup', onPointerUp);
  };
}

// Frames que se sigue re-pegando al final real tras un salto programático: Virtuoso puede reajustar `scrollTop`
// después de medir filas sin cambiar ningún tamaño observado (medido, Z: se quedaba a 10 px del final).
export const SETTLE_FRAMES = 30;

export interface FrameApi {
  request(callback: () => void): number;
  cancel(id: number): void;
}

// Mientras siga «pegado», durante `frames` frames vuelve al final REAL si algo lo ha movido. Para en cuanto deja de
// estar pegado (el usuario subió). Devuelve la función que lo cancela.
export function settleAtBottom(
  scroller: Pick<WatchedScroller<unknown>, 'scrollTop' | 'scrollHeight' | 'clientHeight'>,
  stuck: { readonly current: boolean },
  frameApi: FrameApi,
  frames: number = SETTLE_FRAMES,
): () => void {
  if (!Number.isInteger(frames) || frames < 0) throw new Error(`frames no valido: ${frames}`);
  let pending: number | null = null;
  const step = (left: number): void => {
    pending = null;
    if (left === 0 || !stuck.current) return;
    if (distanceToBottom(scroller) > 0) pinToBottom(scroller);
    pending = frameApi.request(() => step(left - 1));
  };
  pending = frameApi.request(() => step(frames));
  return () => {
    if (pending !== null) frameApi.cancel(pending);
    pending = null;
  };
}
