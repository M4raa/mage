import type { ImageAttachment } from '@shared/ipc';
import type { MentionCandidate, MentionKind, MentionResolution } from '@shared/mentions';
import { planDelivery, type DeliveryPlan } from '@shared/mentionDelivery';
import { rankPaths } from '@shared/rankPaths';
import type { CreatedFile } from './createdFilesView';

// Menciones @ en el borrador (Q06). Todo puro: la caja de texto y el popover solo llaman aqui.

const WHITESPACE = /\s/;
const WINDOWS_DRIVE = /^[a-zA-Z]:/;
const TRAILING_SLASHES = /\/+$/;

export interface MentionQuery {
  readonly start: number;
  readonly query: string;
}

const isSpace = (char: string): boolean => WHITESPACE.test(char);

// Hay mencion en curso si, retrocediendo desde el cursor, se llega a un `@` sin pasar por espacio, y ese
// `@` esta al principio o va precedido de espacio (un `a@b` es un correo, no una mencion).
export function mentionQueryAt(text: string, cursor: number): MentionQuery | null {
  const end = Math.min(Math.max(cursor, 0), text.length);
  for (let i = end - 1; i >= 0; i -= 1) {
    const char = text.charAt(i);
    if (isSpace(char)) return null;
    if (char === '@') return i === 0 || isSpace(text.charAt(i - 1)) ? { start: i, query: text.slice(i + 1, end) } : null;
  }
  return null;
}

export const mentionToken = (relPath: string): string => `@${relPath}`;

// Sustituye `@query` por `@relPath ` (con espacio) y deja el cursor tras el espacio.
export function insertMention(text: string, at: MentionQuery, relPath: string): { readonly text: string; readonly cursor: number } {
  const token = `${mentionToken(relPath)} `;
  const before = text.slice(0, at.start);
  const after = text.slice(at.start + 1 + at.query.length);
  return { text: `${before}${token}${after}`, cursor: before.length + token.length };
}

// Indice del primer token `@ruta` completo: delimitado por espacio o extremo de texto por los dos lados
// (`@src/a` no es parte de `@src/ab`). -1 si no esta.
function findToken(text: string, relPath: string): number {
  const token = mentionToken(relPath);
  for (let from = text.indexOf(token); from >= 0; from = text.indexOf(token, from + 1)) {
    const endIndex = from + token.length;
    const startsOk = from === 0 || isSpace(text.charAt(from - 1));
    const endsOk = endIndex === text.length || isSpace(text.charAt(endIndex));
    if (startsOk && endsOk) return from;
  }
  return -1;
}

// Misma referencia si no cambia nada (evita un set de store por cada tecla).
export function reconcileMentions(text: string, mentions: readonly MentionCandidate[]): readonly MentionCandidate[] {
  const kept = mentions.filter((mention) => findToken(text, mention.relPath) >= 0);
  return kept.length === mentions.length ? mentions : kept;
}

// Quita el token y un espacio pegado detras si lo hay.
export function removeMentionToken(text: string, relPath: string): string {
  const from = findToken(text, relPath);
  if (from < 0) return text;
  const endIndex = from + mentionToken(relPath).length;
  const cut = text.charAt(endIndex) === ' ' ? endIndex + 1 : endIndex;
  return `${text.slice(0, from)}${text.slice(cut)}`;
}

export function addMention(mentions: readonly MentionCandidate[], candidate: MentionCandidate): readonly MentionCandidate[] {
  return mentions.some((mention) => mention.absPath === candidate.absPath) ? mentions : [...mentions, candidate];
}

const toSlashes = (path: string): string => path.replaceAll('\\', '/');

// Rutas relativas (con `/`) de los ficheros no fallidos que estan dentro de `cwd`. Sin distinguir
// mayusculas solo cuando `cwd` empieza por letra de unidad (Windows).
export function conversationMatches(files: readonly CreatedFile[], cwd: string, query: string, limit: number): readonly string[] {
  const fold = WINDOWS_DRIVE.test(cwd);
  const norm = (path: string): string => (fold ? toSlashes(path).toLowerCase() : toSlashes(path));
  const prefix = `${norm(cwd).replace(TRAILING_SLASHES, '')}/`;
  const relPaths: string[] = [];
  for (const file of files) {
    if (file.failed) continue;
    const full = toSlashes(file.path);
    if (norm(full).startsWith(prefix)) relPaths.push(full.slice(prefix.length));
  }
  return rankPaths(relPaths, query, limit);
}

export const chipDelivery = (kind: MentionKind, bytes: number, provider: string): DeliveryPlan => planDelivery(kind, bytes, provider);

export type MentionSection = 'conversation' | 'files';

// Una fila del popover. `candidate` es null para un fichero de la conversacion que el indice de main no
// devolvio: antes de mencionarlo hay que pedirle su clase y tamano (busqueda por su ruta exacta).
export interface MentionRow {
  readonly relPath: string;
  readonly section: MentionSection;
  readonly candidate: MentionCandidate | null;
}

// Primero «En esta conversacion», despues «Ficheros» sin repetir lo ya listado arriba. Indexado en `Map`.
export function mentionRows(conversationPaths: readonly string[], candidates: readonly MentionCandidate[]): readonly MentionRow[] {
  const byRelPath = new Map(candidates.map((candidate) => [candidate.relPath, candidate] as const));
  const seen = new Set(conversationPaths);
  const conversation = conversationPaths.map((relPath): MentionRow => ({ relPath, section: 'conversation', candidate: byRelPath.get(relPath) ?? null }));
  const files = candidates.filter((candidate) => !seen.has(candidate.relPath)).map((candidate): MentionRow => ({ relPath: candidate.relPath, section: 'files', candidate }));
  return [...conversation, ...files];
}

export type MentionFailure = 'missing' | 'outsideFolder';

// Las menciones que impiden enviar (el fichero ya no existe o esta fuera de la carpeta), por `relPath`.
export function failedMentions(resolution: MentionResolution): ReadonlyMap<string, MentionFailure> {
  const failed = new Map<string, MentionFailure>();
  for (const { relPath, outcome } of resolution.outcomes) {
    if (outcome === 'missing' || outcome === 'outsideFolder') failed.set(relPath, outcome);
  }
  return failed;
}

// Lo que sale hacia el modelo: el texto del usuario + lo que main anade, y sus imagenes + los adjuntos de main.
export function applyResolution(
  text: string,
  attachments: readonly ImageAttachment[],
  resolution: MentionResolution,
): { readonly text: string; readonly attachments: readonly ImageAttachment[] } {
  return { text: `${text}${resolution.text}`, attachments: [...attachments, ...resolution.attachments] };
}
