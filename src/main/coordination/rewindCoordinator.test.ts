import { describe, expect, it, vi } from 'vitest';
import type { TranscriptEntry } from '@shared/transcripts';
import type { EngineRequest } from '../engine/providerAdapter';
import { RewindCoordinator, type RewindCoordinatorDeps } from './rewindCoordinator';
import type { EngineResponse, RewindContext } from './sessionCoordinator';

// ---------------------------------------------------------------- Fabricas

type Block = Record<string, unknown>;

function entry(kind: string, uuid: string, content: string | Block[]): TranscriptEntry {
  return {
    index: 0, uuid, parentUuid: null, isSidechain: false, isMeta: false, timestampMs: null, category: 'turn', kind, summary: '', tokenUsage: null,
    raw: { type: kind, uuid, message: { role: kind, content } },
  };
}

const user = (uuid: string, text: string) => entry('user', uuid, text);
const assistant = (uuid: string) => entry('assistant', uuid, [{ type: 'text', text: 'ok' }]);
const BRANCH = [user('p1', 'uno'), assistant('a1'), user('p2', 'dos'), assistant('a2')];

const item = (id: string, text: string, clientId?: string) => ({ type: 'userMessage', id, ...(clientId === undefined ? {} : { clientId }), content: [{ type: 'text', text }] });
const TURNS = [
  { id: 't1', items: [item('i1', 'uno', 'c1'), { type: 'agentMessage', id: 'x1', text: 'ok' }] },
  { id: 't2', items: [item('i2', 'dos', 'c2'), item('i3', 'directo', 'c3')] },
];

const ok = (result: unknown): EngineResponse => ({ kind: 'engine_response', requestId: 'r', ok: true, result, error: null });
const fail = (error: string): EngineResponse => ({ kind: 'engine_response', requestId: 'r', ok: false, result: null, error });

const CLAUDE_CTX: RewindContext = {
  provider: 'claude', accountDir: '/acc', cwd: '/cwd', nativeId: 'nat', busy: false, background: false, queueLength: 0, pendingCount: 0, historyMode: null,
};
const CODEX_CTX: RewindContext = { ...CLAUDE_CTX, provider: 'codex', nativeId: 'thread-1', historyMode: 'paginated' };

type Handler = (request: EngineRequest) => EngineResponse;

interface Options {
  readonly ctx?: RewindContext;
  readonly handler?: Handler;
  readonly idleRejects?: boolean;
  readonly branch?: readonly TranscriptEntry[];
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const requests: EngineRequest[] = [];
  const handler: Handler = options.handler ?? (() => ok({}));
  const coordinator = {
    rewindContext: () => options.ctx ?? CLAUDE_CTX,
    engineRequest: vi.fn(async (_id: string, request: EngineRequest) => {
      calls.push(`engine:${request.kind}`);
      requests.push(request);
      return handler(request);
    }),
    waitForIdle: vi.fn(async () => {
      calls.push('waitForIdle');
      if (options.idleRejects === true) throw new Error('idle_timeout');
    }),
    returnQueueToDrafts: vi.fn(() => {
      calls.push('returnQueue');
      return [];
    }),
    announce: vi.fn(() => { calls.push('announce'); }),
    interrupt: vi.fn(() => {
      calls.push('interrupt');
      return [];
    }),
    send: vi.fn(() => ({ status: 'sent', commandId: 'cmd-1' }) as never),
  };
  const state = { pendingCut: vi.fn(() => null), setPendingCut: vi.fn(), recordFork: vi.fn(), recordCopy: vi.fn() };
  const readClaudeBranch = vi.fn(async () => options.branch ?? BRANCH);
  const deps: RewindCoordinatorDeps = { coordinator, readClaudeBranch, state, newId: () => 'cmd-1', now: () => 1234, log: vi.fn() };
  return { rc: new RewindCoordinator(deps), calls, requests, coordinator, state, readClaudeBranch, log: deps.log };
}

// Respuestas por tipo de peticion; lo no indicado devuelve ok vacio.
function byKind(map: Partial<Record<EngineRequest['kind'], (request: EngineRequest) => EngineResponse>>): Handler {
  return (request) => map[request.kind]?.(request) ?? ok({});
}

const codexHandler = (extra: Parameters<typeof byKind>[0] = {}): Handler => byKind({ thread_turns: () => ok({ data: TURNS, nextCursor: null }), ...extra });
const claudePoint = (nativeId: string, userIndex = 0) => ({ userIndex, text: '', nativeId });
const planParams = (nativeId: string, action: 'rewind' | 'retry' | 'diverge' = 'rewind') => ({ sessionId: 's1', point: claudePoint(nativeId), action });
const applyParams = (nativeId: string, over: Record<string, unknown> = {}) => ({
  sessionId: 's1', point: claudePoint(nativeId), action: 'rewind' as const, restoreFiles: false, saveCopy: false, ...over,
});

