import { AGY_PROVIDER_ID, CLAUDE_PROVIDER_ID, CODEX_PROVIDER_ID } from './providers';
import type { MentionKind } from './mentions';

export const MENTION_INLINE_MAX_BYTES = 100 * 1024;

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
