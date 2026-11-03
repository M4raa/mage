import { describe, expect, it } from 'vitest';
import type { ConversationSnapshot, CoordinatedState, PendingRequest } from '@shared/coordination';
import type { MageEvent, PermissionRequest } from '@shared/events';
import type { SequencedSessionEvent, SessionListener } from '../coordination/sessionCoordinator';
import { DelegationLog, MAX_ANNOUNCED_TEXT_CHARS, MAX_MESSAGES_PER_SESSION, mcpStateOf } from './delegationLog';
import type { DelegatedSession } from './delegationLog';

const QUESTION_INPUT = { questions: [{ question: '¿Rojo o azul?', header: 'Color', options: [{ label: 'Rojo', description: '' }], multiSelect: false }] };
const permissionRequest = (input: Record<string, unknown> = { command: 'ls' }): PermissionRequest => (
  { requestId: 'r1', toolUseId: 't1', toolName: 'Bash', input, description: null, requiresUserInteraction: false, displayName: null });
const permission = (input?: Record<string, unknown>): PendingRequest => ({ kind: 'permission', request: permissionRequest(input) });
const elicitation = { kind: 'elicitation', request: { requestId: 'e1' } } as unknown as PendingRequest;
const snap = (state: CoordinatedState, pending: readonly PendingRequest[] = []): ConversationSnapshot => (
  { sessionId: 'child', provider: 'claude', conversationId: 'conv-child', nativeRef: null, lastSeq: 0, state, queue: [], pending, background: false });

const CHILD: DelegatedSession = {
  sessionId: 'child', conversationId: 'conv-child', creatorSessionId: 'parent', creatorConversationId: 'conv-parent', title: 't', provider: 'claude',
  accountId: 'a', projectId: 'p', createdBy: { conversationId: 'conv-parent', requestId: '11111111-1111-4111-8111-111111111111', at: '2026-11-03T10:00:00.000Z' }, creatorChain: ['conv-parent'],
};

function setup(options: { creatorAlive?: boolean } = {}) {
  let current = snap('idle');
  let listener: SessionListener | null = null;
  let unsubscribed = 0;
  const announced: MageEvent[] = [];
  const coordinator = {
    subscribe: (_id: string, l: SessionListener) => { listener = l; return { snapshot: current, unsubscribe: () => { unsubscribed += 1; } }; },
    snapshot: () => current,
    announce: (_id: string, event: MageEvent) => { announced.push(event); },
    ownerOf: () => (options.creatorAlive === false ? undefined : 1),
  };
  const log = new DelegationLog({ coordinator, now: () => Date.parse('2026-11-03T10:00:00.000Z') });
  const emit = (event: MageEvent, next?: ConversationSnapshot) => {
    if (next !== undefined) current = next;
    const payload: SequencedSessionEvent = { sessionId: 'child', event, conversationId: 'conv-child', seq: 1, at: Date.parse('2026-11-03T10:05:00.000Z') };
    listener?.sink(payload);
  };
  return { log, emit, announced, close: () => listener?.onClosed(), unsubscribed: () => unsubscribed };
}
const result = { kind: 'result', result: {} } as unknown as MageEvent;

describe('mcpStateOf', () => {
  it.each([
    ['closed', null, true, 0, 'interrupted'],
    ['snapshotNull', null, false, 0, 'interrupted'],
    ['elicitation', snap('requires_action', [elicitation]), false, 1, 'waiting_answer'],
    ['questionPermission', snap('requires_action', [permission(QUESTION_INPUT)]), false, 1, 'waiting_answer'],
    ['otherPermission', snap('requires_action', [permission()]), false, 1, 'permission_pending'],
    ['running', snap('running'), false, 0, 'working'],
    ['starting', snap('starting'), false, 0, 'working'],
    ['requiresActionWithoutPending', snap('requires_action'), false, 0, 'permission_pending'],
    ['error', snap('error'), false, 1, 'interrupted'],
    ['idleWithTurns', snap('idle'), false, 1, 'done'],
    ['idleWithoutTurns', snap('idle'), false, 0, 'working'],
  ] as const)('mcpStateOf_eachCase_asSpecified_%s', (_name, snapshot, closed, turnCount, expected) => {
    expect(mcpStateOf({ snapshot, closed, turnCount })).toBe(expected);
  });
});

