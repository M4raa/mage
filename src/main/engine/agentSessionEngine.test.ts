import { describe, expect, it, vi } from 'vitest';
import type { EngineRequest } from './providerAdapter';
import type { MageEvent } from '@shared/events';
import { AgentSession, type SpawnFn } from './agentSession';
import { emitLine, FakeChild, fakeAdapter, harness, POLICY, written } from './agentSession.harness';

const REQUEST: EngineRequest = { kind: 'rewind_files', userMessageUuid: 'u', dryRun: true };

// `null` = adapter sin soporte (un `undefined` activaria el valor por defecto).
function withEngine(encode: ((requestId: string, request: EngineRequest) => unknown) | null = (requestId) => ({ engine: requestId })) {
  const base = fakeAdapter();
  return harness({ plans: base.plans, adapter: { ...base.adapter, encodeEngineRequest: encode ?? undefined } });
}

const engineResponses = (events: ReadonlyArray<{ kind: string }>) => events.filter((event) => event.kind === 'engine_response');

describe('AgentSession: id propio del mensaje (F4.4)', () => {
  it('sendUserMessage_withMessageId_passesItToAdapter', () => {
    const base = fakeAdapter();
    const encodeUserMessage = vi.fn((text: string) => ({ text }));
    const h = harness({ plans: base.plans, adapter: { ...base.adapter, encodeUserMessage } });
    h.session.start();

    h.session.sendUserMessage('hola', [], 'm-1');

    expect(encodeUserMessage).toHaveBeenCalledWith('hola', [], 'm-1');
    expect(written(h.children[0]!).at(-1)).toEqual({ text: 'hola' });
  });
});

describe('AgentSession: peticiones al motor (F4.4/F4.5)', () => {
  it('engineRequest_withoutProcess_emitsProcessNotRunning', () => {
    const h = withEngine();

    h.session.engineRequest('r1', REQUEST);

    expect(h.events).toEqual([{ kind: 'engine_response', requestId: 'r1', ok: false, result: null, error: 'process_not_running' }]);
  });

  it('engineRequest_withProcess_writesThePayload', () => {
    const h = withEngine();
    h.session.start();

    h.session.engineRequest('r1', REQUEST);

    expect(written(h.children[0]!).at(-1)).toEqual({ engine: 'r1' });
  });

  it('engineRequest_processExits_emitsProcessExited', () => {
    const h = withEngine();
    h.session.start();
    h.session.engineRequest('r1', REQUEST);

    h.children[0]!.exit(1);

    expect(engineResponses(h.events)).toEqual([{ kind: 'engine_response', requestId: 'r1', ok: false, result: null, error: 'process_exited' }]);
  });

  it('engineRequest_responseArrives_notFailedOnLaterExit', () => {
    const h = withEngine();
    h.session.start();
    h.session.engineRequest('r1', REQUEST);
    const response = { kind: 'engine_response', requestId: 'r1', ok: true, result: {}, error: null } as const;
    emitLine(h.children[0]!, [response]);

    h.children[0]!.exit(1);

    expect(engineResponses(h.events)).toEqual([response]);
  });

  it('engineRequest_stop_emitsProcessExited', () => {
    const h = withEngine();
    h.session.start();
    h.session.engineRequest('r1', REQUEST);

    h.session.stop();

    expect(engineResponses(h.events)).toMatchObject([{ requestId: 'r1', error: 'process_exited' }]);
  });

  it('engineRequest_adapterWithoutSupport_throws', () => {
    const h = withEngine(null);
    h.session.start();

    expect(() => h.session.engineRequest('r1', REQUEST)).toThrow('rewind_files');
  });
});

describe('AgentSession: relanzado de un fork (A2)', () => {
  const FORK = { sessionId: 'origen', atUuid: 'corte' };
  const INIT = { kind: 'session_init', sessionId: 's1', model: 'sonnet', tools: [], mcpServers: [], slashCommands: [], skills: [], plugins: [], pluginErrors: [] } as const;

  // Sesion con `forkFrom` en sus params; el arnes compartido no deja elegirlos.
  function forkSession() {
    const { adapter, plans } = fakeAdapter();
    const children: FakeChild[] = [];
    const timers: Array<() => void> = [];
    const events: MageEvent[] = [];
    const session = new AgentSession({
      adapter,
      params: { sessionId: 's1', accountDir: '/home/u/.claude', model: 'sonnet', cwd: '/proj', forkFrom: FORK },
      emit: (event) => events.push(event),
      spawn: () => {
        const child = new FakeChild();
        children.push(child);
        return child as unknown as ReturnType<SpawnFn>;
      },
      killTree: { platform: 'win32', spawnKiller: () => ({ on: () => undefined }) },
      restartPolicy: POLICY,
      setTimer: (callback) => timers.push(callback) - 1,
      clearTimer: () => undefined,
    });
    return { session, plans, children, timers };
  }

  it('restart_afterForkHandshake_resumesWithoutForkFrom', () => {
    const f = forkSession();
    f.session.start();
    emitLine(f.children[0]!, [INIT]);

    f.children[0]!.exit(1, null);
    f.timers[0]!();

    expect(f.plans[0]).toMatchObject({ forkFrom: FORK });
    expect(f.plans[1]).toMatchObject({ sessionId: 's1', resume: true });
    expect(f.plans[1]).not.toHaveProperty('forkFrom');
  });

  it('restart_forkBeforeHandshake_repeatsFork', () => {
    const f = forkSession();
    f.session.start();

    f.children[0]!.exit(1, null);
    f.timers[0]!();

    expect(f.plans[1]).toMatchObject({ forkFrom: FORK });
    expect(f.plans[1]?.resume).not.toBe(true);
  });
});
