// Dibujo de la captura anotada (I2) sobre el mapa de bits de Chromium. Puro: sin Electron. Los colores tienen
// R = B a propósito: el orden de canales de `toBitmap` (BGRA) no se ha medido y así da igual.
import { z } from 'zod';
import type { DomElement } from './elementRegistry';

export const MAX_IMAGE_SIDE_PX = 1568;
export const MAX_STROKES = 50;
export const MAX_STROKE_POINTS = 2000;
export const MAX_STROKE_COORDINATE_DIP = 20_000;

/** Mapa de bits de 4 bytes por píxel. */
export interface Bitmap {
  readonly data: Buffer;
  readonly width: number;
  readonly height: number;
}

export type StrokeKind = 'pen' | 'box' | 'arrow';
export type PointDip = readonly [number, number];

export interface Stroke {
  readonly id: number;
  readonly kind: StrokeKind;
  readonly pointsDip: readonly PointDip[];
}

export interface AnnotationInput {
  readonly elements: readonly DomElement[];
  readonly strokes: readonly Stroke[];
  readonly pxPerDip: number;
}

// El mismo valor va a R y a B: así no se puede escribir un color asimétrico.
type SymmetricColor = { readonly rb: number; readonly g: number };

const ELEMENT_COLOR: SymmetricColor = { rb: 255, g: 0 };
const DIGIT_COLOR: SymmetricColor = { rb: 255, g: 255 };
const STROKE_COLOR: SymmetricColor = { rb: 0, g: 200 };
const ELEMENT_BORDER_PX = 2;
const STROKE_PX = 3;
const GLYPH_SCALE = 3;
const GLYPH_GAP_COLUMNS = 1;
const LABEL_PADDING_PX = 2;
const ARROW_HEAD_PX = 12;
const ARROW_HEAD_DEGREES = 30;
const OPAQUE = 255;
const BYTES_PER_PIXEL = 4;
const GLYPH_COLUMNS = 3;
const GLYPH_ROWS = 5;
const DEGREES_PER_HALF_TURN = 180;
const MIN_BOX_ARROW_POINTS = 2;

const DIGIT_GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
};

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface PxPoint {
  readonly x: number;
  readonly y: number;
}

