// Edición pura de los trazos de la pluma: el trazo en curso es siempre el último de la lista (D-S6).
import type { BrowserPenStroke, BrowserPenStrokeKind } from '@shared/browser';

export type StrokePoint = readonly [number, number];

const MIN_POINTS = 2;

export function beginStroke(strokes: readonly BrowserPenStroke[], kind: BrowserPenStrokeKind, point: StrokePoint): readonly BrowserPenStroke[] {
  const id = (strokes[strokes.length - 1]?.id ?? 0) + 1;
  return [...strokes, { id, kind, pointsDip: [point] }];
}

// `pen` añade puntos; `box` y `arrow` solo conservan la esquina inicial y la actual.
export function extendStroke(strokes: readonly BrowserPenStroke[], point: StrokePoint): readonly BrowserPenStroke[] {
  const active = strokes[strokes.length - 1];
  const start = active?.pointsDip[0];
  if (active === undefined || start === undefined) return strokes;
  const pointsDip = active.kind === 'pen' ? [...active.pointsDip, point] : [start, point];
  return [...strokes.slice(0, -1), { ...active, pointsDip }];
}

// Un trazo de un solo punto (un clic sin arrastrar) se descarta.
export function endStroke(strokes: readonly BrowserPenStroke[]): readonly BrowserPenStroke[] {
  const active = strokes[strokes.length - 1];
  if (active === undefined || active.pointsDip.length >= MIN_POINTS) return strokes;
  return strokes.slice(0, -1);
}

export function undoStroke(strokes: readonly BrowserPenStroke[]): readonly BrowserPenStroke[] {
  return strokes.slice(0, -1);
}
