// Donde cayo una pestaña (o una fila del historial) que se solto FUERA de su ventana (P-028, 36).
// Puro: main le pasa el cursor (`screen.getCursorScreenPoint()`, no `e.screenX/Y`, que en GTK llega a
// veces a 0) y los bounds de las ventanas VISIBLES.

import type { Rect } from './windowBounds';

export interface WindowRect {
  readonly windowId: string;
  readonly bounds: Rect;
}

export type DropTarget =
  | { readonly kind: 'self' } // dentro de la propia ventana (o Esc con el cursor encima): nada
  | { readonly kind: 'window'; readonly windowId: string } // sobre otra ventana de Mage: se mueve alli
  | { readonly kind: 'outside' }; // fuera de todas: ventana nueva bajo el cursor

function contains(rect: Rect, point: { readonly x: number; readonly y: number }): boolean {
  return point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
}

// La propia ventana gana si el cursor esta sobre ella: sin saber el orden en Z, soltar sobre un
// solape no puede sacar la pestaña de donde el usuario la esta viendo.
export function resolveDropTarget(
  cursor: { readonly x: number; readonly y: number },
  windows: readonly WindowRect[],
  selfId: string,
): DropTarget {
  const self = windows.find((w) => w.windowId === selfId);
  if (self !== undefined && contains(self.bounds, cursor)) return { kind: 'self' };
  const other = windows.find((w) => w.windowId !== selfId && contains(w.bounds, cursor));
  if (other !== undefined) return { kind: 'window', windowId: other.windowId };
  return { kind: 'outside' };
}
