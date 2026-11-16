import { describe, expect, it } from 'vitest';
import { decideIdleClose, idleFactsOf, type IdleStateSlice, type IdleTabFacts } from './idleSessions';
import { SUBAGENT_STATUS } from './engineBlocks';
import type { SplitLayout } from '@shared/state';
import type { Block, Tab } from './types';
import type { SubagentStatus } from './engineBlocks';

const MS_PER_MINUTE = 60_000;
const THIRTY_MINUTES_MS = 30 * MS_PER_MINUTE;

const BASE_FACTS: IdleTabFacts = {
  visible: false,
  status: 'idle',
  hasConversation: true,
  pending: 0,
  queued: 0,
  backgroundWork: false,
  idleSinceMs: 0,
};

const decide = (over: Partial<IdleTabFacts>, minutes = 30, nowMs = THIRTY_MINUTES_MS) => decideIdleClose({ ...BASE_FACTS, ...over }, minutes, nowMs);

describe('decideIdleClose', () => {
  it('decideIdleClose_ceroMinutos_skipDisabled', () => {
    expect(decide({}, 0)).toEqual({ kind: 'skip', reason: 'disabled' });
  });

  it('decideIdleClose_visible_skipVisible', () => {
    expect(decide({ visible: true })).toEqual({ kind: 'skip', reason: 'visible' });
  });

  it('decideIdleClose_turnoEnMarcha_skipBusy', () => {
    expect(decide({ status: 'streaming' })).toEqual({ kind: 'skip', reason: 'busy' });
  });

  it('decideIdleClose_sinConversacion_skipNoConversation', () => {
    expect(decide({ hasConversation: false })).toEqual({ kind: 'skip', reason: 'no_conversation' });
  });

  it('decideIdleClose_permisoPendiente_skipPending', () => {
    expect(decide({ pending: 1 })).toEqual({ kind: 'skip', reason: 'pending' });
  });

  it('decideIdleClose_conCola_skipQueue', () => {
    expect(decide({ queued: 2 })).toEqual({ kind: 'skip', reason: 'queue' });
  });

  it('decideIdleClose_trabajoEnSegundoPlano_skipBackground', () => {
    expect(decide({ backgroundWork: true })).toEqual({ kind: 'skip', reason: 'background' });
  });

  it('decideIdleClose_29Minutos_skipRecent', () => {
    expect(decide({}, 30, 29 * MS_PER_MINUTE)).toEqual({ kind: 'skip', reason: 'recent' });
  });

  it('decideIdleClose_justo30Minutos_close', () => {
    expect(decide({}, 30, THIRTY_MINUTES_MS)).toEqual({ kind: 'close' });
  });
});

const tab = (id: string): Tab => ({ id, accountId: 'a', accountAlias: 'A', cwd: '/p', model: 'm', provider: 'claude', title: id });
const leaf = (tabIds: readonly string[], activeTabId: string): SplitLayout => ({ kind: 'leaf', tabIds, activeTabId });

const subagent = (status: SubagentStatus | null): Block => ({
  kind: 'subagent', id: 'b1', toolUseId: 'tu1', agentType: null, description: null, agentId: null, status, elapsedMs: null, tokens: null, toolUses: null, model: null,
});

// El mínimo del store que lee `idleFactsOf`: la pestaña `t1` con sesión viva, `t0` activa.
function slice(over: Partial<IdleStateSlice> = {}): IdleStateSlice {
  return {
    tabs: [tab('t0'), tab('t1')],
    activeTabId: 't0',
    splitLayout: leaf(['t0', 't1'], 't0'),
    sessionIdByChat: { t1: 's1' },
    statusByChat: {},
    pendingByChat: {},
    elicitationsByChat: {},
    queuedByChat: {},
    backgroundTasksByChat: {},
    blocksByChat: {},
    lastActivityByChat: {},
    ...over,
  };
}

describe('idleFactsOf', () => {
  it('idleFactsOf_activaDeOtraHoja_visible', () => {
    const split: SplitLayout = { kind: 'split', direction: 'row', ratio: 0.5, a: leaf(['t0'], 't0'), b: leaf(['t1'], 't1') };

    const facts = idleFactsOf(slice({ splitLayout: split }), 't1', 0);

    expect(facts.visible).toBe(true);
  });

  it('idleFactsOf_subagenteEnMarcha_backgroundWork', () => {
    const running = idleFactsOf(slice({ blocksByChat: { t1: [subagent(null)] } }), 't1', 0);
    const finished = idleFactsOf(slice({ blocksByChat: { t1: [subagent(SUBAGENT_STATUS.completed)] } }), 't1', 0);

    expect(running.backgroundWork).toBe(true);
    expect(finished.backgroundWork).toBe(false);
  });

  it('idleFactsOf_sinActividad_usaFirstSeen', () => {
    const none = idleFactsOf(slice(), 't1', 1234);
    const recorded = idleFactsOf(slice({ lastActivityByChat: { t1: 99 } }), 't1', 1234);

    expect(none.idleSinceMs).toBe(1234);
    expect(recorded.idleSinceMs).toBe(99);
  });
});