// ---------------------------------------------------------------- plan

describe('plan', () => {
  it('plan_claude_resolvesPointAndFilesDryRun', async () => {
    const { rc, requests } = setup({ handler: byKind({ rewind_files: () => ok({ canRewind: true, filesChanged: ['a.ts'], insertions: 3, deletions: 1 }) }) });

    const plan = await rc.plan(planParams('p2'));

    expect(requests).toEqual([{ kind: 'rewind_files', userMessageUuid: 'p2', dryRun: true }]);
    expect(plan).toMatchObject({ unavailable: null, discardedMessages: 1, recoverable: true, canSaveCopy: false, turnRunning: false });
    expect(plan.files).toEqual({ available: true, changed: ['a.ts'], insertions: 3, deletions: 1 });
  });

  it('plan_claudeFilesNotRewindable_filesUnavailable', async () => {
    const { rc } = setup({ handler: byKind({ rewind_files: () => ok({ canRewind: false }) }) });

    const plan = await rc.plan(planParams('p1'));

    expect(plan.files).toEqual({ available: false, changed: [], insertions: 0, deletions: 0 });
    expect(plan.discardedMessages).toBe(2);
  });

  it('plan_codexLegacy_unavailableLegacy', async () => {
    const { rc, calls } = setup({ ctx: { ...CODEX_CTX, historyMode: 'legacy' } });

    const plan = await rc.plan(planParams('c1'));

    expect(plan.unavailable).toBe('legacy');
    expect(calls).toEqual([]);
  });

  it('plan_background_unavailableBackground', async () => {
    const { rc } = setup({ ctx: { ...CLAUDE_CTX, background: true } });

    expect((await rc.plan(planParams('p1'))).unavailable).toBe('background');
  });

  it('plan_agy_unsupported', async () => {
    const { rc } = setup({ ctx: { ...CLAUDE_CTX, provider: 'agy' } });

    expect((await rc.plan(planParams('p1'))).unavailable).toBe('unsupported');
  });

  it('plan_codexSteerBubble_midTurn', async () => {
    const { rc } = setup({ ctx: CODEX_CTX, handler: codexHandler() });

    const plan = await rc.plan(planParams('c3'));

    expect(plan.unavailable).toBe('midTurn');
  });

  it('plan_divergeBusy_unavailableBusy', async () => {
    const { rc } = setup({ ctx: { ...CLAUDE_CTX, busy: true } });

    expect((await rc.plan(planParams('p1', 'diverge'))).unavailable).toBe('busy');
  });

  it('plan_codexRewind_canSaveCopyAndNoFiles', async () => {
    const { rc } = setup({ ctx: CODEX_CTX, handler: codexHandler() });

    const plan = await rc.plan(planParams('c2'));

    expect(plan).toMatchObject({ unavailable: null, files: null, recoverable: false, canSaveCopy: true, discardedMessages: 2 });
  });
});

// ---------------------------------------------------------------- apply (Claude)

