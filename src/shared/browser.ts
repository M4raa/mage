// Contrato del navegador de Mage entre main y el panel (F11b.3). La página navegada no ve nada de esto: no tiene preload.
import type { ImageAttachment } from './ipc';

export type BrowserControl = 'idle' | 'agent' | 'user';
export type BrowserAgentAction = 'navigate' | 'screenshot' | 'read_dom' | 'click' | 'type' | 'back' | 'close';

export interface BrowserEntryState {
  readonly sessionId: string;
  readonly url: string;
  readonly title: string;
  readonly canGoBack: boolean;
  readonly loading: boolean;
  readonly control: BrowserControl;
  readonly lastAction: BrowserAgentAction | null;
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
