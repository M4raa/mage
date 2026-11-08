import type { ImageAttachment } from './ipc';
import { localizeDecimalPoint } from './i18n/format';
import { localized, UserFacingError } from './i18n/localizedText';

// Locale de las cifras cuando quien valida no conoce el de la interfaz (validación de defensa en main: el renderer ya validó antes).
export const ERROR_FORMAT_LOCALE = 'es-ES';

// Validacion de los adjuntos del prompt (2.12.1), EN LA FRONTERA. Adjuntar es una funcion de ENVIO: un
// adjunto que se cae en silencio es peor que un error, porque el usuario cree que mando algo que no
// mando. Por eso todo lanza `Error` (`UserFacingError`) con el valor recibido en el mensaje y no hay ningun default.
//
// PURO y COMPARTIDO (vive en `shared` justamente por esto): lo usa el renderer para dar el error bonito
// y `main` porque es la frontera de verdad — el renderer valida por cortesia, main valida porque es lo
// que le llega por IPC.

// Los mismos cuatro que Mage sabe PINTAR (`SUPPORTED_IMAGE_MEDIA_TYPES`): aceptar en el envio algo que
// luego no se puede mostrar seria incoherente.
export const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

// Documentos que viajan como adjunto (menciones @, Q05): solo PDF, y solo hacia Claude (bloque `document`).
export const ALLOWED_DOCUMENT_TYPES: ReadonlySet<string> = new Set(['application/pdf']);

// Topes. La imagen viaja en base64 por IPC, asi que 5 MiB de fichero son ~6,7 MB de string: pasarse de
// aqui no es "una imagen grande", es congelar la app al enviar.
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export interface ImageAttachmentMeta {
  readonly mediaType: ImageAttachment['mediaType'];
  readonly byteLength: number;
}

export interface AttachmentCandidate {
  readonly mediaType: string;
  readonly byteLength: number;
}

export function validateAttachment(candidate: AttachmentCandidate, formatLocale: string): ImageAttachmentMeta {
  const mediaType = candidate.mediaType.trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mediaType) && !ALLOWED_DOCUMENT_TYPES.has(mediaType)) {
    throw new UserFacingError(
      localized('errors.attachments.unsupportedType', { type: JSON.stringify(candidate.mediaType), allowed: [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOCUMENT_TYPES].join(', ') }),
    );
  }
  if (!Number.isInteger(candidate.byteLength) || candidate.byteLength <= 0) {
    throw new UserFacingError(localized('errors.attachments.invalidSize', { size: String(candidate.byteLength) }));
  }
  if (candidate.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new UserFacingError(
      localized('errors.attachments.imageTooLarge', { size: formatBytes(candidate.byteLength, formatLocale), max: formatBytes(MAX_ATTACHMENT_BYTES, formatLocale) }),
    );
  }
  return { mediaType: mediaType as ImageAttachment['mediaType'], byteLength: candidate.byteLength };
}

// Valida un lote NUEVO contra lo que ya hay adjunto: el numero y el peso total son del conjunto, no de
// cada imagen. Devuelve el conjunto RESULTANTE (existentes + nuevos) para que el llamante lo use tal
// cual, sin recomponerlo y arriesgarse a perder la validacion por el camino.
export function validateAttachmentSet(
  existing: readonly ImageAttachmentMeta[],
  incoming: readonly AttachmentCandidate[],
  formatLocale: string,
): readonly ImageAttachmentMeta[] {
  const validated = incoming.map((candidate) => validateAttachment(candidate, formatLocale));
  const all = [...existing, ...validated];
  if (all.length > MAX_ATTACHMENTS) {
    throw new UserFacingError(localized('errors.attachments.tooMany', { max: String(MAX_ATTACHMENTS), count: String(all.length) }));
  }
  const total = all.reduce((sum, attachment) => sum + attachment.byteLength, 0);
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new UserFacingError(
      localized('errors.attachments.totalTooLarge', { total: formatBytes(total, formatLocale), max: formatBytes(MAX_TOTAL_ATTACHMENT_BYTES, formatLocale) }),
    );
  }
  return all;
}

// El pegado del prompt solo adjunta imágenes: el PDF entra por mención (Q05), que decide por motor si viaja.
export function assertPastedImages(candidates: readonly AttachmentCandidate[]): void {
  const rejected = candidates.find((candidate) => !ALLOWED_IMAGE_TYPES.has(candidate.mediaType.trim().toLowerCase()));
  if (rejected === undefined) return;
  throw new UserFacingError(
    localized('errors.attachments.unsupportedType', { type: JSON.stringify(rejected.mediaType), allowed: [...ALLOWED_IMAGE_TYPES].join(', ') }),
  );
}

// Bytes REALES de un base64. Hace falta porque por IPC viaja la cadena, no el fichero: usar
// `data.length` como tamaño rechazaria imagenes validas (base64 abulta ~4/3) y colaria otras.
export function base64ByteLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

// De dónde viene una imagen del borrador: del disco (botón o soltar, con ruta) o pegada (sin fichero, sin ruta).
export type ImageSource = 'disk' | 'pasted';

// Ruta del fichero para copiar el mensaje (U51): solo las del disco; '' (el File no viene del disco) es sin ruta.
// `pathForFile` se llama solo para las del disco.
export function sourcePathOf(source: ImageSource, pathForFile: () => string): string | null {
  if (source === 'pasted') return null;
  const path = pathForFile();
  return path.length > 0 ? path : null;
}

export function formatBytes(bytes: number, locale: string): string {
  return bytes >= 1024 * 1024 ? `${localizeDecimalPoint((bytes / (1024 * 1024)).toFixed(1), locale)} MiB` : `${Math.round(bytes / 1024)} KiB`;
}