/** Reduce el tamaño para que el lado mayor no pase de `maxSide`; nunca amplía. */
export function fitWithin(width: number, height: number, maxSide = MAX_IMAGE_SIDE_PX): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Tamaño de imagen no válido: ${width}x${height}`);
  }
  const longSide = Math.max(width, height);
  if (longSide <= maxSide) return { width, height };
  const ratio = maxSide / longSide;
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}

function setPixel(bitmap: Bitmap, x: number, y: number, color: SymmetricColor): void {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return;
  const index = (y * bitmap.width + x) * BYTES_PER_PIXEL;
  bitmap.data[index] = color.rb;
  bitmap.data[index + 1] = color.g;
  bitmap.data[index + 2] = color.rb;
  bitmap.data[index + 3] = OPAQUE;
}

function fillRect(bitmap: Bitmap, rect: Rect, color: SymmetricColor): void {
  const xEnd = Math.min(bitmap.width, rect.x + rect.width);
  const yEnd = Math.min(bitmap.height, rect.y + rect.height);
  for (let y = Math.max(0, rect.y); y < yEnd; y++) {
    for (let x = Math.max(0, rect.x); x < xEnd; x++) setPixel(bitmap, x, y, color);
  }
}

// Borde de `thickness` px hacia dentro del rectángulo.
function strokeRect(bitmap: Bitmap, rect: Rect, thickness: number, color: SymmetricColor): void {
  const { x, y, width, height } = rect;
  fillRect(bitmap, { x, y, width, height: thickness }, color);
  fillRect(bitmap, { x, y: y + height - thickness, width, height: thickness }, color);
  fillRect(bitmap, { x, y, width: thickness, height }, color);
  fillRect(bitmap, { x: x + width - thickness, y, width: thickness, height }, color);
}

// Bresenham con un pincel cuadrado de STROKE_PX centrado en cada punto de la línea.
function drawLine(bitmap: Bitmap, from: PxPoint, to: PxPoint): void {
  const half = Math.floor(STROKE_PX / 2);
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const stepX = from.x < to.x ? 1 : -1;
  const stepY = from.y < to.y ? 1 : -1;
  let error = dx + dy;
  let { x, y } = from;
  for (;;) {
    fillRect(bitmap, { x: x - half, y: y - half, width: STROKE_PX, height: STROKE_PX }, STROKE_COLOR);
    if (x === to.x && y === to.y) return;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }
}

function toPx(point: PointDip, pxPerDip: number): PxPoint {
  return { x: Math.round(point[0] * pxPerDip), y: Math.round(point[1] * pxPerDip) };
}

function clampToBitmap(bitmap: Bitmap, point: PxPoint): PxPoint {
  return {
    x: Math.max(0, Math.min(point.x, bitmap.width - 1)),
    y: Math.max(0, Math.min(point.y, bitmap.height - 1)),
  };
}

function drawArrow(bitmap: Bitmap, from: PxPoint, to: PxPoint): void {
  drawLine(bitmap, from, to);
  const backwards = Math.atan2(from.y - to.y, from.x - to.x);
  const spread = (ARROW_HEAD_DEGREES * Math.PI) / DEGREES_PER_HALF_TURN;
  for (const angle of [backwards - spread, backwards + spread]) {
    const tip = {
      x: Math.round(to.x + ARROW_HEAD_PX * Math.cos(angle)),
      y: Math.round(to.y + ARROW_HEAD_PX * Math.sin(angle)),
    };
    drawLine(bitmap, to, tip);
  }
}

function drawBox(bitmap: Bitmap, a: PxPoint, b: PxPoint): void {
  const corners: PxPoint[] = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
  corners.forEach((corner, index) => drawLine(bitmap, corner, corners[(index + 1) % corners.length] as PxPoint));
}

function drawStroke(bitmap: Bitmap, stroke: Stroke, pxPerDip: number): void {
  // Recortado a la imagen: una línea nunca recorre más que la diagonal.
  const points = stroke.pointsDip.map((point) => clampToBitmap(bitmap, toPx(point, pxPerDip)));
  const [first, second] = points;
  if (first === undefined) return;
  if (stroke.kind === 'pen') {
    if (points.length === 1) drawLine(bitmap, first, first);
    points.slice(1).forEach((point, index) => drawLine(bitmap, points[index] as PxPoint, point));
    return;
  }
  if (second === undefined) return;
  if (stroke.kind === 'box') drawBox(bitmap, first, second);
  else drawArrow(bitmap, first, second);
}

function drawLabel(bitmap: Bitmap, element: DomElement, pxPerDip: number): void {
  const digits = String(element.id);
  const labelWidth =
    digits.length * GLYPH_COLUMNS * GLYPH_SCALE + (digits.length - 1) * GLYPH_GAP_COLUMNS * GLYPH_SCALE + 2 * LABEL_PADDING_PX;
  const labelHeight = GLYPH_ROWS * GLYPH_SCALE + 2 * LABEL_PADDING_PX;
  const corner = toPx([element.rectDip[0], element.rectDip[1]], pxPerDip);
  const x = Math.max(0, Math.min(corner.x, bitmap.width - labelWidth));
  const y = Math.max(0, Math.min(corner.y, bitmap.height - labelHeight));
  fillRect(bitmap, { x, y, width: labelWidth, height: labelHeight }, ELEMENT_COLOR);
  const advance = (GLYPH_COLUMNS + GLYPH_GAP_COLUMNS) * GLYPH_SCALE;
  [...digits].forEach((digit, index) => {
    drawGlyph(bitmap, digit, { x: x + LABEL_PADDING_PX + index * advance, y: y + LABEL_PADDING_PX });
  });
}

function drawGlyph(bitmap: Bitmap, digit: string, origin: PxPoint): void {
  const rows = DIGIT_GLYPHS[digit];
  if (rows === undefined) throw new Error(`No hay glifo para el dígito: ${digit}`);
  rows.forEach((row, rowIndex) => {
    [...row].forEach((cell, columnIndex) => {
      if (cell !== '1') return;
      const square = { x: origin.x + columnIndex * GLYPH_SCALE, y: origin.y + rowIndex * GLYPH_SCALE, width: GLYPH_SCALE, height: GLYPH_SCALE };
      fillRect(bitmap, square, DIGIT_COLOR);
    });
  });
}

function drawElementBorder(bitmap: Bitmap, element: DomElement, pxPerDip: number): void {
  const [x, y, width, height] = element.rectDip;
  const rect = { x: Math.round(x * pxPerDip), y: Math.round(y * pxPerDip), width: Math.round(width * pxPerDip), height: Math.round(height * pxPerDip) };
  strokeRect(bitmap, rect, ELEMENT_BORDER_PX, ELEMENT_COLOR);
}

/** Dibuja bordes, trazos y etiquetas sobre `bitmap.data` (lo muta). */
export function annotateBitmap(bitmap: Bitmap, input: AnnotationInput): void {
  const expected = bitmap.width * bitmap.height * BYTES_PER_PIXEL;
  if (bitmap.data.length !== expected) {
    throw new Error(`El mapa de bits no cuadra: ${bitmap.data.length} bytes para ${bitmap.width}x${bitmap.height} (esperados ${expected})`);
  }
  const { pxPerDip } = input;
  if (!Number.isFinite(pxPerDip) || pxPerDip <= 0) {
    throw new Error(`pxPerDip no válido: ${pxPerDip}`);
  }
  for (const element of input.elements) drawElementBorder(bitmap, element, pxPerDip);
  for (const stroke of input.strokes) drawStroke(bitmap, stroke, pxPerDip);
  for (const element of input.elements) drawLabel(bitmap, element, pxPerDip);
}

const coordinateSchema = z.number().finite().min(0).max(MAX_STROKE_COORDINATE_DIP);
const pointSchema = z.tuple([coordinateSchema, coordinateSchema]);

const strokeSchema = z
  .object({
    id: z.number().int().min(1),
    kind: z.enum(['pen', 'box', 'arrow']),
    pointsDip: z.array(pointSchema).min(MIN_BOX_ARROW_POINTS).max(MAX_STROKE_POINTS),
  })
  .strict()
  .superRefine((stroke, context) => {
    if (stroke.kind !== 'pen' && stroke.pointsDip.length !== MIN_BOX_ARROW_POINTS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${stroke.kind} necesita exactamente ${MIN_BOX_ARROW_POINTS} puntos y trae ${stroke.pointsDip.length}`,
        path: ['pointsDip'],
      });
    }
  });

