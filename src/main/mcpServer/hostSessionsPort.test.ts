import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AnswerReceipt, ConversationSnapshot, CoordinatedState, PendingRequest, SendReceipt } from '@shared/coordination';
import type { MageEvent, PermissionDecision, PermissionRequest } from '@shared/events';
import type { ProviderModel } from '@shared/providers';
import type { SessionListener } from '../coordination/sessionCoordinator';
import { TrustRequiredError, UnknownAccountError } from '../host/hostErrors';
import type { SessionSettings } from './delegatedSettings';
import type { DelegatedSession, DelegationView } from './delegationLog';
import { CONVERSATION_ID_TIMEOUT_MS, ExternalSessionsPort, HostSessionsPort, NO_PROJECT_ID } from './hostSessionsPort';
import type { HostSessionsPortDeps } from './hostSessionsPort';
import { MageToolHandlers } from './handlers';
import { MemoryIdempotencyStore } from './idempotencyStore';
import { snapshotScope } from './scope';
import type { CreateSessionCommand } from './sessionsPort';

const CWD = resolve('/work/proj');
const REQUEST = '11111111-1111-4111-8111-111111111111';
const AT = '2026-11-03T10:00:00.000Z';
const QUESTION_INPUT = { questions: [{ question: '¿Rojo o azul?', header: 'Color', options: [{ label: 'Rojo', description: '' }], multiSelect: false }] };
const permissionRequest = (input: Record<string, unknown> = { command: 'ls' }): PermissionRequest => (
  { requestId: 'perm1', toolUseId: 't', toolName: 'Bash', input, description: null, requiresUserInteraction: false, displayName: null });
const permission = (input?: Record<string, unknown>): PendingRequest => ({ kind: 'permission', request: permissionRequest(input) });
const elicitation = { kind: 'elicitation', request: { requestId: 'e1' } } as unknown as PendingRequest;
const snap = (conversationId: string | null, state: CoordinatedState = 'idle', pending: readonly PendingRequest[] = []): ConversationSnapshot => (
  { sessionId: 'child-s', provider: 'claude', conversationId, nativeRef: null, lastSeq: 0, state, queue: [], pending, background: false });

const child = (overrides: Partial<DelegatedSession> = {}): DelegatedSession => ({
  sessionId: 'child-s', conversationId: 'child-c', creatorSessionId: 'caller-s', creatorConversationId: 'caller-c', title: 't', provider: 'claude', accountId: 'acc1',
  projectId: 'p1', createdBy: { conversationId: 'caller-c', requestId: REQUEST, at: AT }, creatorChain: ['caller-c'], ...overrides,
});
const view = (overrides: Partial<DelegationView> & { child?: DelegatedSession } = {}): DelegationView => (
  { child: child(), state: 'working', turnCount: 0, lastEventAt: AT, closed: false, ...overrides });

