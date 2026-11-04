// Resumen de una linea de un texto descriptivo (#34, #36): la primera frase, o un recorte con «…».
// PURO. El texto completo sigue disponible: quien lo pinta lo despliega al pulsar.

const DEFAULT_MAX_CHARS = 120;
const SENTENCE_END = /[.?!](?=\s)|\n/;

export function firstSentence(text: string, maxChars: number = DEFAULT_MAX_CHARS): string {
  if (!Number.isInteger(maxChars) || maxChars < 1) throw new Error(`firstSentence: maxChars debe ser un entero >= 1, recibido ${maxChars}`);
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  const match = SENTENCE_END.exec(trimmed);
  if (match !== null) {
    // Un punto se queda en la frase; un salto de linea no.
    const end = match[0] === '\n' ? match.index : match.index + 1;
    if (end < maxChars) return trimmed.slice(0, end).trimEnd();
  }
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.lastIndexOf(' ', maxChars);
  return `${trimmed.slice(0, cut > 0 ? cut : maxChars).trimEnd()}…`;
}
