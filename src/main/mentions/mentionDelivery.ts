import { AGY_PROVIDER_ID, CLAUDE_PROVIDER_ID, CODEX_PROVIDER_ID } from '@shared/providers';
import type { MentionKind } from '@shared/mentions';

export const MENTION_INLINE_MAX_BYTES = 100 * 1024;

const MIN_FENCE_LENGTH = 3;
const IMAGE_PROVIDER_IDS: readonly string[] = [CLAUDE_PROVIDER_ID, CODEX_PROVIDER_ID, AGY_PROVIDER_ID];

export type DeliveryPlan = 'attach' | 'inline' | 'pathOnly';

// Politica por motor (B4): imagen adjunta en Claude, Codex y agy (el runtime propio no acepta imagenes);
// PDF adjunto solo en Claude; texto en linea hasta el tope; el resto, solo la ruta.
export function planDelivery(kind: MentionKind, bytes: number, provider: string): DeliveryPlan {
  if (kind === 'image') return IMAGE_PROVIDER_IDS.includes(provider) ? 'attach' : 'pathOnly';
  if (kind === 'pdf') return provider === CLAUDE_PROVIDER_ID ? 'attach' : 'pathOnly';
  if (kind === 'text') return bytes <= MENTION_INLINE_MAX_BYTES ? 'inline' : 'pathOnly';
  return 'pathOnly';
}

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
