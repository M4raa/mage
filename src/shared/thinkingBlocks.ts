import type { TranscriptEntry } from './transcripts';

// Pensamientos que guarda Mage frente a los bloques `thinking` de la transcripción (el CLI los persiste vacíos, solo con la
// firma). Los dos ficheros son de solo añadir y CASAN POR LA COLA: el último texto guardado es el del último bloque. Por
// la cola porque al fichero de Mage le pueden faltar los más antiguos (compactado, conversación anterior a que Mage los
// guardara, rama nueva de Divergir), y al rebobinar se le quitan del FINAL los de la rama descartada (`dropLast`).

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ¿Trae este mensaje del asistente algún bloque de pensamiento? (su texto viene vacío en disco).
export function hasThinkingBlock(raw: unknown): boolean {
  if (!isRecord(raw) || !isRecord(raw.message)) return false;
  const content = raw.message.content;
  return Array.isArray(content) && content.some((block) => isRecord(block) && block.type === 'thinking');
}

// Entradas que pintan un bloque de pensamiento: las del asistente que no son meta y traen uno. Es lo que consume
// `transcriptToBlocks`, y lo que cuenta main al rebobinar.
export function countThinkingEntries(entries: readonly TranscriptEntry[]): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.isMeta || entry.kind !== 'assistant') continue;
    if (hasThinkingBlock(entry.raw)) count += 1;
  }
  return count;
}
