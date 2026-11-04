import { createdFilesOf, type CreatedFile } from './createdFilesView';
import type { Block } from './types';

// Referencias del chat al plan (F5.6, #31): modulo PURO. Una referencia del texto de un mensaje
// (`§3.4`, `#20`, `F0.4`) se enlaza solo si resuelve a UN unico encabezado o elemento de lista de los
// documentos asociados de la conversacion. Aqui vive todo lo que no necesita React ni disco:
// tokenizar un texto, indexar las anclas de un documento, resolver y decidir que documentos cuentan.

export interface ReferenceToken {
  readonly start: number;
  readonly end: number;
  readonly key: string;
}

export interface DocAnchor {
  readonly docId: string;
  readonly key: string;
  readonly line: number;
  readonly label: string;
}

export interface PlanDocument {
  readonly docId: string;
  readonly title: string;
  readonly text: string;
}

export const PLAN_DOC_PREFIX = 'plan:';
const LABEL_MAX_LENGTH = 80;
const SECTION_MARK = '§';

// Las tres formas. `(?<![...])`: no casa dentro de una palabra ni pegado a otra marca; `(?![\p{L}\p{N}_])`
// corta el final (una coma o un punto de cierre quedan fuera porque `\.\d+` exige un digito detras).
const TOKEN_SOURCE = '§\\d+(?:\\.\\d+)*|#\\d+|[A-Z]{1,3}\\d+(?:\\.\\d+)*[a-z]?';
const TOKEN_RE = new RegExp(`(?<![\\p{L}\\p{N}_§#])(?:${TOKEN_SOURCE})(?![\\p{L}\\p{N}_])`, 'gu');
// Identificador al principio del texto de un encabezado o elemento, seguido de un cierre valido.
const LEADING_ID_RE = new RegExp(`^(${TOKEN_SOURCE}|\\d+(?:\\.\\d+)*)(?=$|[\\s.:)—-])`, 'u');
const HEADING_LINE_RE = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t]*$/;
const LIST_ITEM_LINE_RE = /^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(.*?)[ \t]*$/;
const FENCE_LINE_RE = /^\s*(`{3,}|~{3,})/;
const EMPHASIS_MARKS_RE = /\*\*|__|`/g;
const PLAIN_NUMBER_RE = /^\d+(?:\.\d+)*$/;
const MARKDOWN_PATH_RE = /(?<=^|[\s"'(\[`@])@?((?:[A-Za-z]:[\\/])?[^\s"'`<>|*?()[\]]+?\.(?:md|markdown|mdx))(?![\p{L}\p{N}_-])/giu;
const DRIVE_PREFIX_RE = /^[A-Za-z]:/;
const MARKDOWN_EXTENSION_RE = /\.(?:md|markdown|mdx)$/i;
const EXIT_PLAN_MODE = 'ExitPlanMode';

// `aF0.4` no; `F0.4,` si (sin la coma); numeros sueltos, nunca.
export function extractReferenceTokens(text: string): readonly ReferenceToken[] {
  return [...text.matchAll(TOKEN_RE)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    key: match[0],
  }));
}

function stripMarks(text: string): string {
  return text.replace(EMPHASIS_MARKS_RE, '').trim();
}

// Clave de la ancla de una linea, o null. El encabezado admite la forma de seccion; el elemento de
// lista NUNCA (un «1.» de lista es un ordinal, no una seccion).
function anchorKeyOf(text: string, isHeading: boolean): string | null {
  const id = LEADING_ID_RE.exec(text)?.[1];
  if (id === undefined) return null;
  if (PLAIN_NUMBER_RE.test(id)) return isHeading ? `${SECTION_MARK}${id}` : null;
  if (id.startsWith(SECTION_MARK)) return isHeading ? id : null;
  return id;
}

function anchorTextOf(line: string): { readonly text: string; readonly isHeading: boolean } | null {
  const heading = HEADING_LINE_RE.exec(line);
  if (heading !== null) return { text: stripMarks(heading[1] ?? ''), isHeading: true };
  const item = LIST_ITEM_LINE_RE.exec(line);
  if (item !== null) return { text: stripMarks(item[1] ?? ''), isHeading: false };
  return null;
}

// Devuelve el estado de valla tras la linea: marcador abierto o null.
function nextFence(line: string, open: string | null): string | null {
  const marker = FENCE_LINE_RE.exec(line)?.[1];
  if (marker === undefined) return open;
  if (open === null) return marker;
  const closes = marker[0] === open[0] && marker.length >= open.length;
  return closes ? null : open;
}

export function indexDocumentAnchors(docId: string, text: string): readonly DocAnchor[] {
  const anchors: DocAnchor[] = [];
  let fence: string | null = null;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, index) => {
    const wasOpen = fence !== null;
    fence = nextFence(line, fence);
    if (wasOpen || fence !== null) return; // dentro de la valla o la linea que la abre/cierra
    const parsed = anchorTextOf(line);
    if (parsed === null) return;
    const key = anchorKeyOf(parsed.text, parsed.isHeading);
    if (key === null) return;
    anchors.push({ docId, key, line: index, label: parsed.text.slice(0, LABEL_MAX_LENGTH) });
  });
  return anchors;
}

