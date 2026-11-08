const MIN_FENCE_LENGTH = 3;

function fenceFor(content: string): string {
  const longest = Math.max(0, ...[...content.matchAll(/`{3,}/g)].map((match) => match[0].length));
  return '`'.repeat(longest >= MIN_FENCE_LENGTH ? longest + 1 : MIN_FENCE_LENGTH);
}

export function inlineBlock(relPath: string, content: string): string {
  const fence = fenceFor(content);
  return `\n\n${fence}\n// ${relPath}\n${content}\n${fence}`;
}

// Texto para el modelo (en castellano, como el resto de lo que lee el modelo).
export function pathOnlyNote(absPath: string): string {
  return `\n\n[Fichero mencionado: ${absPath}. Léelo con tus herramientas si lo necesitas.]`;
}
