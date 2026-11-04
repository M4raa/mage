// Lógica pura del panel del navegador (D-S7): qué vista toca, el hueco en coordenadas de la ventana y cuándo revelar el panel.
import type { BrowserBounds, BrowserEntryState } from '@shared/browser';

export type BrowserPanelView =
  | { readonly kind: 'noSession' }
  | { readonly kind: 'closed'; readonly sessionId: string }
  | { readonly kind: 'open'; readonly state: BrowserEntryState };

export type BrowserStates = Readonly<Record<string, BrowserEntryState>>;

export interface ClientRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function browserPanelViewOf(sessionId: string | undefined, states: BrowserStates): BrowserPanelView {
  if (sessionId === undefined || sessionId === '') return { kind: 'noSession' };
  const state = states[sessionId];
  if (state === undefined) return { kind: 'closed', sessionId };
  return { kind: 'open', state };
}

export function indexStates(list: readonly BrowserEntryState[]): BrowserStates {
  return Object.fromEntries(list.map((state) => [state.sessionId, state]));
}

const toWindowPx = (value: number, zoomFactor: number): number => Math.max(0, Math.round(value * zoomFactor));

// El hueco se mide en px CSS del renderer; la vista nativa se coloca en DIP de la ventana (D-S3).
export function toWindowBounds(rect: ClientRect, zoomFactor: number): BrowserBounds {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    throw new Error(`Factor de zoom inválido para colocar el navegador: ${zoomFactor}`);
  }
  return {
    x: toWindowPx(rect.left, zoomFactor),
    y: toWindowPx(rect.top, zoomFactor),
    width: toWindowPx(rect.width, zoomFactor),
    height: toWindowPx(rect.height, zoomFactor),
  };
}

export function sameBounds(a: BrowserBounds | null, b: BrowserBounds | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

// Se revela cuando el agente EMPIEZA a controlar el navegador de la sesión de la pestaña activa.
export function shouldRevealBrowser(previous: BrowserStates, next: BrowserStates, activeSessionId: string | undefined): boolean {
  if (activeSessionId === undefined) return false;
  if (next[activeSessionId]?.control !== 'agent') return false;
  return previous[activeSessionId]?.control !== 'agent';
}
