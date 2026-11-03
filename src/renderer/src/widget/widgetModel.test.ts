import { describe, expect, it } from 'vitest';
import type { WidgetAgent, WidgetRequestView, WidgetSessionView } from '@shared/widget';
import { buildRows, rowTarget, sessionStatus, summarize, type WidgetRow } from './widgetModel';

function agent(overrides: Partial<WidgetAgent> = {}): WidgetAgent {
  return { tabId: 't1', title: 'proj', accountAlias: 'claude-p', accentBase: '#fff', status: 'idle', ...overrides };
}

function session(overrides: Partial<WidgetSessionView> = {}): WidgetSessionView {
  return { sessionId: 's1', provider: 'claude', state: 'idle', outcome: 'none', background: false, requests: [], ...overrides };
}

const PERM: WidgetRequestView = { kind: 'permission', requestId: 'r1', tool: 'Bash', detail: 'ls' };

function row(overrides: Partial<WidgetRow> = {}): WidgetRow {
  return {
    key: 's1', sessionId: 's1', tabId: 't1', title: 'proj', accountAlias: 'a', accentBase: '#fff',
    status: 'idle', requests: [], canStop: false, ...overrides,
  };
}

describe('sessionStatus', () => {
  it('sessionStatus_pendingRequest_attention', () => {
    expect(sessionStatus(session({ requests: [PERM], state: 'requires_action' }), agent())).toBe('attention');
  });

  it('sessionStatus_pendingAndError_attentionWins', () => {
    expect(sessionStatus(session({ requests: [PERM], outcome: 'error' }), agent())).toBe('attention');
  });

  it('sessionStatus_outcomeError_error', () => {
    expect(sessionStatus(session({ outcome: 'error' }), agent())).toBe('error');
  });

  it('sessionStatus_stateError_error', () => {
    expect(sessionStatus(session({ state: 'error' }), agent())).toBe('error');
  });

  it('sessionStatus_noSessionAgentError_error', () => {
    expect(sessionStatus(undefined, agent({ status: 'error' }))).toBe('error');
  });

  it('sessionStatus_running_working', () => {
    expect(sessionStatus(session({ state: 'running' }), agent())).toBe('working');
  });

  it('sessionStatus_starting_working', () => {
    expect(sessionStatus(session({ state: 'starting' }), agent())).toBe('working');
  });

  it('sessionStatus_errorAndRunning_errorWins', () => {
    expect(sessionStatus(session({ outcome: 'error', state: 'running' }), agent())).toBe('error');
  });

  it('sessionStatus_readOnlyIdle_readOnly', () => {
    expect(sessionStatus(undefined, agent({ readOnly: true }))).toBe('read_only');
  });

  it('sessionStatus_runningAndReadOnly_workingWins', () => {
    expect(sessionStatus(session({ state: 'running' }), agent({ readOnly: true }))).toBe('working');
  });

  it('sessionStatus_finished_finished', () => {
    expect(sessionStatus(session({ outcome: 'finished' }), agent())).toBe('finished');
  });

  it('sessionStatus_readOnlyAndFinished_readOnlyWins', () => {
    expect(sessionStatus(session({ outcome: 'finished' }), agent({ readOnly: true }))).toBe('read_only');
  });

  it('sessionStatus_nothing_idle', () => {
    expect(sessionStatus(undefined, undefined)).toBe('idle');
  });
});

describe('buildRows', () => {
  it('buildRows_agentWithSession_mergesRequests', () => {
    const rows = buildRows([agent({ sessionId: 's1' })], [session({ requests: [PERM], state: 'requires_action' })]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: 's1', requests: [PERM], status: 'attention', tabId: 't1' });
  });

  it('buildRows_sessionWithoutTab_addsUntitledRow', () => {
    const rows = buildRows([], [session()]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: '', tabId: null, key: 's1' });
  });

  it('buildRows_agentWithoutSession_keyByTab', () => {
    const rows = buildRows([agent()], []);

    expect(rows[0]).toMatchObject({ key: 'tab:t1', sessionId: null });
  });

  it('buildRows_sortsByPriorityStable', () => {
    const agents = [
      agent({ tabId: 't1' }),
      agent({ tabId: 't2', sessionId: 's2' }),
      agent({ tabId: 't3', sessionId: 's3' }),
      agent({ tabId: 't4' }),
    ];
    const sessions = [
      session({ sessionId: 's2', state: 'running' }),
      session({ sessionId: 's3', requests: [PERM] }),
    ];

    const rows = buildRows(agents, sessions);

    expect(rows.map((r) => r.tabId)).toEqual(['t3', 't2', 't1', 't4']);
  });

  it('buildRows_workingRow_canStop', () => {
    const rows = buildRows([agent({ sessionId: 's1' })], [session({ state: 'running' })]);

    expect(rows[0]?.canStop).toBe(true);
  });

  it('buildRows_idleRow_cannotStop', () => {
    const rows = buildRows([agent({ sessionId: 's1' })], [session()]);

    expect(rows[0]?.canStop).toBe(false);
  });
});

describe('summarize', () => {
  it('summarize_empty_topNull', () => {
    expect(summarize([])).toEqual({ top: null, attentionCount: 0, total: 0 });
  });

  it('summarize_twoAttention_countsThem', () => {
    const rows = [row({ status: 'attention' }), row({ status: 'attention' }), row({ status: 'idle' })];

    expect(summarize(rows)).toEqual({ top: 'attention', attentionCount: 2, total: 3 });
  });
});

describe('rowTarget', () => {
  it('rowTarget_withSession_session', () => {
    expect(rowTarget(row())).toEqual({ kind: 'session', sessionId: 's1' });
  });

  it('rowTarget_tabOnly_tab', () => {
    expect(rowTarget(row({ sessionId: null }))).toEqual({ kind: 'tab', tabId: 't1' });
  });

  it('rowTarget_neither_null', () => {
    expect(rowTarget(row({ sessionId: null, tabId: null }))).toBeNull();
  });
});