function setup(options: {
  views?: DelegationView[]; snapshot?: ConversationSnapshot; launch?: HostSessionsPortDeps['launch']; accounts?: HostSessionsPortDeps['accounts'];
  log?: Partial<HostSessionsPortDeps['log']>; creator?: SessionSettings | null; catalog?: readonly ProviderModel[];
} = {}) {
  const views = options.views ?? [view()];
  const listeners: SessionListener[] = [];
  const announced: { sessionId: string; event: MageEvent }[] = [];
  const answers: { requestId: string; decision: PermissionDecision }[] = [];
  const cancelTimer = vi.fn();
  const timers: { fn: () => void; ms: number }[] = [];
  const deps = {
    caller: { sessionId: 'caller-s', conversationId: 'caller-c', accountId: 'acc1' },
    log: {
      watch: vi.fn(), recordInstruction: vi.fn(), messagesAfter: vi.fn(() => []),
      get: (id: string) => views.find((v) => v.child.conversationId === id) ?? null, list: () => views,
      recordQuestion: vi.fn((): 'recorded' | 'creator_closed' => 'recorded'), settleQuestion: vi.fn(() => false),
      ...options.log,
    },
    index: { recordDelegation: vi.fn() },
    coordinator: {
      subscribe: vi.fn((_id: string, listener: SessionListener) => { listeners.push(listener); return { snapshot: options.snapshot ?? snap(null), unsubscribe: vi.fn() }; }),
      snapshot: vi.fn(() => options.snapshot ?? snap('child-c')),
      send: vi.fn((): SendReceipt => ({ status: 'accepted', commandId: REQUEST })),
      interrupt: vi.fn(() => []),
      answerPermission: vi.fn((_s: string, requestId: string, decision: PermissionDecision): AnswerReceipt => { answers.push({ requestId, decision }); return { status: 'accepted' }; }),
      announce: vi.fn((sessionId: string, event: MageEvent) => { announced.push({ sessionId, event }); }),
    },
    accounts: options.accounts ?? (() => [{ id: 'acc1', provider: 'claude' }, { id: 'acc2', provider: 'codex' }, { id: 'acc3', provider: 'codex' }]),
    projects: () => [{ id: 'p1', cwd: CWD }, { id: 'p2', cwd: null }],
    launch: options.launch ?? vi.fn(() => 'child-s'),
    setTimer: vi.fn((fn: () => void, ms: number) => { timers.push({ fn, ms }); return cancelTimer; }),
    creatorSettings: vi.fn(() => options.creator ?? null),
    modelCatalog: vi.fn(() => options.catalog ?? []),
    setPermissionMode: vi.fn(),
  };
  return { port: new HostSessionsPort(deps), deps, listeners, announced, answers, timers, cancelTimer };
}
const command = (overrides: Partial<CreateSessionCommand> = {}): CreateSessionCommand => ({
  target: { projectId: 'p1', accountId: 'acc1', provider: 'claude', cwd: CWD }, prompt: 'Haz algo\nsegunda línea', requestId: REQUEST,
  createdBy: { conversationId: 'caller-c', requestId: REQUEST, at: AT }, creatorChain: ['caller-c'], ...overrides,
});
const sendInput = (mode: 'direct' | 'queue' = 'queue') => ({ requestId: REQUEST, conversationId: 'child-c', text: 'sí', mode });

describe('HostSessionsPort.resolveCreationTarget', () => {
  it('resolveCreationTarget_relativeCwd_invalidCwd', async () => {
    await expect(setup().port.resolveCreationTarget({ provider: 'claude', cwd: 'rel/dir' })).rejects.toThrow('invalid_cwd: rel/dir');
  });
  it('resolveCreationTarget_explicitAccountOtherProvider_unknownAccount', async () => {
    await expect(setup().port.resolveCreationTarget({ provider: 'claude', accountId: 'acc2', cwd: CWD })).rejects.toThrow('unknown_account: acc2');
  });
  it('resolveCreationTarget_noAccount_callerAccountIfSameProvider', async () => {
    expect(await setup().port.resolveCreationTarget({ provider: 'claude', cwd: CWD })).toMatchObject({ accountId: 'acc1' });
  });
  it('resolveCreationTarget_noAccountOtherProvider_firstOfProvider', async () => {
    expect(await setup().port.resolveCreationTarget({ provider: 'codex', cwd: CWD })).toMatchObject({ accountId: 'acc2', provider: 'codex' });
  });
  it('resolveCreationTarget_noAccountsOfProvider_noAccount', async () => {
    const { port } = setup({ accounts: () => [{ id: 'acc1', provider: 'claude' }] });
    await expect(port.resolveCreationTarget({ provider: 'codex', cwd: CWD })).rejects.toThrow('no_account: codex');
  });
  it('resolveCreationTarget_cwdOfProject_projectId', async () => {
    expect(await setup().port.resolveCreationTarget({ provider: 'claude', cwd: CWD })).toMatchObject({ projectId: 'p1' });
  });
  it('resolveCreationTarget_otherCwd_none', async () => {
    expect(await setup().port.resolveCreationTarget({ provider: 'claude', cwd: resolve('/elsewhere') })).toMatchObject({ projectId: NO_PROJECT_ID });
  });
});

