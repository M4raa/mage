// Conversión entre píxeles físicos (la captura de capturePage) y DIP (coordenadas del DOM y del CDP).

// La escala se redondea a 2 decimales (1, 1,25, 1,5…) para que un ancho físico redondeado no dé 1,2492.
const SCALE_ROUNDING = 100;

/** Deduce la escala de dispositivo a partir de un ancho medido en píxeles físicos y en DIP. */
export function deriveDeviceScale(widthPx: number, widthDip: number): number {
  if (!Number.isInteger(widthPx) || widthPx <= 0 || !Number.isFinite(widthDip) || widthDip <= 0) {
    throw new Error(`Ancho no válido para calcular la escala: ${widthPx} px / ${widthDip} DIP`);
  }
  return Math.round((widthPx / widthDip) * SCALE_ROUNDING) / SCALE_ROUNDING;
}

function assertScale(scale: number): void {
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error(`Escala no válida: ${scale}`);
  }
}

/** Pasa una coordenada DIP a píxeles físicos. */
export function dipToPhysical(dip: number, scale: number): number {
  assertScale(scale);
  if (!Number.isFinite(dip)) {
    throw new Error(`Coordenada DIP no válida: ${dip}`);
  }
  return Math.round(dip * scale);
}

/** Pasa una coordenada en píxeles físicos a DIP. */
export function physicalToDip(px: number, scale: number): number {
  assertScale(scale);
  if (!Number.isFinite(px)) {
    throw new Error(`Coordenada física no válida: ${px}`);
  }
  return Math.round(px / scale);
}
