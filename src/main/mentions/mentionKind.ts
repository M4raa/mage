import { ALLOWED_IMAGE_TYPES } from '@shared/attachments';
import type { MentionKind } from '@shared/mentions';

// Cuantos bytes del principio se miran para decidir si un fichero sin extension conocida es texto.
export const SNIFF_BYTES = 8000;

const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'odt', 'ods', 'odp', 'zip', 'exe', 'dll', 'so', 'dylib', 'bin',
  'woff', 'woff2', 'ttf', 'otf', 'ico', 'mp3', 'mp4', 'wav', 'mov',
]);

const BINARY_MIME = 'application/octet-stream';

export interface MentionClass {
  readonly kind: MentionKind;
  readonly mime: string;
}

// Clasifica por extension (sin distinguir mayusculas) y, si no la conoce, por si la cabecera tiene bytes 0.
export function classifyMention(relPath: string, head: Uint8Array): MentionClass {
  const dot = relPath.lastIndexOf('.');
  const extension = dot < 0 ? '' : relPath.slice(dot + 1).toLowerCase();
  const imageMime = IMAGE_MIME_BY_EXTENSION[extension];
  if (imageMime !== undefined && ALLOWED_IMAGE_TYPES.has(imageMime)) return { kind: 'image', mime: imageMime };
  if (extension === 'pdf') return { kind: 'pdf', mime: 'application/pdf' };
  if (BINARY_EXTENSIONS.has(extension)) return { kind: 'binary', mime: BINARY_MIME };
  const sniffed = head.subarray(0, SNIFF_BYTES);
  return sniffed.includes(0) ? { kind: 'binary', mime: BINARY_MIME } : { kind: 'text', mime: 'text/plain' };
}