const strokesSchema = z.array(strokeSchema).max(MAX_STROKES);

/** Valida los trazos que llegan del renderer (frontera). */
export function parseStrokes(raw: unknown): Stroke[] {
  const result = strokesSchema.safeParse(raw);
  if (!result.success) throw new Error(`Trazos de la pluma no válidos: ${result.error.message}`);
  return result.data;
}

/** Una línea por elemento: `id: rol "nombre" (x,y,w,h)` en DIP. */
export function formatElementList(elements: readonly DomElement[]): string {
  return elements
    .map((element) => {
      const name = element.name.replace(/\r?\n/g, ' ').replace(/"/g, "'");
      const [x, y, width, height] = element.rectDip.map(Math.round);
      return `${element.id}: ${element.role} "${name}" (${x},${y},${width},${height})`;
    })
    .join('\n');
}

/** Una línea por trazo con la caja que envuelve sus puntos. */
export function formatStrokeList(strokes: readonly Stroke[]): string {
  return strokes
    .map((stroke) => {
      const xs = stroke.pointsDip.map((point) => point[0]);
      const ys = stroke.pointsDip.map((point) => point[1]);
      const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
      const [width, height] = [Math.max(...xs) - minX, Math.max(...ys) - minY];
      return `${stroke.id}: ${stroke.kind} (${Math.round(minX)},${Math.round(minY)},${Math.round(width)},${Math.round(height)})`;
    })
    .join('\n');
}
