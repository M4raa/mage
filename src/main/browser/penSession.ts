// La pluma (D-S6): captura LIMPIA + lectura del DOM para que el usuario dibuje, y composición de la imagen anotada (I2)
// con sus trazos. Una captura por sesión y de un solo uso.
import type { BrowserPenCapture, BrowserPenResult } from '@shared/browser';
import { composeCapture, type ImageDeps, type RawCapture } from './annotatedCapture';
import { BrowserControlError, type BrowserRegistry } from './browserRegistry';
import { formatElementList, formatStrokeList, type Stroke } from './captureAnnotation';
import type { DomElement } from './elementRegistry';

export class PenCaptureExpiredError extends Error {
  constructor(captureId: string) {
    super(`La captura de la pluma ${captureId} ya no está disponible`);
    this.name = 'PenCaptureExpiredError';
  }
}

export interface PenSessionsDeps {
  readonly registry: Pick<BrowserRegistry, 'get'>;
  readonly imageDeps: ImageDeps;
  readonly newId: () => string;
}

interface StoredCapture {
  readonly captureId: string;
  readonly raw: RawCapture;
  readonly elements: readonly DomElement[];
}

export class PenSessions {
  private readonly captures = new Map<string, StoredCapture>();

  constructor(private readonly deps: PenSessionsDeps) {}

  async capture(sessionId: string): Promise<BrowserPenCapture> {
    const handle = this.deps.registry.get(sessionId);
    if (handle === null) {
      throw new BrowserControlError('browser_not_open', `No hay navegador abierto en la sesión ${sessionId}`);
    }
    // Primero la lectura: los id numerados que verá el usuario son los de esta lectura.
    const elements = await handle.readDom({});
    const raw = await handle.captureRaw();
    const clean = composeCapture(raw, { elements: [], strokes: [] }, this.deps.imageDeps);
    const captureId = this.deps.newId();
    this.captures.set(sessionId, { captureId, raw, elements });
    const { mime, base64, widthPx, heightPx } = clean.image;
    return {
      captureId,
      image: { mime, base64, widthPx, heightPx },
      widthDip: raw.widthDip,
      heightDip: raw.heightDip,
      url: raw.url,
      elements,
    };
  }

  compose(sessionId: string, captureId: string, strokes: readonly Stroke[]): BrowserPenResult {
    const stored = this.captures.get(sessionId);
    if (stored === undefined || stored.captureId !== captureId) throw new PenCaptureExpiredError(captureId);
    // De un solo uso: se borra antes de componer, así un fallo al componer tampoco deja la captura viva.
    this.captures.delete(sessionId);
    const { raw, elements } = stored;
    const composed = composeCapture(raw, { elements, strokes }, this.deps.imageDeps);
    return {
      attachment: { mediaType: 'image/png', data: composed.image.base64 },
      elementsText: formatElementList(elements),
      strokesText: formatStrokeList(strokes),
      url: raw.url,
    };
  }

  discard(sessionId: string): void {
    this.captures.delete(sessionId);
  }
}
