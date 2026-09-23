import type { MemoryFile } from '@shared/memory';

// Derivación PURA de la vista de memoria desde los ficheros crudos que entrega main. Parsea el
// frontmatter (dos variantes observadas en disco: plano con `type` en la raíz, o anidado bajo
// `metadata:`), extrae los `[[wikilinks]]` del cuerpo y los resuelve al fichero destino. Sin FS ni
// IPC: recibe los ficheros ya leídos, como el resto de *View del renderer (toolView/subagentView).

// Categoría de un recuerdo. 'other' cubre cualquier `type` no catalogado (o ausente): se muestra
// igual, pero se distingue para agrupar y no perder recuerdos de tipos futuros.
export type MemoryType = 'user' | 'project' | 'feedback' | 'reference' | 'other';

// Orden de presentación de los grupos (los más "sobre el usuario/proyecto" primero).
const TYPE_ORDER: readonly MemoryType[] = ['user', 'project', 'feedback', 'reference', 'other'];

const INDEX_FILE_NAME = 'MEMORY.md';

export interface MemoryWikilink {
  readonly raw: string; // texto dentro de [[...]] tal cual
  readonly targetFileName: string | null; // fichero destino resuelto; null si no existe ese recuerdo
}

export interface MemoryNote {
  readonly fileName: string; // slug + .md — identidad estable del recuerdo
  readonly name: string; // frontmatter `name`, o el slug del fichero si falta
  readonly description: string | null;
  readonly type: MemoryType;
  readonly rawType: string | null; // el `type` crudo del frontmatter (para mostrar los 'other')
  readonly body: string; // cuerpo sin el bloque de frontmatter
  readonly links: readonly MemoryWikilink[]; // wikilinks salientes, resueltos contra el conjunto
}

export interface MemoryView {
  readonly notes: readonly MemoryNote[]; // recuerdos individuales, ordenados por tipo y nombre
  readonly indexContent: string | null; // contenido de MEMORY.md (índice a mano), o null si no hay
}

// --- Parseo de frontmatter -------------------------------------------------------------------

interface Frontmatter {
  readonly attributes: Readonly<Record<string, string>>;
  readonly body: string;
}

const DELIMITER = '---';
const WIKILINK_PATTERN = /\[\[([^\][\n]+)\]\]/g;

// Separa el frontmatter (bloque entre `---` al inicio) del cuerpo. Aplana un nivel de anidamiento
// (p.ej. `metadata:` seguido de `  type: project` guarda `type`) usando la clave hoja tras el trim.
// Sin frontmatter válido -> atributos vacíos y todo el contenido como cuerpo (nunca lanza).
export function parseFrontmatter(content: string): Frontmatter {
  const lines = content.split(/\r?\n/);
  if ((lines[0] ?? '').trim() !== DELIMITER) return { attributes: {}, body: content };

  const closingIndex = lines.findIndex((line, i) => i > 0 && line.trim() === DELIMITER);
  if (closingIndex === -1) return { attributes: {}, body: content }; // sin cierre: no es frontmatter

  const attributes: Record<string, string> = {};
  for (let i = 1; i < closingIndex; i++) {
    const line = lines[i] ?? '';
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = stripQuotes(line.slice(separator + 1).trim());
    // Valor vacío = clave contenedora (p.ej. `metadata:`); sus hijos indentados se aplanan solos.
    if (key.length === 0 || value.length === 0) continue;
    if (attributes[key] === undefined) attributes[key] = value; // primera aparición gana
  }
  const body = lines.slice(closingIndex + 1).join('\n').replace(/^\n+/, '');
  return { attributes, body };
}

function stripQuotes(value: string): string {
  const first = value.charAt(0);
  const last = value.charAt(value.length - 1);
  if (value.length >= 2 && (first === '"' || first === "'") && last === first) return value.slice(1, -1);
  return value;
}

// --- Construcción de la vista ----------------------------------------------------------------

// Construye la vista de memoria: separa MEMORY.md (índice) del resto, parsea cada recuerdo y resuelve
// sus wikilinks contra el conjunto de ficheros. O(n·m) acotado (n ficheros, m wikilinks por cuerpo).
export function buildMemoryView(files: readonly MemoryFile[]): MemoryView {
  const index = files.find((f) => f.fileName.toLowerCase() === INDEX_FILE_NAME.toLowerCase()) ?? null;
  const noteFiles = files.filter((f) => f !== index);

  // Índice stem-en-minúscula -> fileName real, para resolver wikilinks por nombre de fichero (O(1)).
  const byStem = new Map<string, string>();
  for (const file of noteFiles) byStem.set(stem(file.fileName).toLowerCase(), file.fileName);

  const notes = noteFiles.map((file) => toNote(file, byStem));
  notes.sort(compareNotes);
  return { notes, indexContent: index?.content ?? null };
}

function toNote(file: MemoryFile, byStem: ReadonlyMap<string, string>): MemoryNote {
  const { attributes, body } = parseFrontmatter(file.content);
  const rawType = attributes.type ?? null;
  return {
    fileName: file.fileName,
    name: attributes.name ?? stem(file.fileName),
    description: attributes.description ?? null,
    type: classifyType(rawType),
    rawType,
    body,
    links: resolveWikilinks(body, byStem),
  };
}

// Extrae y resuelve los wikilinks del cuerpo. Deduplica por texto crudo (un mismo destino citado
// varias veces se muestra una sola vez). El destino se resuelve por nombre de fichero (stem), que es
// como el CLI los referencia en disco (`[[layout_system]]` -> `layout_system.md`).
function resolveWikilinks(body: string, byStem: ReadonlyMap<string, string>): readonly MemoryWikilink[] {
  const seen = new Set<string>();
  const links: MemoryWikilink[] = [];
  for (const match of body.matchAll(WIKILINK_PATTERN)) {
    const raw = (match[1] ?? '').trim();
    if (raw.length === 0 || seen.has(raw)) continue;
    seen.add(raw);
    const key = stem(raw).toLowerCase();
    links.push({ raw, targetFileName: byStem.get(key) ?? null });
  }
  return links;
}

function classifyType(rawType: string | null): MemoryType {
  if (rawType === 'user' || rawType === 'project' || rawType === 'feedback' || rawType === 'reference') return rawType;
  return 'other';
}

function compareNotes(a: MemoryNote, b: MemoryNote): number {
  const byType = TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type);
  if (byType !== 0) return byType;
  return a.name.localeCompare(b.name);
}

// Nombre de fichero sin la extensión .md (case-insensitive). "feedback_x.md" -> "feedback_x".
function stem(fileName: string): string {
  return fileName.replace(/\.md$/i, '');
}
