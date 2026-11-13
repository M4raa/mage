import type { WorkbenchState } from './workbenchStore';
import { visibleTabIds } from './splitLayout';
import { conversationIdOfTab } from './conversationId';
import { isSubagentRunning } from './engineBlocks';

// Punto 23 de P-043 (D2): si se suelta el PROCESO de una pestaña inactiva (nunca la pestaña). PURO: el barrido lo ejecuta.
export const IDLE_SWEEP_INTERVAL_MS = 60_000;
const MS_PER_MINUTE = 60_000;

export interface IdleTabFacts {
  readonly visible: boolean;
  readonly status: string;
  readonly hasConversation: boolean;
  readonly pending: number;
  readonly queued: number;
  readonly backgroundWork: boolean;
  readonly idleSinceMs: number;
}

export type IdleSkipReason = 'disabled' | 'visible' | 'busy' | 'no_conversation' | 'pending' | 'queue' | 'background' | 'recent';
export type IdleDecision = { readonly kind: 'close' } | { readonly kind: 'skip'; readonly reason: IdleSkipReason };

export type IdleStateSlice = Pick<WorkbenchState, 'tabs' | 'activeTabId' | 'splitLayout' | 'sessionIdByChat' | 'statusByChat' | 'pendingByChat' | 'elicitationsByChat' | 'queuedByChat' | 'backgroundTasksByChat' | 'blocksByChat' | 'lastActivityByChat'>;

const skip = (reason: IdleSkipReason): IdleDecision => ({ kind: 'skip', reason });

// Primera condición que lo impide, en orden; si ninguna, se suelta.
export function decideIdleClose(facts: IdleTabFacts, idleCloseMinutes: number, nowMs: number): IdleDecision {
  if (idleCloseMinutes === 0) return skip('disabled');
  if (facts.visible) return skip('visible');
  if (facts.status !== 'idle') return skip('busy');
  if (!facts.hasConversation) return skip('no_conversation');
  if (facts.pending > 0) return skip('pending');
  if (facts.queued > 0) return skip('queue');
  if (facts.backgroundWork) return skip('background');
  if (nowMs - facts.idleSinceMs < idleCloseMinutes * MS_PER_MINUTE) return skip('recent');
  return { kind: 'close' };
}

// Los hechos de una pestaña, leídos del store. `firstSeenMs` mide una sesión que aún no tuvo ninguna actividad.
export function idleFactsOf(state: IdleStateSlice, tabId: string, firstSeenMs: number): IdleTabFacts {
  const tab = state.tabs.find((candidate) => candidate.id === tabId);
  const blocks = state.blocksByChat[tabId] ?? [];
  const runningSubagent = blocks.some((block) => block.kind === 'subagent' && isSubagentRunning(block));
  return {
    visible: tabId === state.activeTabId || visibleTabIds(state.splitLayout).includes(tabId),
    status: state.statusByChat[tabId] ?? 'idle',
    hasConversation: tab !== undefined && conversationIdOfTab(tab, state.sessionIdByChat[tabId]) !== undefined,
    pending: (state.pendingByChat[tabId]?.length ?? 0) + (state.elicitationsByChat[tabId]?.filter((entry) => entry.state === 'pending').length ?? 0),
    queued: state.queuedByChat[tabId]?.length ?? 0,
    backgroundWork: (state.backgroundTasksByChat[tabId]?.length ?? 0) > 0 || runningSubagent,
    idleSinceMs: state.lastActivityByChat[tabId] ?? firstSeenMs,
  };
}