export function buildReferenceIndex(anchors: readonly DocAnchor[]): ReadonlyMap<string, readonly DocAnchor[]> {
  const index = new Map<string, DocAnchor[]>();
  for (const anchor of anchors) {
    const bucket = index.get(anchor.key);
    if (bucket === undefined) index.set(anchor.key, [anchor]);
    else bucket.push(anchor);
  }
  return index;
}

// Exactamente uno: una clave repetida (en un documento o entre dos) es ambigua y no se enlaza.
export function resolveReference(index: ReadonlyMap<string, readonly DocAnchor[]>, key: string): DocAnchor | null {
  const found = index.get(key);
  return found !== undefined && found.length === 1 ? (found[0] ?? null) : null;
}

// ---- Documentos asociados ----

// Segmentos de una ruta con `/` y `\` unificados, resolviendo `.` y `..` (sin `node:path`: esto corre
// en el renderer y la ruta puede venir de cualquiera de los tres SO).
function normalizeSegments(path: string): string {
  const out: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (segment === '..') out.pop();
    else if (segment !== '.' && segment.length > 0) out.push(segment);
  }
  return out.join('/');
}

function isAbsolutePath(path: string): boolean {
  return DRIVE_PREFIX_RE.test(path) || path.startsWith('/') || path.startsWith('\\');
}

// Ruta absoluta con `/`, o null si no es una ruta de documento dentro de `cwd`.
export function resolveDocumentPath(rawPath: string, cwd: string): string | null {
  return resolveInside(rawPath, cwd);
}

function resolveInside(rawPath: string, cwd: string): string | null {
  const root = normalizeSegments(cwd);
  const body = normalizeSegments(isAbsolutePath(rawPath) ? rawPath : `${cwd}/${rawPath}`);
  const caseless = DRIVE_PREFIX_RE.test(cwd);
  const [rootCmp, bodyCmp] = caseless ? [root.toLowerCase(), body.toLowerCase()] : [root, body];
  if (!bodyCmp.startsWith(`${rootCmp}/`)) return null;
  const prefix = cwd.startsWith('/') ? '/' : '';
  return `${prefix}${body}`;
}

function citedMarkdownPaths(text: string): readonly string[] {
  return [...text.matchAll(MARKDOWN_PATH_RE)]
    .map((match) => match[1] ?? '')
    .filter((path) => path.length > 0 && !path.includes('://'));
}

function messageTexts(blocks: readonly Block[]): readonly string[] {
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'user') texts.push(block.text);
    else if (block.kind === 'agent') texts.push(block.runs.map((run) => run.text).join(''));
  }
  return texts;
}