describe('HostSessionsPort.createSession', () => {
  it('createSession_launchesWithCreatorAndRecordsDelegation', async () => {
    const { port, deps, announced } = setup({ snapshot: snap('child-c') });
    const result = await port.createSession(command({ model: 'm1' }));
    expect(result).toEqual({ conversationId: 'child-c', state: 'running' });
    expect(deps.launch).toHaveBeenCalledWith(
      { commandId: REQUEST, provider: 'claude', accountId: 'acc1', cwd: CWD, model: 'm1', permissionMode: 'default', trust: { acknowledged: false } }, { conversationId: 'caller-c', sessionId: 'caller-s' });
    expect(deps.index.recordDelegation).toHaveBeenCalledWith('child-c', { createdBy: command().createdBy, creatorChain: ['caller-c'] });
    expect(deps.log.watch).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'child-s', conversationId: 'child-c', creatorSessionId: 'caller-s', title: 'Haz algo' }));
    expect(deps.coordinator.send).toHaveBeenCalledWith({ sessionId: 'child-s', text: 'Haz algo\nsegunda línea', commandId: REQUEST });
    expect(announced).toEqual([
      { sessionId: 'caller-s', event: { kind: 'delegation_created', childId: 'child-c', requestId: REQUEST } },
      { sessionId: 'child-s', event: { kind: 'delegation_message', fromId: 'caller-c', toId: 'child-c', messageKind: 'instruction', text: 'Haz algo\nsegunda línea' } },
    ]);
  });
  it('createSession_sinParametros_lanzaConLoHeredadoDeLaCreadora', async () => {
    const creator = { provider: 'claude', model: 'sonnet', effort: 'high', permissionMode: 'plan' };
    const { port, deps } = setup({ snapshot: snap('child-c'), creator });
    await port.createSession(command());
    expect(deps.launch).toHaveBeenCalledWith(expect.objectContaining({ model: 'sonnet', effort: 'high', permissionMode: 'plan' }), expect.anything());
    expect(deps.setPermissionMode).not.toHaveBeenCalled();
  });
  it('createSession_modoMasPermisivoQueLaCreadora_rechazaSinLanzarNiEnviar', async () => {
    const { port, deps } = setup({ snapshot: snap('child-c'), creator: { provider: 'claude', permissionMode: 'default' } });
    await expect(port.createSession(command({ permissionMode: 'bypassPermissions' }))).rejects.toThrow(/^permission_mode_exceeds_creator:/);
    expect(deps.launch).not.toHaveBeenCalled();
    expect(deps.coordinator.send).not.toHaveBeenCalled();
  });
  it('createSession_haciaCodex_modoTraducidoAntesDelPrimerMensaje', async () => {
    const creator = { provider: 'claude', model: 'sonnet', effort: 'high', permissionMode: 'plan' };
    const { port, deps } = setup({ snapshot: snap('child-c'), creator });
    await port.createSession(command({ target: { projectId: 'p1', accountId: 'acc2', provider: 'codex', cwd: CWD } }));
    const launched = vi.mocked(deps.launch).mock.calls[0]?.[0];
    expect(launched).not.toHaveProperty('model');
    expect(launched).not.toHaveProperty('effort');
    expect(launched).not.toHaveProperty('permissionMode');
    expect(deps.setPermissionMode).toHaveBeenCalledWith('child-s', ':read-only|never');
    const modeOrder = vi.mocked(deps.setPermissionMode).mock.invocationCallOrder[0] as number;
    const sendOrder = vi.mocked(deps.coordinator.send).mock.invocationCallOrder[0] as number;
    expect(modeOrder).toBeLessThan(sendOrder);
  });
  it('createSession_modeloFueraDelCatalogo_rechazaSinLanzar', async () => {
    const { port, deps } = setup({ snapshot: snap('child-c'), catalog: [{ id: 'sonnet', label: 'Sonnet' }] });
    await expect(port.createSession(command({ model: 'otro' }))).rejects.toThrow(/^invalid_model: otro/);
    expect(deps.launch).not.toHaveBeenCalled();
    expect(deps.modelCatalog).toHaveBeenCalledWith('acc1');
  });
  it('createSession_trustRequired_policyError', async () => {
    const launch = () => { throw new TrustRequiredError(CWD); };
    await expect(setup({ launch }).port.createSession(command())).rejects.toThrow(`trust_required: ${CWD}`);
  });
  it('createSession_unknownAccount_policyError', async () => {
    const launch = () => { throw new UnknownAccountError('x', 'claude'); };
    await expect(setup({ launch }).port.createSession(command())).rejects.toThrow('unknown_account: x');
  });
  it('createSession_conversationIdLater_waitsForEvent', async () => {
    const { port, listeners, deps } = setup({ snapshot: snap(null) });
    const pending = port.createSession(command());
    await vi.waitFor(() => expect(listeners).toHaveLength(1));
    listeners[0]?.sink({ sessionId: 'child-s', event: { kind: 'thinking_delta', text: '' }, conversationId: 'late-c', seq: 1, at: 1 });
    expect(await pending).toEqual({ conversationId: 'late-c', state: 'running' });
    expect(deps.index.recordDelegation).toHaveBeenCalledWith('late-c', expect.anything());
  });
  it('createSession_conversationIdNever_timeoutError', async () => {
    const { port, timers, listeners } = setup({ snapshot: snap(null) });
    const pending = port.createSession(command());
    const assertion = expect(pending).rejects.toThrow('conversation_id_timeout: child-s');
    await vi.waitFor(() => expect(timers).toHaveLength(1));
    expect(timers[0]?.ms).toBe(CONVERSATION_ID_TIMEOUT_MS);
    timers[0]?.fn();
    await assertion;
    expect(listeners).toHaveLength(1);
  });
});

