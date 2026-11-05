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

// Lo que el seguimiento del final necesita del scroller (en tests, un objeto plano).
export interface WatchedScroller<T> {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
  readonly firstElementChild: { readonly children: ArrayLike<T> } | null;
  addEventListener(type: 'scroll', listener: () => void, options: { readonly passive: true }): void;
  removeEventListener(type: 'scroll', listener: () => void): void;
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
export function watchChatBottom<T>(scroller: WatchedScroller<T>, stuck: { current: boolean }, createObserver: (onResize: () => void) => SizeObserver<T>): () => void {
  const onScroll = (): void => {
    stuck.current = distanceToBottom(scroller) <= STICK_TO_BOTTOM_PX;
  };
  const observer = createObserver(() => {
    if (stuck.current) pinToBottom(scroller);
  });
  observer.observe(scroller);
  for (const child of Array.from(scroller.firstElementChild?.children ?? [])) observer.observe(child);
  scroller.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    observer.disconnect();
    scroller.removeEventListener('scroll', onScroll);
  };
}