describe('DelegationLog', () => {
  it('watch_assistantThenResult_messageAndResultAnnounced', () => {
    const { log, emit, announced } = setup();
    log.watch(CHILD);
    emit({ kind: 'assistant_text', text: 'hecho' }, snap('running'));
    emit(result, snap('idle'));
    expect(log.messagesAfter('conv-child', 0)).toEqual([{ seq: 1, role: 'assistant', text: 'hecho' }]);
    expect(log.get('conv-child')).toMatchObject({ state: 'done', turnCount: 1, lastEventAt: '2026-11-03T10:05:00.000Z' });
    expect(announced).toContainEqual({ kind: 'delegation_message', fromId: 'conv-child', toId: 'conv-parent', messageKind: 'result', text: 'hecho' });
  });
  it('watch_question_waitingAnswerAndQuestionAnnounced', () => {
    const { log, emit, announced } = setup();
    log.watch(CHILD);
    const pending = permission(QUESTION_INPUT);
    emit({ kind: 'permission_request', request: permissionRequest(QUESTION_INPUT) }, snap('requires_action', [pending]));
    expect(log.messagesAfter('conv-child', 0)).toEqual([{ seq: 1, role: 'question', text: '¿Rojo o azul?' }]);
    expect(log.get('conv-child')?.state).toBe('waiting_answer');
    expect(announced).toContainEqual({ kind: 'delegation_message', fromId: 'conv-child', toId: 'conv-parent', messageKind: 'question', text: '¿Rojo o azul?' });
  });
  it('watch_stateChange_delegationStateAnnouncedOnce', () => {
    const { log, emit, announced } = setup();
    log.watch(CHILD);
    const pending = permission();
    emit({ kind: 'thinking_delta', text: 'a' }, snap('requires_action', [pending]));
    emit({ kind: 'thinking_delta', text: 'b' }, snap('requires_action', [pending]));
    expect(announced).toEqual([{ kind: 'delegation_state', childId: 'conv-child', state: 'permission_pending' }]);
  });
  it('watch_creatorGone_noAnnounceNoThrow', () => {
    const { log, emit, announced } = setup({ creatorAlive: false });
    log.watch(CHILD);
    expect(() => { emit({ kind: 'assistant_text', text: 'x' }, snap('running')); emit(result, snap('idle')); }).not.toThrow();
    expect(announced).toEqual([]);
  });
  it('watch_closed_interruptedAndWatchCountZero', () => {
    const { log, close, unsubscribed } = setup();
    log.watch(CHILD);
    expect(log.watchCount('child')).toBe(1);
    close();
    expect(log.get('conv-child')).toMatchObject({ state: 'interrupted', closed: true });
    expect(log.watchCount('child')).toBe(0);
    expect(unsubscribed()).toBe(1);
  });
  it('watch_duplicate_throws', () => {
    const { log } = setup();
    log.watch(CHILD);
    expect(() => log.watch(CHILD)).toThrow('child');
  });
  it('messages_overLimit_oldestDroppedSeqKeepsGrowing', () => {
    const { log } = setup();
    log.watch(CHILD);
    for (let i = 0; i < MAX_MESSAGES_PER_SESSION + 2; i += 1) log.recordInstruction('child', `m${i}`);
    const messages = log.messagesAfter('conv-child', 0);
    expect(messages).toHaveLength(MAX_MESSAGES_PER_SESSION);
    expect(messages[0]?.seq).toBe(3);
    expect(messages.at(-1)?.seq).toBe(MAX_MESSAGES_PER_SESSION + 2);
  });
  it('recordInstruction_unknownSession_throws', () => {
    expect(() => setup().log.recordInstruction('nope', 'x')).toThrow('nope');
  });
  it('messagesAfter_afterSeq_exclusive', () => {
    const { log } = setup();
    log.watch(CHILD);
    log.recordInstruction('child', 'a');
    log.recordInstruction('child', 'b');
    expect(log.messagesAfter('conv-child', 1).map((m) => m.text)).toEqual(['b']);
  });
  it('result_longAssistantText_announcedTruncated', () => {
    const { log, emit, announced } = setup();
    log.watch(CHILD);
    emit({ kind: 'assistant_text', text: 'x'.repeat(MAX_ANNOUNCED_TEXT_CHARS + 50) }, snap('running'));
    emit(result, snap('idle'));
    const message = announced.find((e) => e.kind === 'delegation_message');
    expect(message).toMatchObject({ messageKind: 'result' });
    expect((message as { text: string }).text).toHaveLength(MAX_ANNOUNCED_TEXT_CHARS);
  });
});
