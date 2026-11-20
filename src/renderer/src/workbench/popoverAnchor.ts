// --- Popovers de `@` y `/` anclados al carácter (P-038) ------------------------------------------------------
// Popovers de `@` y `/`: en la columna del propio carácter y siempre ENCIMA de la caja del input (no de la línea del carácter), para no tapar el texto. PURO.

export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

// Hueco entre el carácter y el popover.
export const POPOVER_GAP_PX = 6;

// `left`/`bottom` (px, relativos a la caja `row`) para un popover de ancho `width` en la columna del carácter `char` y
// encima de la caja. Se recorta para no salirse por la derecha ni por la izquierda.
export function popoverAnchor(char: Box, row: Box, width: number): { readonly left: number; readonly bottom: number } {
  if (!Number.isFinite(width) || width < 0) throw new Error(`Ancho de popover no valido: ${width}`);
  const rowWidth = row.right - row.left;
  const left = Math.max(0, Math.min(char.left - row.left, rowWidth - width));
  return { left: Math.round(left), bottom: Math.round(row.bottom - row.top + POPOVER_GAP_PX) };
}
