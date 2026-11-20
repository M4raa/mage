// Contrato del navegador de Mage entre main y el panel (F11b.3). La página navegada no ve nada de esto: no tiene preload.
import type { ImageAttachment } from './ipc';

export type BrowserControl = 'idle' | 'agent' | 'user';
export type BrowserAgentAction = 'navigate' | 'screenshot' | 'read_dom' | 'click' | 'type' | 'back' | 'close';

export interface BrowserEntryState {
  readonly sessionId: string;
  readonly url: string;
  readonly title: string;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly loading: boolean;
  // El de la página (Chromium), en %; no el de la interfaz de Mage.
  readonly zoomPercent: number;
  readonly control: BrowserControl;
  readonly lastAction: BrowserAgentAction | null;
}

// -1 aleja, 0 vuelve a 100 %, 1 acerca.
export type BrowserZoomStep = -1 | 0 | 1;

export interface BrowserZoomKey {
  readonly key: string;
  readonly control: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
}

const ZOOM_KEYS: ReadonlyMap<string, BrowserZoomStep> = new Map<string, BrowserZoomStep>([['+', 1], ['=', 1], ['-', -1], ['0', 0]]);

// Ctrl/Cmd + `+`, `-` o `0` cambian el zoom del navegador. Lo usan la barra del panel (renderer) y la propia página
// (main, `before-input-event`): con Alt no, para no comerse combinaciones del teclado (AltGr = Ctrl+Alt en Windows).
export function zoomStepForKey(input: BrowserZoomKey): BrowserZoomStep | null {
  if (!(input.control || input.meta) || input.alt) return null;
  return ZOOM_KEYS.get(input.key) ?? null;
}

// DIP de la ventana.
export interface BrowserBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type BrowserPenStrokeKind = 'pen' | 'box' | 'arrow';

export interface BrowserPenStroke {
  readonly id: number;
  readonly kind: BrowserPenStrokeKind;
  readonly pointsDip: readonly (readonly [number, number])[];
}

export interface BrowserPenElement {
  readonly id: number;
  readonly role: string;
  readonly name: string;
  readonly rectDip: readonly [number, number, number, number];
}

export interface BrowserPenCapture {
  readonly captureId: string;
  readonly image: { readonly mime: 'image/png'; readonly base64: string; readonly widthPx: number; readonly heightPx: number };
  readonly widthDip: number;
  readonly heightDip: number;
  readonly url: string;
  readonly elements: readonly BrowserPenElement[];
}

export interface BrowserPenResult {
  readonly attachment: ImageAttachment;
  readonly elementsText: string;
  readonly strokesText: string;
  readonly url: string;
}

export const BROWSER_STATE_CHANNEL = 'browser:state';
