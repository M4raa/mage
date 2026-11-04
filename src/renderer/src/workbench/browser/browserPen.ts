// Lógica pura de la pluma (D-S6): coordenadas, texto de la captura y su sitio en el borrador (una imagen de pluma por turno).
import type { BrowserPenResult } from '@shared/browser';
import { base64ByteLength, validateAttachmentSet, type ImageAttachmentMeta } from '@shared/attachments';
import type { ImageAttachment } from '@shared/ipc';
import type { Translate } from '../../i18n/uiLanguage';
import type { PendingAttachment, PromptDraft } from '../types';

export interface PenMemory {
  readonly data: string;
  readonly caption: string;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

const DECIMAL_SCALE = 10;
const PARAGRAPH_BREAK = '\n\n';
const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);
const roundToTenth = (value: number): number => Math.round(value * DECIMAL_SCALE) / DECIMAL_SCALE;

// Pasa un punto de la imagen mostrada (px CSS) a DIP de la página.
export function displayToDip(point: { readonly x: number; readonly y: number }, displayed: Size, dip: Size): readonly [number, number] {
  if (displayed.width <= 0 || displayed.height <= 0) {
    throw new Error(`Tamaño mostrado inválido para la pluma: ${displayed.width}x${displayed.height}`);
  }
  const x = clamp((point.x * dip.width) / displayed.width, dip.width);
  const y = clamp((point.y * dip.height) / displayed.height, dip.height);
  return [roundToTenth(x), roundToTenth(y)];
}

export function penCaption(translate: Translate, result: BrowserPenResult): string {
  const elements =
    result.elementsText === ''
      ? translate('chat.browser.penCaptionNoElements')
      : translate('chat.browser.penCaptionElements', { list: result.elementsText });
  const strokes = result.strokesText === '' ? '' : translate('chat.browser.penCaptionStrokes', { list: result.strokesText });
  return [translate('chat.browser.penCaptionHeader', { url: result.url }), elements, strokes].filter((line) => line !== '').join('\n');
}

const metaOf = (pending: PendingAttachment): ImageAttachmentMeta => ({
  mediaType: pending.attachment.mediaType,
  byteLength: pending.byteLength,
});

function withoutCaption(text: string, caption: string): string {
  const at = text.indexOf(caption);
  if (at < 0) return text;
  return text.slice(0, at) + text.slice(at + caption.length);
}

export function replacePenInDraft(
  draft: PromptDraft,
  previous: PenMemory | null,
  next: { readonly attachment: ImageAttachment; readonly caption: string },
  formatLocale: string,
): PromptDraft {
  const kept = previous === null ? draft.attachments : draft.attachments.filter((pending) => pending.attachment.data !== previous.data);
  const keptText = (previous === null ? draft.text : withoutCaption(draft.text, previous.caption)).trimEnd();
  const byteLength = base64ByteLength(next.attachment.data);
  validateAttachmentSet(kept.map(metaOf), [{ mediaType: next.attachment.mediaType, byteLength }], formatLocale);
  const text = keptText === '' ? next.caption : `${keptText}${PARAGRAPH_BREAK}${next.caption}`;
  return { ...draft, text, attachments: [...kept, { attachment: next.attachment, byteLength }] };
}
