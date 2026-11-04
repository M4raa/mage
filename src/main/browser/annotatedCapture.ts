// Composición de la captura anotada (I2): reduce la imagen, dibuja encima y la devuelve como PNG. Sin Electron:
// la imagen entra por interfaz (`CaptureImage`, que el `NativeImage` de Electron cumple estructuralmente).
import { annotateBitmap, fitWithin, type Stroke } from './captureAnnotation';
import { deriveDeviceScale } from './deviceScale';
import type { DomElement } from './elementRegistry';

export interface CaptureImage {
  isEmpty(): boolean;
  getSize(): { width: number; height: number };
  resize(options: { width: number; height: number; quality: 'good' }): CaptureImage;
  toBitmap(): Buffer;
  toPNG(): Buffer;
}

export interface ImageDeps {
  fromBitmap(data: Buffer, size: { width: number; height: number }): CaptureImage;
}

export interface RawCapture {
  readonly image: CaptureImage;
  readonly widthDip: number;
  readonly heightDip: number;
  readonly url: string;
  readonly capturedAt: string;
}

export interface Annotation {
  readonly elements: readonly DomElement[];
  readonly strokes: readonly Stroke[];
}

// Formato I2 (INFORME-046). `deviceScale` = px de la imagen ENTREGADA por DIP.
export interface AnnotatedCapture {
  readonly image: {
    readonly mime: 'image/png';
    readonly base64: string;
    readonly widthPx: number;
    readonly heightPx: number;
    readonly deviceScale: number;
  };
  readonly elements: readonly DomElement[];
  readonly strokes: readonly Stroke[];
  readonly url: string;
  readonly capturedAt: string;
}

function fitImage(image: CaptureImage): CaptureImage {
  const { width, height } = image.getSize();
  const target = fitWithin(width, height);
  if (target.width === width && target.height === height) return image;
  return image.resize({ ...target, quality: 'good' });
}

function drawOnImage(image: CaptureImage, raw: RawCapture, annotation: Annotation, deps: ImageDeps): CaptureImage {
  const size = image.getSize();
  const bitmap = { data: image.toBitmap(), ...size };
  annotateBitmap(bitmap, { ...annotation, pxPerDip: size.width / raw.widthDip });
  return deps.fromBitmap(bitmap.data, size);
}

/** Pasa una captura de Electron al formato I2: ≤ 1568 px de lado mayor y, si hay algo que dibujar, anotada. */
export function composeCapture(raw: RawCapture, annotation: Annotation, deps: ImageDeps): AnnotatedCapture {
  if (raw.image.isEmpty()) throw new Error(`La captura salió vacía (${raw.url})`);
  let image = fitImage(raw.image);
  if (annotation.elements.length > 0 || annotation.strokes.length > 0) {
    image = drawOnImage(image, raw, annotation, deps);
  }
  const { width, height } = image.getSize();
  return {
    image: {
      mime: 'image/png',
      base64: image.toPNG().toString('base64'),
      widthPx: width,
      heightPx: height,
      deviceScale: deriveDeviceScale(width, raw.widthDip),
    },
    elements: annotation.elements,
    strokes: annotation.strokes,
    url: raw.url,
    capturedAt: raw.capturedAt,
  };
}
