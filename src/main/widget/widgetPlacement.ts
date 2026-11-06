// Colocación PURA del widget flotante (sin `electron`): esquina, encaje en pantalla y tolerancia.
import type { Rect } from '../windows/windowBounds';

export interface Size { readonly width: number; readonly height: number }
export const WIDGET_SIZES = { compact: { width: 232, height: 52 }, expanded: { width: 320, height: 460 } } as const satisfies Record<'compact' | 'expanded', Size>;
export const WIDGET_SCREEN_MARGIN = 24;
// Redondeo medido de setBounds a 125 % y 150 %: +1/+2 px. Por debajo, no se recoloca.
export const WIDGET_BOUNDS_TOLERANCE_PX = 2;

// Esquina superior derecha del área de trabajo, con margen.
export function topRightOf(workArea: Rect, size: Size, margin: number): Rect {
  return { x: workArea.x + workArea.width - size.width - margin, y: workArea.y + margin, width: size.width, height: size.height };
}

// Encaja `bounds` dentro del área de trabajo (encogiéndolo si no cabe).
export function clampInto(bounds: Rect, workArea: Rect): Rect {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height);
  return { x, y, width, height };
}

// Cambia de tamaño conservando el borde derecho y el superior, y encaja en el área.
export function resizeAnchored(bounds: Rect, size: Size, workArea: Rect): Rect {
  return clampInto({ x: bounds.x + bounds.width - size.width, y: bounds.y, width: size.width, height: size.height }, workArea);
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

// Área de trabajo con mayor intersección con `bounds`; null si no hay ninguna (empate: la primera).
export function pickWorkArea(bounds: Rect, workAreas: readonly Rect[]): Rect | null {
  let best: Rect | null = null;
  let bestArea = 0;
  for (const area of workAreas) {
    const overlap = overlapArea(bounds, area);
    if (overlap > bestArea) {
      best = area;
      bestArea = overlap;
    }
  }
  return best;
}

// Recoloca tras un cambio de pantallas: encaja en la que lo contiene o, si no hay, a la esquina de la principal.
export function relocate(bounds: Rect, workAreas: readonly Rect[], primary: Rect, margin: number): Rect {
  const area = pickWorkArea(bounds, workAreas);
  if (area === null) return topRightOf(primary, { width: bounds.width, height: bounds.height }, margin);
  return clampInto(bounds, area);
}

// Iguales dentro de la tolerancia (el redondeo de setBounds no debe provocar recolocaciones).
export function sameBounds(a: Rect, b: Rect, tolerance: number = WIDGET_BOUNDS_TOLERANCE_PX): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance
  );
}
