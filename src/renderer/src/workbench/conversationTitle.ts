// Titulo de una conversacion (M2.6): las pestanas nuevas arrancan SIN titulo elegido (placeholder) y
// se auto-titulan con el primer prompt del usuario. Modulo PURO (sin DOM ni store) -> testable.

// Placeholder de una conversacion aun sin primer prompt. Sirve tambien de centinela: mientras el
// titulo sea este, el primer mensaje del usuario lo reemplaza automaticamente.
export const NEW_CONVERSATION_TITLE = 'Nueva conversación';

// Longitud maxima del titulo derivado; mas largo se recorta con puntos suspensivos.
const MAX_TITLE_LENGTH = 60;

// Deriva un titulo a partir del primer prompt: primera linea no vacia, recortada. Un texto vacio
// (o solo espacios/saltos) devuelve el placeholder (no deja la pestana sin nombre).
export function deriveTitleFromPrompt(text: string): string {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? '';
  if (firstLine.length === 0) return NEW_CONVERSATION_TITLE;
  if (firstLine.length <= MAX_TITLE_LENGTH) return firstLine;
  return `${firstLine.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

// True si el titulo sigue siendo el placeholder (o esta vacio) -> el primer prompt puede reemplazarlo.
export function isPlaceholderTitle(title: string): boolean {
  return title.trim().length === 0 || title === NEW_CONVERSATION_TITLE;
}
