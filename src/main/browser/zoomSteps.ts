// Zoom del navegador de Mage: uno por navegador (el `webContents` de su vista), nunca el de la interfaz de Mage.
// Los pasos son los de Chromium; el actual lo guarda Chromium y aquí solo se decide el siguiente.
import type { BrowserZoomStep } from '@shared/browser';

export const ZOOM_STEPS_PERCENT = [50, 67, 80, 90, 100, 110, 125, 150, 175, 200] as const;
export const DEFAULT_ZOOM_PERCENT = 100;

export type ZoomStep = BrowserZoomStep;

const MIN_ZOOM_PERCENT = Math.min(...ZOOM_STEPS_PERCENT);
const MAX_ZOOM_PERCENT = Math.max(...ZOOM_STEPS_PERCENT);

// 0 vuelve a 100 %; ±1 va al paso siguiente o anterior de la tabla (desde un valor fuera de ella, al más cercano en
// esa dirección). En los extremos se queda.
export function nextZoom(current: number, step: ZoomStep): number {
  if (!Number.isFinite(current) || current <= 0) throw new Error(`Zoom actual del navegador no válido: ${current}`);
  if (step === 0) return DEFAULT_ZOOM_PERCENT;
  if (step === 1) return ZOOM_STEPS_PERCENT.find((percent) => percent > current) ?? MAX_ZOOM_PERCENT;
  return ZOOM_STEPS_PERCENT.findLast((percent) => percent < current) ?? MIN_ZOOM_PERCENT;
}