describe('apply Claude', () => {
  it('apply_claudeIdle_rewindsConversationAndStoresCut', async () => {
    const { rc, requests, state } = setup({ handler: byKind({ rewind_conversation: () => ok({ rewound: true, prefillText: 'dos!' }) }) });

    const result = await rc.apply(applyParams('p2'));

    expect(requests).toEqual([{ kind: 'rewind_conversation', targetUuid: 'p2', lastSeenUuid: 'p2' }]);
    expect(state.setPendingCut).toHaveBeenCalledWith('nat', 'p2');
    expect(result).toMatchObject({ draft: 'dos!', filesRestored: false, copyThreadId: null, retried: null });
  });

  it('apply_claudeBusy_returnsQueueInterruptsThenRewinds', async () => {
    const { rc, calls } = setup({ ctx: { ...CLAUDE_CTX, busy: true }, handler: byKind({ rewind_conversation: () => ok({ rewound: true }) }) });

    await rc.apply(applyParams('p2', { restoreFiles: true }));

    expect(calls).toEqual(['returnQueue', 'interrupt', 'waitForIdle', 'engine:rewind_files', 'engine:rewind_conversation', 'announce']);
  });

  it('apply_turnDoesNotStop_throwsAndDoesNotRewind', async () => {
    const { rc, calls } = setup({ ctx: { ...CLAUDE_CTX, busy: true }, idleRejects: true });

    await expect(rc.apply(applyParams('p2'))).rejects.toMatchObject({ localized: { key: 'errors.rewind.turnDidNotStop' } });

    expect(calls).toEqual(['returnQueue', 'interrupt', 'waitForIdle']);
  });

  it('apply_claudeFilesFail_throwsAndConversationUntouched', async () => {
    const { rc, calls } = setup({ handler: byKind({ rewind_files: () => fail('boom') }) });

    await expect(rc.apply(applyParams('p2', { restoreFiles: true }))).rejects.toMatchObject({ localized: { key: 'errors.rewind.filesFailed', values: { detail: 'boom' } } });

    expect(calls).toEqual(['returnQueue', 'engine:rewind_files']);
  });

  it('apply_claudeConversationFailsAfterFiles_saysFilesRestored', async () => {
    const { rc } = setup({ handler: byKind({ rewind_conversation: () => ok({ rewound: false, reason: 'stale_target' }) }) });

    await expect(rc.apply(applyParams('p2', { restoreFiles: true }))).rejects.toMatchObject({
      localized: { key: 'errors.rewind.conversationFailedFilesRestored', values: { detail: 'stale_target' } },
    });
  });

  it('apply_claudeProjectionReadWithNewCut', async () => {
    const { rc, readClaudeBranch } = setup({ handler: byKind({ rewind_conversation: () => ok({ rewound: true }) }) });

    const result = await rc.apply(applyParams('p2'));

    expect(readClaudeBranch).toHaveBeenLastCalledWith({ accountDir: '/acc', cwd: '/cwd', sessionId: 'nat', pendingCutUuid: 'p2' });
    expect(result.projection).toMatchObject({ reset: true, isFinal: true, errors: [] });
    expect(result.projection?.entries).toHaveLength(BRANCH.length);
  });

  it('apply_claudeProjectionReadFails_projectionNullAndWarns', async () => {
    const { rc, readClaudeBranch, log } = setup({ handler: byKind({ rewind_conversation: () => ok({ rewound: true }) }) });
    readClaudeBranch.mockResolvedValueOnce(BRANCH).mockRejectedValueOnce(new Error('disco'));

    const result = await rc.apply(applyParams('p2'));

    expect(result.projection).toBeNull();
    expect(log).toHaveBeenCalledWith('warn', expect.any(String), { error: 'disco' });
  });

  it('apply_retry_sendsSameTextAndEmptyDraft', async () => {
    const { rc, coordinator } = setup({ handler: byKind({ rewind_conversation: () => ok({ rewound: true, prefillText: 'dos' }) }) });
    const images = [{ mediaType: 'image/png' as const, data: 'AAA' }];

    const result = await rc.apply(applyParams('p2', { action: 'retry', attachments: images }));

    expect(coordinator.send).toHaveBeenCalledWith({ sessionId: 's1', text: 'dos', attachments: images, commandId: 'cmd-1' });
    expect(result.draft).toBe('');
    expect(result.retried).toEqual({ status: 'sent', commandId: 'cmd-1' });
  });

  it('apply_announcesConversationRewound', async () => {
    const { rc, coordinator } = setup({ handler: byKind({ rewind_conversation: () => ok({ rewound: true }) }) });

    await rc.apply(applyParams('p2'));

    expect(coordinator.announce).toHaveBeenCalledWith('s1', { kind: 'conversation_rewound', targetNativeId: 'p2', action: 'rewind' });
  });
});

// ---------------------------------------------------------------- apply (Codex)

