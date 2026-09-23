import type { ImageAttachment } from './ipc';

// Validacion de los adjuntos del prompt (2.12.1), EN LA FRONTERA. Adjuntar es una funcion de ENVIO: un
// adjunto que se cae en silencio es peor que un error, porque el usuario cree que mando algo que no
// mando. Por eso todo lanza `Error` con el valor recibido en el mensaje y no hay ningun default.
//
// PURO y COMPARTIDO (vive en `shared` justamente por esto): lo usa el renderer para dar el error bonito
// y `main` porque es la frontera de verdad — el renderer valida por cortesia, main valida porque es lo
// que le llega por IPC.

// Los mismos cuatro que Mage sabe PINTAR (`SUPPORTED_IMAGE_MEDIA_TYPES`): aceptar en el envio algo que
// luego no se puede mostrar seria incoherente.
export const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

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

export function validateAttachment(candidate: AttachmentCandidate): ImageAttachmentMeta {
  const mediaType = candidate.mediaType.trim().toLowerCase();
  if (!ALLOWED_IMAGE_TYPES.has(mediaType)) {
    throw new Error(
      `Tipo de imagen no admitido: ${JSON.stringify(candidate.mediaType)}. Admitidos: ${[...ALLOWED_IMAGE_TYPES].join(', ')}`,
    );
  }
  if (!Number.isInteger(candidate.byteLength) || candidate.byteLength <= 0) {
    throw new Error(`Tamaño de imagen invalido: ${candidate.byteLength}`);
  }
  if (candidate.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`La imagen ocupa ${formatBytes(candidate.byteLength)} y el maximo es ${formatBytes(MAX_ATTACHMENT_BYTES)}`);
  }
  return { mediaType: mediaType as ImageAttachment['mediaType'], byteLength: candidate.byteLength };
}

// Valida un lote NUEVO contra lo que ya hay adjunto: el numero y el peso total son del conjunto, no de
// cada imagen. Devuelve el conjunto RESULTANTE (existentes + nuevos) para que el llamante lo use tal
// cual, sin recomponerlo y arriesgarse a perder la validacion por el camino.
export function validateAttachmentSet(
  existing: readonly ImageAttachmentMeta[],
  incoming: readonly AttachmentCandidate[],
): readonly ImageAttachmentMeta[] {
  const validated = incoming.map(validateAttachment);
  const all = [...existing, ...validated];
  if (all.length > MAX_ATTACHMENTS) {
    throw new Error(`No se pueden adjuntar mas de ${MAX_ATTACHMENTS} imagenes (intentabas dejar ${all.length})`);
  }
  const total = all.reduce((sum, attachment) => sum + attachment.byteLength, 0);
  if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new Error(`Los adjuntos suman ${formatBytes(total)} y el maximo por mensaje es ${formatBytes(MAX_TOTAL_ATTACHMENT_BYTES)}`);
  }
  return all;
}

// Bytes REALES de un base64. Hace falta porque por IPC viaja la cadena, no el fichero: usar
// `data.length` como tamaño rechazaria imagenes validas (base64 abulta ~4/3) y colaria otras.
export function base64ByteLength(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB` : `${Math.round(bytes / 1024)} KiB`;
}
