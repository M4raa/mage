// Lo que main añade al final del mensaje por cada fichero mencionado (contenido en línea o solo la ruta), separado
// del texto del usuario para pintarlo como fichas. Solo al FINAL y de atrás adelante: lo que no casa se queda como texto.
export interface SentAttachment {
  readonly path: string;
  readonly name: string;
  readonly bytes: number | null;
}

export interface SentMessage {
  readonly body: string;
  readonly files: readonly SentAttachment[];
}

const FENCED_TAIL_RE = /\n\n(`{3,})\n\/\/ ([^\n]+)\n([\s\S]*?)\n\1$/;
const PATH_ONLY_TAIL_RE = /\n\n\[Fichero mencionado: ([^\n]+?)\. Léelo con tus herramientas si lo necesitas\.\]$/;

function fileName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
}

// Quita del final un adjunto reconocido; null si el texto no termina en ninguno.
function takeLast(text: string): { readonly rest: string; readonly file: SentAttachment } | null {
  const fenced = FENCED_TAIL_RE.exec(text);
  if (fenced !== null) {
    const path = fenced[2] ?? '';
    const bytes = new TextEncoder().encode(fenced[3] ?? '').length;
    return { rest: text.slice(0, fenced.index), file: { path, name: fileName(path), bytes } };
  }
  const pathOnly = PATH_ONLY_TAIL_RE.exec(text);
  if (pathOnly === null) return null;
  const path = pathOnly[1] ?? '';
  return { rest: text.slice(0, pathOnly.index), file: { path, name: fileName(path), bytes: null } };
}

export function splitSentAttachments(text: string): SentMessage {
  const files: SentAttachment[] = [];
  let body = text;
  for (let taken = takeLast(body); taken !== null; taken = takeLast(body)) {
    body = taken.rest;
    files.unshift(taken.file);
  }
  return files.length === 0 ? { body: text, files } : { body, files };
}
