import { describe, expect, it, vi } from 'vitest';
import type { EngineRequest } from './providerAdapter';
import { emitLine, fakeAdapter, harness, written } from './agentSession.harness';

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