// Rutas absolutas, sin duplicados, dentro de `cwd`: los .md creados por el agente (no fallidos) y los
// citados en los mensajes del usuario y del agente (con o sin `@`).
export function associatedDocumentPaths(blocks: readonly Block[], cwd: string): readonly string[] {
  const caseless = DRIVE_PREFIX_RE.test(cwd);
  const seen = new Set<string>();
  const result: string[] = [];
  const add = (rawPath: string): void => {
    if (!MARKDOWN_EXTENSION_RE.test(rawPath)) return;
    const resolved = resolveInside(rawPath, cwd);
    if (resolved === null) return;
    const dedupeKey = caseless ? resolved.toLowerCase() : resolved;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    result.push(resolved);
  };
  for (const file of createdFilesOf(blocks)) {
    if (!file.failed) add(file.path);
  }
  for (const text of messageTexts(blocks)) citedMarkdownPaths(text).forEach(add);
  return result;
}

function firstLineTitle(plan: string): string {
  const line = plan.split('\n').find((candidate) => candidate.trim().length > 0) ?? '';
  return line.replace(/^\s*#+\s*/, '').trim().slice(0, LABEL_MAX_LENGTH);
}

// Un documento virtual de solo lectura por cada ExitPlanMode con plan.
export function planDocuments(blocks: readonly Block[]): readonly PlanDocument[] {
  const docs: PlanDocument[] = [];
  for (const block of blocks) {
    if (block.kind !== 'tool' || block.tool !== EXIT_PLAN_MODE) continue;
    if (block.planText === undefined || block.planText.length === 0) continue;
    docs.push({ docId: `${PLAN_DOC_PREFIX}${block.id}`, title: firstLineTitle(block.planText), text: block.planText });
  }
  return docs;
}

// Texto con el que empieza, ya pintado, el encabezado o elemento de una ancla: la forma de seccion
// tambien casa con un encabezado escrito «§3.4». Cierre igual que al indexar.
export function anchorTextMatcher(key: string): RegExp {
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = key.startsWith(SECTION_MARK) ? `${SECTION_MARK}?${escape(key.slice(SECTION_MARK.length))}` : escape(key);
  return new RegExp(`^${body}(?=$|[\\s.:)—-])`, 'u');
}

// ---- Lista del panel Ficheros ----

export type PanelEntry =
  | { readonly kind: 'file'; readonly docId: string; readonly file: CreatedFile; readonly cited: boolean }
  | { readonly kind: 'plan'; readonly docId: string; readonly title: string; readonly text: string };

function citedFile(path: string): CreatedFile {
  const cut = path.lastIndexOf('/');
  return { path, name: path.slice(cut + 1), dir: path.slice(0, Math.max(cut, 0)), blockId: '', failed: false };
}

// Lo que ensena el panel: los ficheros creados (mas reciente primero), los .md citados en el hilo que no
// se han creado en el y los planes del modo plan. Un fichero y un documento citado comparten `docId`
// (la ruta resuelta), que es la clave con la que se indexan sus anclas.
export function panelEntries(blocks: readonly Block[], cwd: string): readonly PanelEntry[] {
  const created = createdFilesOf(blocks).map((file): PanelEntry => ({ kind: 'file', docId: resolveInside(file.path, cwd) ?? file.path, file, cited: false }));
  const known = new Set(created.map((entry) => entry.docId));
  const cited = associatedDocumentPaths(blocks, cwd)
    .filter((path) => !known.has(path))
    .map((path): PanelEntry => ({ kind: 'file', docId: path, file: citedFile(path), cited: true }));
  const plans = planDocuments(blocks).map((doc): PanelEntry => ({ kind: 'plan', docId: doc.docId, title: doc.title, text: doc.text }));
  return [...created, ...cited, ...plans];
}
