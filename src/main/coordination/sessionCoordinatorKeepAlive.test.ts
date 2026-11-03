import { describe, expect, it, vi } from 'vitest';
import type { CreateSessionParams, SessionEventPayload } from '@shared/ipc';
import type { MageEvent, TurnUsage } from '@shared/events';
import type { NativeSessionRef } from '@shared/coordination';
import { DEFAULT_KEEP_ALIVE, type KeepAliveSettings } from '@shared/settings';
import { BACKGROUND_TTL_MS, SessionCoordinator, type CoordinatedSessions, type SequencedSessionEvent } from './sessionCoordinator';
import { ENGINE_REQUEST_TIMEOUT_MS } from './rewindCoordinator';
import { KEEP_ALIVE_PROMPT } from './keepAlivePolicy';

const ACCOUNT = '/home/u/.claude';
const TTL_1H_SECONDS = 3600;
const INTERVAL_MS = 3_540_000; // TTL de 1 h menos el margen de 60 s
const BIG_CONTEXT = 200_000;

interface HarnessOptions {
  readonly settings?: (() => KeepAliveSettings) | null;
  readonly apiKey?: boolean;
}

// Reloj y temporizadores falsos; el motor es un doble que anota lo que recibe.
function harness(options: HarnessOptions = {}) {
  const sinks = new Map<string, (payload: SessionEventPayload) => void>();
  const sessions: CoordinatedSessions = {
    create: vi.fn((_params: CreateSessionParams, sink: (payload: SessionEventPayload) => void) => {
      sinks.set('s1', sink);
      return 's1';
    }),
    stop: vi.fn(), sendMessage: vi.fn(), steerMessage: vi.fn(), engineRequest: vi.fn(), interrupt: vi.fn(), answerPermission: vi.fn(),
    answerElicitation: vi.fn(), stopOwnedBy: vi.fn().mockReturnValue([]), stopByConfigDir: vi.fn().mockReturnValue([]), stopAll: vi.fn(),
  };
  const clock = { now: 0 };
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  let ids = 0;
  const onKeepAliveDone = vi.fn<(ref: NativeSessionRef, sample: unknown, rewound: boolean, kaUuid: string) => void>();
  const settings = options.settings === undefined ? () => DEFAULT_KEEP_ALIVE : options.settings;
  const coordinator = new SessionCoordinator({
    sessions,
    index: { resolveConversation: (ref) => ({ conversationId: `conv-${ref.nativeId}`, lastSeq: 0 }), recordLastSeq: vi.fn() },
    now: () => clock.now, log: vi.fn(), newId: () => `id-${++ids}`, alwaysAllowTools: () => [], defer: (fn) => fn(),
    setTimer: (fn, ms) => {
      // Un temporizador que vence ya no esta vivo.
      const timer = { fn: () => { timer.cancelled = true; fn(); }, ms, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    onKeepAliveDone,
    ...(settings === null ? {} : { keepAliveSettings: settings }),
    ...(options.apiKey === undefined ? {} : { isApiKeyAccount: () => options.apiKey === true }),
  });
  const received: SequencedSessionEvent[] = [];
  const id = coordinator.create({ accountDir: ACCOUNT, cwd: '/p', provider: 'claude' } as CreateSessionParams, (p) => received.push(p));
  const emit = (event: MageEvent) => sinks.get(id)?.({ sessionId: id, event });
  // Temporizadores del keep-alive vivos (no el de caducidad del segundo plano ni los de las peticiones al motor).
  const kaTimers = () => timers.filter((t) => !t.cancelled && t.ms !== BACKGROUND_TTL_MS && t.ms !== ENGINE_REQUEST_TIMEOUT_MS);
  return { coordinator, sessions, id, received, emit, clock, kaTimers, onKeepAliveDone };
}

type Harness = ReturnType<typeof harness>;

const usage = (extra: Partial<TurnUsage> = {}): TurnUsage => ({
  inputTokens: 1, outputTokens: 1, totalTokens: 2, thinkingTokens: null, cacheReadTokens: null, cacheCreationTokens: null, cacheTtlSeconds: null, ...extra,
});
const resultEvent = (u: TurnUsage, costMicroUsd?: number): MageEvent => ({
  kind: 'result', result: { isError: false, subtype: 'success', numTurns: 1, usage: u, ...(costMicroUsd === undefined ? {} : { costMicroUsd }) },
});
const contextEvent = (totalTokens: number): MageEvent => ({ kind: 'context_usage', usage: { totalTokens, maxTokens: 1_000_000, percentage: 20, categories: [] } });
const toolUse: MageEvent = { kind: 'tool_use', tool: { toolUseId: 't1', toolName: 'Bash', input: {} } };
const permission: MageEvent = {
  kind: 'permission_request',
  request: { requestId: 'perm-1', toolUseId: 't1', toolName: 'Bash', input: {}, description: null, requiresUserInteraction: false, displayName: null },
};

// Un turno real de contexto grande con cache de 1 h: deja el keep-alive programado.
function primeBigTurn(h: Harness): void {
  h.emit({ kind: 'request_started' });
  h.emit(contextEvent(BIG_CONTEXT));
  h.emit(resultEvent(usage({ cacheTtlSeconds: TTL_1H_SECONDS })));
}

// Vence el temporizador y devuelve el uuid con el que salio el mensaje oculto.
function fireKeepAlive(h: Harness): string {
  h.clock.now = INTERVAL_MS;
  h.kaTimers().at(-1)?.fn();
  const call = vi.mocked(h.sessions.sendMessage).mock.calls.at(-1);
  return String(call?.[3]);
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Contesta el rewind pedido por el coordinador (el ultimo `engineRequest`).
function answerRewind(h: Harness, result: unknown, ok = true): void {
  const requestId = String(vi.mocked(h.sessions.engineRequest).mock.calls.at(-1)?.[1]);
  h.emit({ kind: 'engine_response', requestId, ok, result, error: ok ? null : 'fallo' });
}

describe('SessionCoordinator: keep-alive de la cache (F4.6)', () => {
  it('keepAlive_afterBigTurn_scheduledAtTtlMinusMargin', () => {
    const h = harness();

    primeBigTurn(h);

    expect(h.kaTimers().map((t) => t.ms)).toEqual([INTERVAL_MS]);
  });

  it('keepAlive_fires_sendsPromptWithOwnUuid', () => {
    const h = harness();
    primeBigTurn(h);

    const uuid = fireKeepAlive(h);

    expect(h.sessions.sendMessage).toHaveBeenCalledWith('s1', KEEP_ALIVE_PROMPT, [], uuid);
    expect(uuid).toMatch(/^id-/);
    expect(h.coordinator.snapshot(h.id).state).toBe('running');
  });

  it('keepAlive_eventsNotFannedOutAndNoSeq', () => {
    const h = harness();
    primeBigTurn(h);
    fireKeepAlive(h);
    const before = { count: h.received.length, seq: h.coordinator.snapshot(h.id).lastSeq };

    h.emit({ kind: 'request_started' });
    h.emit({ kind: 'commands_available', commands: [] });

    expect({ count: h.received.length, seq: h.coordinator.snapshot(h.id).lastSeq }).toEqual(before);
    expect(h.coordinator.snapshot(h.id).state).toBe('running');
  });

  it('keepAlive_permissionRequest_deniedAutomatically', () => {
    const h = harness();
    primeBigTurn(h);
    fireKeepAlive(h);
    const count = h.received.length;

    h.emit(permission);

    expect(h.sessions.answerPermission).toHaveBeenCalledWith('s1', 'perm-1', { behavior: 'deny', message: 'El mantenimiento de la caché no usa herramientas.' });
    expect(h.received).toHaveLength(count);
    expect(h.coordinator.snapshot(h.id).pending).toEqual([]);
  });

  it('keepAlive_toolUse_interruptsOnce', () => {
    const h = harness();
    primeBigTurn(h);
    fireKeepAlive(h);

    h.emit(toolUse);
    h.emit(toolUse);

    expect(h.sessions.interrupt).toHaveBeenCalledTimes(1);
  });

  it('keepAlive_result_rewindsWithKaUuidAsTargetAndLastSeen', () => {
    const h = harness();
    primeBigTurn(h);
    const uuid = fireKeepAlive(h);

    h.emit(resultEvent(usage()));

    expect(h.sessions.engineRequest).toHaveBeenCalledWith('s1', expect.any(String), { kind: 'rewind_conversation', targetUuid: uuid, lastSeenUuid: uuid });
  });

  it('keepAlive_rewindOk_recordsDoneAndReschedules', async () => {
    const h = harness();
    primeBigTurn(h);
    const uuid = fireKeepAlive(h);
    h.emit({ kind: 'request_started' });
    const count = h.received.length;

    h.emit(resultEvent(usage({ cacheReadTokens: 150_000, cacheCreationTokens: 10 }), 900));
    answerRewind(h, { rewound: true });
    await flush();

    expect(h.onKeepAliveDone).toHaveBeenCalledWith(
      { provider: 'claude', accountDir: ACCOUNT, nativeId: 's1' },
      { cacheReadTokens: 150_000, cacheCreationTokens: 10, costMicroUsd: 900 }, true, uuid,
    );
    expect(h.coordinator.snapshot(h.id).state).toBe('idle');
    expect(h.kaTimers().map((t) => t.ms)).toEqual([INTERVAL_MS]);
    expect(h.received).toHaveLength(count);
  });

  it('keepAlive_rewindFails_disablesSessionAndNotices', async () => {
    const h = harness();
    primeBigTurn(h);
    const uuid = fireKeepAlive(h);

    h.emit(resultEvent(usage()));
    answerRewind(h, { rewound: false }, false);
    await flush();

    expect(h.onKeepAliveDone).toHaveBeenCalledWith(expect.anything(), expect.anything(), false, uuid);
    expect(h.received.some((p) => p.event.kind === 'notice')).toBe(true);
    expect(h.kaTimers()).toEqual([]);
  });

  it('keepAlive_userSendsDuringKa_queuedThenDrainedAfterRewind', async () => {
    const h = harness();
    primeBigTurn(h);
    fireKeepAlive(h);

    const receipt = h.coordinator.send({ sessionId: h.id, text: 'hola' });
    expect(receipt.status).toBe('queued');
    expect(h.sessions.sendMessage).toHaveBeenCalledTimes(1);
    h.emit(resultEvent(usage()));
    answerRewind(h, { rewound: true });
    await flush();

    expect(h.sessions.sendMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(h.sessions.sendMessage).mock.calls[1]?.[1]).toBe('hola');
  });

  it('keepAlive_backgroundSession_notScheduled', () => {
    const h = harness();
    h.emit({ kind: 'request_started' });
    expect(h.coordinator.close(h.id)).toEqual({ background: true });

    h.emit(contextEvent(BIG_CONTEXT));
    h.emit(resultEvent(usage({ cacheTtlSeconds: TTL_1H_SECONDS })));

    expect(h.kaTimers()).toEqual([]);
  });

  it('keepAlive_withoutSettingsDep_neverScheduled', () => {
    const h = harness({ settings: null });

    primeBigTurn(h);

    expect(h.kaTimers()).toEqual([]);
  });

  it('keepAlive_sessionRestartingDuringKa_aborts', () => {
    const h = harness();
    primeBigTurn(h);
    fireKeepAlive(h);

    h.emit({ kind: 'session_restarting', attempt: 1, delayMs: 100 });

    expect(h.received.at(-1)?.event.kind).toBe('session_restarting');
    expect(h.coordinator.snapshot(h.id).state).toBe('restarting');
    expect(h.sessions.engineRequest).not.toHaveBeenCalled();
  });

  it('keepAlive_apiKeyAccountDefault_notScheduled', () => {
    const h = harness({ apiKey: true });

    primeBigTurn(h);

    expect(h.kaTimers()).toEqual([]);
  });
});
