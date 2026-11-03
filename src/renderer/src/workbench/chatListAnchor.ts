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
