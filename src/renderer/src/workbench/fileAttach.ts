import { ALLOWED_IMAGE_TYPES } from '@shared/attachments';
import type { MentionCandidate } from '@shared/mentions';
import type { TextState } from './promptEditing';

// Adjuntar un fichero (punto 15 de P-043, D1): las imágenes siguen su camino; el resto es una mención `@ruta` (camino B4)
// si está dentro de la carpeta y el índice lo conoce. Si no, se deja su ruta para que el agente la lea con su permiso.
const WINDOWS_DRIVE = /^[a-zA-Z]:/;
const TRAILING_SLASHES = /\/+$/;
const ENDS_WITH_SPACE = /\s$/;
const toSlashes = (path: string): string => path.replaceAll('\\', '/');

export type FileMention =
  | { readonly kind: 'mention'; readonly candidate: MentionCandidate }
  | { readonly kind: 'path'; readonly absPath: string }
  | { readonly kind: 'noPath'; readonly name: string };

export interface FileMentionContext {
  readonly cwd: string;
  // Búsqueda exacta en el índice de menciones de main (`lookupCandidate`); null si no lo devuelve.
  readonly lookup: (relPath: string) => Promise<MentionCandidate | null>;
}

export function isAttachableImage(file: { readonly type: string }): boolean {
  return ALLOWED_IMAGE_TYPES.has(file.type);
}

// Ruta relativa con `/` si `absPath` cae DENTRO de `cwd` (sin mayúsculas cuando `cwd` lleva letra de unidad); si no, null.
export function relativeToCwd(cwd: string, absPath: string): string | null {
  if (cwd.length === 0 || absPath.length === 0) return null;
  const fold = WINDOWS_DRIVE.test(cwd);
  const norm = (path: string): string => (fold ? toSlashes(path).toLowerCase() : toSlashes(path));
  const prefix = `${norm(cwd).replace(TRAILING_SLASHES, '')}/`;
  const full = toSlashes(absPath);
  if (!norm(full).startsWith(prefix) || full.length === prefix.length) return null;
  return full.slice(prefix.length);
}

export const pathNoteText = (absPath: string): string => `\`${absPath}\` `;

// Inserta en el cursor (sustituye la selección) y separa con un espacio si lo de antes no acaba en uno.
export function insertAtCursor(state: TextState, insert: string): TextState {
  const before = state.value.slice(0, state.selectionStart);
  const after = state.value.slice(state.selectionEnd);
  const text = before.length > 0 && !ENDS_WITH_SPACE.test(before) ? ` ${insert}` : insert;
  const cursor = before.length + text.length;
  return { value: `${before}${text}${after}`, selectionStart: cursor, selectionEnd: cursor };
}

export async function fileMentionOf(name: string, absPath: string, ctx: FileMentionContext): Promise<FileMention> {
  if (absPath.length === 0) return { kind: 'noPath', name };
  const relPath = relativeToCwd(ctx.cwd, absPath);
  if (relPath === null) return { kind: 'path', absPath };
  const candidate = await ctx.lookup(relPath);
  return candidate === null ? { kind: 'path', absPath } : { kind: 'mention', candidate };
}
