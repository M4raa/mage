import { parsePrKey, type MergeStrategy, type PrCatalogEntry, type PrKey, type PrListState, type PrSnapshot, type PrWriteAction, type RepoMergeOptions } from '@shared/pr';

// Reglas puras del panel de PR (F5.5): paginacion, estrategias de fusion, que PR son «de esta conversacion»
// y que acciones admite cada estado. El componente y la store solo llaman aqui.

export const PR_PAGE_SIZE = 30;
export const PR_MAX_LIMIT = 100;

export const PR_LIST_STATES: readonly PrListState[] = ['open', 'draft', 'closed', 'merged', 'all'];

// Orden en el que se ofrecen las estrategias (la primera es la que se propone).
const STRATEGY_ORDER: readonly MergeStrategy[] = ['squash', 'merge', 'rebase'];

// Sube el limite una pagina sin pasar de `PR_MAX_LIMIT`.
export function nextLimit(current: number): number {
  return Math.min(current + PR_PAGE_SIZE, PR_MAX_LIMIT);
}

// Solo las estrategias que el repositorio permite, en el orden de `STRATEGY_ORDER`.
export function allowedStrategies(options: RepoMergeOptions): readonly MergeStrategy[] {
  return STRATEGY_ORDER.filter((strategy) => options[strategy]);
}

export interface ConversationPr {
  readonly key: PrKey;
  readonly primary: boolean;
}

// Las PR vinculadas a la conversacion, la principal primero. Una clave que no se puede leer se descarta.
export function conversationPrKeys(entries: readonly PrCatalogEntry[], conversationId: string): readonly ConversationPr[] {
  const linked: ConversationPr[] = [];
  for (const entry of entries) {
    const link = entry.links.find((candidate) => candidate.conversationId === conversationId);
    const key = link === undefined ? null : parsePrKey(entry.key);
    if (link !== undefined && key !== null) linked.push({ key, primary: link.primary });
  }
  return [...linked.filter((pr) => pr.primary), ...linked.filter((pr) => !pr.primary)];
}

export type PrStateBadge = 'draft' | 'open' | 'merged' | 'closed';

export function prStateBadge(pr: PrSnapshot): PrStateBadge {
  if (pr.state === 'open' && pr.isDraft) return 'draft';
  return pr.state;
}

// Que acciones de escritura admite una PR segun su estado (la ultima palabra la tiene GitHub).
export function canWrite(pr: PrSnapshot, action: PrWriteAction['kind']): boolean {
  switch (action) {
    case 'close':
    case 'comment':
    case 'review':
      return pr.state === 'open';
    case 'reopen':
      return pr.state === 'closed';
    case 'merge':
    case 'autoMerge':
      return pr.state === 'open' && !pr.isDraft;
  }
}

const PR_URL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/([0-9]+)(?:[/?#].*)?$/;

// La clave de una PR a partir de su URL de GitHub; null si no es la de una PR.
export function prKeyFromUrl(url: string): PrKey | null {
  const match = PR_URL.exec(url);
  if (match === null) return null;
  return parsePrKey(`github.com/${match[1]}/${match[2]}#${match[3]}`);
}
