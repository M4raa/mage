import type { ImageAttachment } from '@shared/ipc';
import { isDocument } from '@shared/imageRefs';
import { t } from '../i18n/uiLanguage';

// Copiar un mensaje del usuario con imágenes (0.1.4): el texto y la PRIMERA imagen, en un solo elemento del portapapeles.
// El portapapeles de Chromium solo admite `image/png` como imagen al escribir: otro formato se redibuja a PNG.

export interface ClipboardDeps {
  readonly clipboard: Pick<Clipboard, 'write' | 'writeText'>;
  readonly makeItem: (items: Record<string, Blob>) => ClipboardItem;
  readonly toPng: (image: ImageAttachment) => Promise<Blob>;
}

// Núcleo puro (portapapeles inyectado): el mensaje de error, o null si copió.
export async function copyTextAndImage(deps: ClipboardDeps, content: { readonly text: string; readonly image: ImageAttachment | null }): Promise<string | null> {
  try {
    if (content.image === null) {
      await deps.clipboard.writeText(content.text);
      return null;
    }
    const png = await deps.toPng(content.image);
    await deps.clipboard.write([deps.makeItem({ 'text/plain': new Blob([content.text], { type: 'text/plain' }), 'image/png': png })]);
    return null;
  } catch (err) {
    return t('chat.copy.failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function firstImageOf(attachments: readonly ImageAttachment[]): ImageAttachment | null {
  return attachments.find((attachment) => !isDocument(attachment)) ?? null;
}

export function base64ToBlob(data: string, mediaType: string): Blob {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mediaType });
}

// PNG tal cual; cualquier otro formato de imagen se redibuja a PNG.
export async function imageAttachmentToPng(image: ImageAttachment): Promise<Blob> {
  const blob = base64ToBlob(image.data, image.mediaType);
  if (image.mediaType === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error(`Sin contexto 2D para convertir ${image.mediaType} a PNG`);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: 'image/png' });
}

export const BROWSER_CLIPBOARD: () => ClipboardDeps = () => ({
  clipboard: navigator.clipboard,
  makeItem: (items) => new ClipboardItem(items),
  toPng: imageAttachmentToPng,
});