describe('HostSessionsPort alcance', () => {
  it('getSession_notDescendant_notFound', async () => {
    const { port } = setup({ views: [view({ child: child({ creatorChain: ['other'] }) })] });
    await expect(port.getSession('child-c')).rejects.toThrow('not_found: child-c');
    await expect(port.getSession('missing')).rejects.toThrow('not_found: missing');
  });
  it('getSession_grandchild_allowed', async () => {
    const { port } = setup({ views: [view({ child: child({ creatorChain: ['caller-c', 'middle'] }) })] });
    expect(await port.getSession('child-c')).toMatchObject({ conversationId: 'child-c', isPrivate: false, creatorChain: ['caller-c', 'middle'] });
  });
  it('listSessions_onlyDescendants', async () => {
    const mine = view();
    const foreign = view({ child: child({ conversationId: 'foreign-c', creatorChain: ['other'] }) });
    const sessions = await setup({ views: [mine, foreign] }).port.listSessions({});
    expect(sessions.map((s) => s.conversationId)).toEqual(['child-c']);
  });
});

describe('HostSessionsPort.send', () => {
  it('send_pendingQuestion_answersWithTextAndAccepted', async () => {
    const { port, answers, announced, deps } = setup({ snapshot: snap('child-c', 'requires_action', [permission(QUESTION_INPUT)]) });
    expect(await port.send(sendInput())).toEqual({ receipt: 'accepted' });
    expect(answers).toEqual([{ requestId: 'perm1', decision: { behavior: 'allow', updatedInput: { ...QUESTION_INPUT, answers: { '¿Rojo o azul?': 'sí' } } } }]);
    expect(deps.log.recordInstruction).toHaveBeenCalledWith('child-s', 'sí');
    expect(announced).toEqual([{ sessionId: 'child-s', event: { kind: 'delegation_message', fromId: 'caller-c', toId: 'child-c', messageKind: 'answer', text: 'sí' } }]);
    expect(deps.coordinator.send).not.toHaveBeenCalled();
  });
  it('send_pendingPermission_rejectedPermissionRequiresUser', async () => {
    const { port, deps } = setup({ snapshot: snap('child-c', 'requires_action', [permission()]) });
    expect(await port.send(sendInput())).toEqual({ receipt: 'rejected', reason: 'permission_requires_user' });
    expect(deps.coordinator.answerPermission).not.toHaveBeenCalled();
  });
  it('send_pendingElicitation_rejected', async () => {
    const { port } = setup({ snapshot: snap('child-c', 'requires_action', [elicitation]) });
    expect(await port.send(sendInput())).toEqual({ receipt: 'rejected', reason: 'elicitation_requires_user' });
  });
  it('send_direct_steerMode', async () => {
    const { port, deps } = setup();
    expect(await port.send(sendInput('direct'))).toEqual({ receipt: 'accepted' });
    expect(deps.coordinator.send).toHaveBeenCalledWith({ sessionId: 'child-s', text: 'sí', commandId: REQUEST, mode: 'steer' });
  });
  it('send_queue_noMode', async () => {
    const { port, deps } = setup();
    deps.coordinator.send.mockReturnValue({ status: 'queued', commandId: REQUEST });
    expect(await port.send(sendInput('queue'))).toEqual({ receipt: 'queued' });
    expect(deps.coordinator.send).toHaveBeenCalledWith({ sessionId: 'child-s', text: 'sí', commandId: REQUEST });
  });
  it('send_closed_rejected', async () => {
    const { port } = setup({ views: [view({ closed: true })] });
    expect(await port.send(sendInput())).toEqual({ receipt: 'rejected', reason: 'session_closed' });
  });
});