describe('apply Codex', () => {
  it('apply_codexSaveCopy_forksThenReverts', async () => {
    const { rc, requests, state } = setup({ ctx: CODEX_CTX, handler: codexHandler({ thread_fork: () => ok({ thread: { id: 'copy-1' } }) }) });

    const result = await rc.apply(applyParams('c2', { saveCopy: true }));

    expect(requests.filter((r) => r.kind !== 'thread_turns')).toEqual([{ kind: 'thread_fork', lastTurnId: 't2' }, { kind: 'thread_revert', beforeTurnId: 't2' }]);
    expect(state.recordCopy).toHaveBeenCalledWith('copy-1', 'thread-1', 1234);
    expect(result).toMatchObject({ copyThreadId: 'copy-1', draft: 'dos' });
  });

  it('apply_codexCopyFails_doesNotRevert', async () => {
    const { rc, requests } = setup({ ctx: CODEX_CTX, handler: codexHandler({ thread_fork: () => fail('nope') }) });

    await expect(rc.apply(applyParams('c2', { saveCopy: true }))).rejects.toMatchObject({ localized: { key: 'errors.rewind.copyFailed' } });

    expect(requests.map((r) => r.kind)).not.toContain('thread_revert');
  });

  it('apply_codexRevertLegacyError_throwsLegacy', async () => {
    const { rc } = setup({ ctx: CODEX_CTX, handler: codexHandler({ thread_revert: () => fail('thread/revert only supports paginated history') }) });

    await expect(rc.apply(applyParams('c2'))).rejects.toMatchObject({ localized: { key: 'errors.rewind.legacy' } });
  });

  it('apply_codexRevertOtherError_throwsConversationFailed', async () => {
    const { rc } = setup({ ctx: CODEX_CTX, handler: codexHandler({ thread_revert: () => fail('otro') }) });

    await expect(rc.apply(applyParams('c2'))).rejects.toMatchObject({ localized: { key: 'errors.rewind.conversationFailed', values: { detail: 'otro' } } });
  });

  it('apply_codexProjectionFromLiveTurns', async () => {
    const { rc, requests } = setup({ ctx: CODEX_CTX, handler: codexHandler() });

    const result = await rc.apply(applyParams('c2'));

    expect(requests.map((r) => r.kind)).toEqual(['thread_turns', 'thread_revert', 'thread_turns']);
    expect(result.projection).toMatchObject({ reset: true, isFinal: true });
    expect(result.projection?.entries.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- diverge

describe('diverge', () => {
  it('diverge_claude_returnsForkLeaf', async () => {
    const { rc } = setup();

    const result = await rc.diverge({ sessionId: 's1', point: claudePoint('p1') });

    expect(result).toEqual({ kind: 'claude', forkFrom: { sessionId: 'nat', atUuid: 'a1' } });
  });

  it('diverge_codex_forksAndRecordsFork', async () => {
    const { rc, requests, state } = setup({ ctx: CODEX_CTX, handler: codexHandler({ thread_fork: () => ok({ thread: { id: 'child-1' } }) }) });

    const result = await rc.diverge({ sessionId: 's1', point: claudePoint('c1') });

    expect(requests.at(-1)).toEqual({ kind: 'thread_fork', lastTurnId: 't1' });
    expect(state.recordFork).toHaveBeenCalledWith('child-1', 'thread-1', 'codex', 1234);
    expect(result).toEqual({ kind: 'codex', threadId: 'child-1' });
  });

  it('diverge_codexForkFails_throwsForkFailed', async () => {
    const { rc } = setup({ ctx: CODEX_CTX, handler: codexHandler({ thread_fork: () => fail('no') }) });

    await expect(rc.diverge({ sessionId: 's1', point: claudePoint('c1') })).rejects.toMatchObject({ localized: { key: 'errors.rewind.forkFailed' } });
  });

  it('diverge_busy_throwsBusy', async () => {
    const { rc } = setup({ ctx: { ...CLAUDE_CTX, busy: true } });

    await expect(rc.diverge({ sessionId: 's1', point: claudePoint('p1') })).rejects.toMatchObject({ localized: { key: 'errors.rewind.busy' } });
  });
});

// ---------------------------------------------------------------- listCodexTurns

describe('listCodexTurns', () => {
  it('listCodexTurns_paginates', async () => {
    const cursors: (string | null)[] = [];
    const handler = byKind({
      thread_turns: (request) => {
        const cursor = request.kind === 'thread_turns' ? request.cursor : null;
        cursors.push(cursor);
        return cursor === null ? ok({ data: [TURNS[0]], nextCursor: 'next' }) : ok({ data: [TURNS[1]], nextCursor: null });
      },
    });
    const { rc } = setup({ ctx: CODEX_CTX, handler });

    const plan = await rc.plan(planParams('c2'));

    expect(cursors).toEqual([null, 'next']);
    expect(plan.discardedMessages).toBe(2);
  });

  it('listCodexTurns_cursorLoop_stopsAtCap', async () => {
    const handler = byKind({ thread_turns: () => ok({ data: [], nextCursor: 'same' }) });
    const { rc, coordinator } = setup({ ctx: CODEX_CTX, handler });

    await expect(rc.plan(planParams('c1'))).rejects.toThrow(/thread_turns: mas de 1000 paginas/);

    expect(coordinator.engineRequest).toHaveBeenCalledTimes(1000);
  });

  it('listCodexTurns_badShape_throwsWithDetail', async () => {
    const { rc } = setup({ ctx: CODEX_CTX, handler: byKind({ thread_turns: () => ok({ data: 'x' }) }) });

    await expect(rc.plan(planParams('c1'))).rejects.toThrow(/thread_turns: respuesta inesperada \(data/);
  });
});
