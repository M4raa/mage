import { describe, expect, it } from 'vitest';
import type { ConversationSnapshot, CoordinatedState } from '@shared/coordination';
import type { AdoptableSession } from '@shared/ipc';
import type { PermissionRequest } from '@shared/events';
import type { ElicitationRequest } from '@shared/elicitation';
import { adoptedTab, adoptionTarget, chatStatusOf, creatorTabOf, snapshotEvents } from './adoptSession';
import type { Tab } from './types';

const ACCOUNT = '/home/u/.claude';

function session(over: Partial<AdoptableSession> = {}): AdoptableSession {
  return { sessionId: 's1', conversationId: 'c1', nativeId: 'n1', provider: 'claude', accountId: ACCOUNT, configDir: ACCOUNT, cwd: '/proj/app',
    model: 'sonnet', origin: 'terminal', createdBy: null, ...over };
}

function tab(id: string, over: Partial<Tab> = {}): Tab {
  return { id, accountId: ACCOUNT, accountAlias: 'principal', cwd: '/proj', model: 'sonnet', provider: 'claude', title: id, privacy: 'shared', ...over };
}

function snapshot(over: Partial<ConversationSnapshot> = {}): ConversationSnapshot {
  return { sessionId: 's1', provider: 'claude', conversationId: 'c1', nativeRef: null, lastSeq: 0, state: 'idle', queue: [], pending: [], background: false, ...over };
}

describe('adoptionTarget', () => {
  it('adoptionTarget_sessionAlreadyBound_bound', () => {
    const state = { tabs: [tab('a')], sessionIdByChat: { a: 's1' } };
    expect(adoptionTarget(state, session())).toEqual({ kind: 'bound' });
  });

  it('adoptionTarget_restoredTabSameConversationNoSession_reuse', () => {
    const state = { tabs: [tab('a', { resumeSessionId: 'n1' })], sessionIdByChat: {} };
    expect(adoptionTarget(state, session())).toEqual({ kind: 'reuse', tabId: 'a' });
  });

  it('adoptionTarget_restoredTabOtherAccount_new', () => {
    const state = { tabs: [tab('a', { resumeSessionId: 'n1', accountId: 'otra' })], sessionIdByChat: {} };
    expect(adoptionTarget(state, session())).toEqual({ kind: 'new' });
  });

  it('adoptionTarget_restoredTabWithLiveSession_new', () => {
    const state = { tabs: [tab('a', { resumeSessionId: 'n1' })], sessionIdByChat: { a: 'otraSesion' } };
    expect(adoptionTarget(state, session())).toEqual({ kind: 'new' });
  });

  it('adoptionTarget_nullNativeId_new', () => {
    const state = { tabs: [tab('a', { resumeSessionId: 'n1' })], sessionIdByChat: {} };
    expect(adoptionTarget(state, session({ nativeId: null }))).toEqual({ kind: 'new' });
  });
});

describe('adoptedTab', () => {
  const ids = { tabId: 'tab7', accountAlias: 'principal', title: 'app', nowMs: 1234 };

  it('adoptedTab_fullSession_mapsAllFields', () => {
    const result = adoptedTab(session({ effort: 'high', permissionMode: 'plan', configDir: '/priv' }), ids);
    expect(result).toEqual({ id: 'tab7', accountId: ACCOUNT, accountAlias: 'principal', cwd: '/proj/app', model: 'sonnet', provider: 'claude',
      title: 'app', privacy: 'shared', resolvedConfigDir: '/priv', resumeSessionId: 'n1', effort: 'high', permissionMode: 'plan', createdAtMs: 1234, worktreeOff: true });
  });

  it('adoptedTab_nullNativeId_noResumeSessionId', () => {
    const result = adoptedTab(session({ nativeId: null }), ids);
    expect('resumeSessionId' in result).toBe(false);
    expect('effort' in result).toBe(false);
    expect('permissionMode' in result).toBe(false);
  });
});

describe('adoptedTab createdBy', () => {
  const ids = { tabId: 'tab7', accountAlias: 'principal', title: 'app', nowMs: 1234 };
  const by = { conversationId: 'cv', sessionId: 'creator-s' };

  it('adoptedTab_createdBy_copied', () => {
    expect(adoptedTab(session({ createdBy: by }), ids).createdBy).toEqual(by);
  });

  it('adoptedTab_nullCreatedBy_absent', () => {
    expect('createdBy' in adoptedTab(session({ createdBy: null }), ids)).toBe(false);
  });
});

describe('creatorTabOf', () => {
  const child = tab('child', { createdBy: { conversationId: 'cv', sessionId: 'creator-s' } });

  it('creatorTabOf_open_returnsTabAndTitle', () => {
    const state = { tabs: [tab('boss', { title: 'Jefa' }), child], sessionIdByChat: { boss: 'creator-s' } };
    expect(creatorTabOf(state, child)).toEqual({ tabId: 'boss', title: 'Jefa' });
  });

  it('creatorTabOf_closed_null', () => {
    const state = { tabs: [tab('boss'), child], sessionIdByChat: { boss: 'otra' } };
    expect(creatorTabOf(state, child)).toBeNull();
  });

  it('creatorTabOf_noCreatedBy_null', () => {
    const plain = tab('plain');
    expect(creatorTabOf({ tabs: [plain], sessionIdByChat: { plain: 'creator-s' } }, plain)).toBeNull();
  });
});

describe('chatStatusOf', () => {
  it.each<[CoordinatedState, string]>([
    ['idle', 'idle'], ['running', 'streaming'], ['starting', 'streaming'], ['restarting', 'streaming'],
    ['requires_action', 'needs_permission'], ['error', 'error'],
  ])('chatStatusOf_eachState_mapsAsSpecified (%s)', (state, expected) => {
    expect(chatStatusOf(state)).toBe(expected);
  });
});

describe('snapshotEvents', () => {
  const permission = { requestId: 'p1', toolUseId: 't1', toolName: 'Bash', input: {}, description: null, requiresUserInteraction: false, displayName: null } as PermissionRequest;
  const elicitation = { requestId: 'e1' } as unknown as ElicitationRequest;

  it('snapshotEvents_permissionAndElicitation_inOrder', () => {
    const events = snapshotEvents(snapshot({ pending: [{ kind: 'elicitation', request: elicitation }, { kind: 'permission', request: permission }] }));
    expect(events).toEqual([{ kind: 'elicitation_request', request: elicitation }, { kind: 'permission_request', request: permission }]);
  });

  it('snapshotEvents_queue_appendsQueueChanged', () => {
    const queue = [{ id: 'q1', text: 'hola', attachments: [] }];
    const events = snapshotEvents(snapshot({ pending: [{ kind: 'permission', request: permission }], queue }));
    expect(events).toEqual([{ kind: 'permission_request', request: permission }, { kind: 'queue_changed', queue }]);
  });

  it('snapshotEvents_empty_returnsEmpty', () => {
    expect(snapshotEvents(snapshot())).toEqual([]);
  });
});