describe('HostSessionsPort.send con pregunta a la creadora', () => {
  it('send_childAwaitingCreator_announcesAnswer', async () => {
    const { port, deps, announced } = setup({ log: { settleQuestion: vi.fn(() => true) } });
    const outcome = await port.send(sendInput());
    expect(outcome).toEqual({ receipt: 'accepted' });
    expect(deps.coordinator.send).toHaveBeenCalled();
    expect(announced).toEqual([{ sessionId: 'child-s', event: { kind: 'delegation_message', fromId: 'caller-c', toId: 'child-c', messageKind: 'answer', text: 'sí' } }]);
  });
  it('send_childNotAwaiting_announcesInstruction', async () => {
    const { port, announced } = setup();
    await port.send(sendInput());
    expect(announced).toEqual([{ sessionId: 'child-s', event: { kind: 'delegation_message', fromId: 'caller-c', toId: 'child-c', messageKind: 'instruction', text: 'sí' } }]);
  });
});

describe('HostSessionsPort.askCreator', () => {
  const asDelegate = () => [view({ child: child({
    sessionId: 'caller-s', conversationId: 'caller-c', creatorSessionId: 'root-s', creatorConversationId: 'root-c', creatorChain: ['root-c'],
  }) })];
  const ask = { requestId: REQUEST, text: '¿Rojo?' };
  it('askCreator_callerIsDelegate_recordsQuestionAndAccepted', async () => {
    const { port, deps } = setup({ views: asDelegate() });
    const outcome = await port.askCreator(ask);
    expect(outcome).toEqual({ receipt: 'accepted' });
    expect(deps.log.recordQuestion).toHaveBeenCalledWith('caller-s', '¿Rojo?');
  });
  it('askCreator_callerNotDelegated_notDelegatedWithValue', async () => {
    const { port, deps } = setup();
    await expect(port.askCreator(ask)).rejects.toThrow('not_delegated: caller-c');
    expect(deps.log.recordQuestion).not.toHaveBeenCalled();
  });
  it('askCreator_creatorClosed_creatorClosedWithValue', async () => {
    const { port } = setup({ views: asDelegate(), log: { recordQuestion: vi.fn((): 'recorded' | 'creator_closed' => 'creator_closed') } });
    await expect(port.askCreator(ask)).rejects.toThrow('creator_closed: root-c');
  });
  it('askCreator_externalCaller_mageExternalCaller', async () => {
    await expect(new ExternalSessionsPort().askCreator()).rejects.toThrow(/^mage_external_caller:/);
  });
});

