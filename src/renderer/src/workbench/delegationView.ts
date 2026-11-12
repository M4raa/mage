import type { DelegationCard } from '@shared/delegationCards';
import type { AccountConversation } from './sidebarModel';
import { conversationIdOfTab } from './conversationId';
import type { Block, Tab } from './types';

// Modelo de vista de la tarjeta de una subsesión creada con `mage_create_session`. PURO, con la misma idea que
// `artifactView.ts`: la tarjeta se decide AL PINTAR a partir del bloque de la herramienta, sin variante propia de `Block`.

export interface DelegationCardView extends DelegationCard {
  readonly blockId: string;
}

// Tarjeta de un bloque, o `null` si ese bloque no es una subsesión YA CREADA (mientras la herramienta corre no hay
// `conversationId`: se pinta la caja de herramienta de siempre). `== null` por los bloques anteriores a este campo.
export function delegationCardFrom(block: Block): DelegationCardView | null {
  if (block.kind !== 'tool' || block.delegation == null) return null;
  return { ...block.delegation, blockId: block.id };
}

// Dónde está una subsesión: en una pestaña abierta, solo en el historial cargado, o en ninguno de los dos.
export type SubsessionTarget =
  | { readonly kind: 'tab'; readonly tabId: string }
  | { readonly kind: 'history'; readonly entry: AccountConversation }
  | { readonly kind: 'missing' };

export function findSubsession(
  conversationId: string,
  state: { readonly tabs: readonly Tab[]; readonly sessionIdByChat: Readonly<Record<string, string>>; readonly history: readonly AccountConversation[] },
): SubsessionTarget {
  const tab = state.tabs.find((candidate) => conversationIdOfTab(candidate, state.sessionIdByChat[candidate.id]) === conversationId);
  if (tab !== undefined) return { kind: 'tab', tabId: tab.id };
  const entry = state.history.find((candidate) => candidate.item.sessionId === conversationId);
  return entry === undefined ? { kind: 'missing' } : { kind: 'history', entry };
}
