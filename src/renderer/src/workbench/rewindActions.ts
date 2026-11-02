import type { RewindPointRef, RewindUnavailableReason } from '@shared/ipc';
import type { Translate } from '@shared/i18n/translator';
import { isPlaceholderTitle } from '@shared/conversationTitle';
import { CLAUDE_PROVIDER_ID, CODEX_PROVIDER_ID } from '@shared/providers';
import type { Block } from './types';

// Lógica pura de las acciones de la burbuja del usuario (Rebobinar, Reintentar, Divergir; K07). Vive aparte
// del componente y del store para poder probarla sin React ni IPC.

// Referencia al mensaje que el usuario pulsó: su posición entre los bloques `user` (empezando en 0), su texto
// y su id ante el CLI. null si el bloque no existe o no es de usuario.
export function rewindPointOf(blocks: readonly Block[], blockId: string): RewindPointRef | null {
  let userIndex = 0;
  for (const block of blocks) {
    if (block.kind !== 'user') continue;
    if (block.id === blockId) return { userIndex, text: block.text, nativeId: block.nativeId };
    userIndex += 1;
  }
  return null;
}

export interface RewindOfferInput {
  readonly provider: string;
  readonly hasLiveSession: boolean;
  readonly readOnly: boolean;
  readonly isWrapper: boolean; // chip de comando o tarea programada: no son mensajes que se rebobinen
  readonly nativeIdKnown: boolean;
}

// ¿Ofrece la burbuja las tres acciones? Solo Claude y Codex, con sesión viva, escribible y sin envoltorio. En
// Claude el punto se identifica por el uuid, así que sin él no hay punto; en Codex bastan el índice y el
// texto (D-K2).
export function canOfferRewind(input: RewindOfferInput): boolean {
  if (input.provider !== CLAUDE_PROVIDER_ID && input.provider !== CODEX_PROVIDER_ID) return false;
  if (!input.hasLiveSession || input.readOnly || input.isWrapper) return false;
  return input.provider === CODEX_PROVIDER_ID || input.nativeIdKnown;
}

// Texto de por qué no se puede aplicar la acción (claves `errors.rewind.*` de K05).
export function unavailableText(t: Translate, reason: RewindUnavailableReason, providerName: string): string {
  switch (reason) {
    case 'unsupported': return t('errors.rewind.unsupported', { provider: providerName });
    case 'background': return t('errors.rewind.background');
    case 'legacy': return t('errors.rewind.legacy');
    case 'notFound': return t('errors.rewind.notFound');
    case 'midTurn': return t('errors.rewind.midTurn');
    case 'busy': return t('errors.rewind.busy');
  }
}

// Título de la pestaña que abre «Divergir» (K-U4): «Rama de <título>», o la versión sin título.
export function divergeTitle(title: string, t: Translate): string {
  if (isPlaceholderTitle(title)) return t('chat.diverge.tabTitleUntitled');
  return t('chat.diverge.tabTitle', { title });
}