describe('HostSessionsPort.cancel', () => {
  it('cancel_working_interrupts', async () => {
    const { port, deps } = setup();
    expect(await port.cancel({ conversationId: 'child-c', scope: 'turn' })).toEqual({ cancelled: true });
    expect(deps.coordinator.interrupt).toHaveBeenCalledWith('child-s');
  });
  it('cancel_done_false', async () => {
    const { port, deps } = setup({ views: [view({ state: 'done' })] });
    expect(await port.cancel({ conversationId: 'child-c', scope: 'turn' })).toEqual({ cancelled: false });
    expect(deps.coordinator.interrupt).not.toHaveBeenCalled();
  });
});

describe('ExternalSessionsPort', () => {
  it('externalPort_anyMethod_externalCallerError', async () => {
    const port = new ExternalSessionsPort();
    await expect(port.listSessions()).rejects.toThrow(/^mage_external_caller:/);
    await expect(port.createSession()).rejects.toThrow(/^mage_external_caller:/);
    await expect(port.cancel()).rejects.toThrow(/^mage_external_caller:/);
  });
});

describe('MageToolHandlers.askCreator con el puerto de main', () => {
  const ask = { requestId: REQUEST, text: '¿Rojo?' };
  const delegateHandlers = () => {
    const delegate = view({ child: child({ sessionId: 'caller-s', conversationId: 'caller-c', creatorSessionId: 'root-s', creatorConversationId: 'root-c', creatorChain: ['root-c'] }) });
    const { port, deps } = setup({ views: [delegate] });
    const scope = snapshotScope({ accountIds: ['acc1'], caller: { conversationId: 'caller-c', creatorChain: ['root-c'] } });
    return { deps, handlers: new MageToolHandlers({ port, scope, store: new MemoryIdempotencyStore(), now: () => AT }) };
  };
  it('askCreatorHandler_sameRequestIdTwice_recordsOnce', async () => {
    const { handlers, deps } = delegateHandlers();
    const first = await handlers.askCreator(ask);
    const second = await handlers.askCreator(ask);
    expect([first, second]).toEqual([{ receipt: 'accepted' }, { receipt: 'accepted' }]);
    expect(deps.log.recordQuestion).toHaveBeenCalledTimes(1);
  });
  it('askCreatorHandler_sameRequestIdOtherText_idempotencyConflict', async () => {
    const { handlers } = delegateHandlers();
    await handlers.askCreator(ask);
    await expect(handlers.askCreator({ ...ask, text: 'otra' })).rejects.toThrow(/idempotency/i);
  });
});

describe('MageToolHandlers con el puerto de main', () => {
  const handlersFor = (creatorChain: readonly string[], maxDepth: number) => {
    const { port } = setup();
    const scope = snapshotScope({ accountIds: ['acc1'], caller: { conversationId: 'caller-c', creatorChain } });
    return new MageToolHandlers({ port, scope, store: new MemoryIdempotencyStore(), now: () => AT, maxDepth });
  };
  const input = { requestId: REQUEST, provider: 'claude' as const, cwd: CWD, prompt: 'x' };
  it('create_conEsfuerzoYModo_llegaAlPuerto', async () => {
    const { port, deps } = setup({ snapshot: snap('child-c'), creator: { provider: 'claude', model: 'sonnet', permissionMode: 'plan' } });
    const scope = snapshotScope({ accountIds: ['acc1'], caller: { conversationId: 'caller-c', creatorChain: [] } });
    const handlers = new MageToolHandlers({ port, scope, store: new MemoryIdempotencyStore(), now: () => AT });
    await handlers.create({ ...input, effort: 'high', permissionMode: 'plan' });
    expect(deps.launch).toHaveBeenCalledWith(expect.objectContaining({ effort: 'high', permissionMode: 'plan' }), expect.anything());
  });
  it('handlers_createFromChildAtMaxDepth_depthExceeded', async () => {
    await expect(handlersFor(['a', 'b'], 3).create(input)).rejects.toThrow('delegation_depth_exceeded');
  });
  it('handlers_createWithCallerInOwnChain_cycle', async () => {
    await expect(handlersFor(['x', 'caller-c'], 5).create(input)).rejects.toThrow('delegation_cycle');
  });
});
