import { describe, expect, it, vi } from 'vitest';
import { ContextBudget } from './contextBudget';
import type { MageEvent } from '@shared/events';
import type { LoopTools, ToolOutcome } from './agentLoop';
import type { ChatClient, ChatRequest } from './chatClient';
import type { StreamPart } from './openAiStream';
import { AUTO_MODE_NOTICE, RuntimeSession, type GateVerdict, type RuntimeSessionDeps } from './runtimeSession';

// ChatClient falso: cada peticion consume el siguiente guion. Un guion puede esperar a una promesa
// (para probar la cola y el interrupt) o lanzar.
type Script = readonly StreamPart[] | (() => AsyncIterable<StreamPart>);

function fakeClient(scripts: Script[]): ChatClient & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    requests,
    streamChat(request) {
      requests.push(request);
      const script = scripts.shift();
      if (script === undefined) throw new Error('el test no esperaba otra peticion');
      if (typeof script === 'function') return script();
      return (async function* () {
        yield* script;
      })();
    },
  };
}

const textReply = (text: string): StreamPart[] => [
  { kind: 'text', text },
  { kind: 'usage', inputTokens: 10, outputTokens: 2 },
  { kind: 'finish', reason: 'stop' },
];

function fakeTools(outcome: ToolOutcome = { isError: false, output: 'contenido' }): LoopTools & { names(): readonly string[]; ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    names: () => ['Read', 'Write'],
    specs: () => [{ type: 'function', function: { name: 'Read', description: 'lee', parameters: {} } }],
    prepare: (name, json) => {
      try {
        return { ok: true, kind: name === 'Write' ? 'edit' : 'read', input: JSON.parse(json) as Record<string, unknown> };
      } catch {
        return { ok: false, error: `argumentos invalidos: ${json}` };
      }
    },
    prepareInput: (name, input) =>
      typeof (input as { file_path?: unknown }).file_path === 'string'
        ? { ok: true, kind: name === 'Write' ? 'edit' : 'read', input: input as Record<string, unknown> }
        : { ok: false, error: 'file_path obligatorio' },
    run: async (name) => {
      ran.push(name);
      return outcome;
    },
  };
}

function setup(scripts: Script[], overrides: Partial<RuntimeSessionDeps> = {}) {
  const events: MageEvent[] = [];
  let id = 0;
  const client = fakeClient(scripts);
  const tools = fakeTools();
  const session = new RuntimeSession({
    sessionId: 's1',
    model: 'm',
    permissionMode: 'default',
    client,
    tools,
    gate: () => ({ verdict: 'allow' }),
    systemPrompt: () => 'sistema',
    emit: (event) => events.push(event),
    now: () => 1000,
    newId: () => `id${++id}`,
    toolsEnabled: true,
    ...overrides,
  });
  return { session, events, client, tools };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const kinds = (events: readonly MageEvent[]) => events.map((e) => e.kind);

function toolCallReply(name: string, args: string): StreamPart[] {
  return [
    { kind: 'tool_call', call: { id: 'call_1', name, argumentsJson: args } },
    { kind: 'finish', reason: 'tool_calls' },
  ];
}

describe('RuntimeSession turno', () => {
  it('sendUserMessage_textTurn_emitsExactSequence', async () => {
    const { session, events } = setup([textReply('hola')]);
    session.start();

    session.sendUserMessage('hey');
    await settle();

    expect(kinds(events)).toEqual(['session_init', 'session_state', 'session_state', 'request_started', 'stream_delta', 'assistant_text', 'result', 'session_state']);
    expect(events.at(-2)).toEqual({
      kind: 'result',
      result: { isError: false, subtype: 'success', numTurns: 1, usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12, thinkingTokens: null, cacheReadTokens: null } },
    });
    expect(events.at(-1)).toEqual({ kind: 'session_state', state: 'idle' });
  });

  it('start_twice_throws', () => {
    const { session } = setup([]);
    session.start();

    expect(() => session.start()).toThrow(/ya estaba arrancada/);
  });

  it('sendUserMessage_secondWhileRunning_isQueuedAndKeepsContext', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const slow = async function* (): AsyncIterable<StreamPart> {
      await gate;
      yield* textReply('uno');
    };
    const { session, events, client } = setup([slow, textReply('dos')]);
    session.start();

    session.sendUserMessage('primero');
    session.sendUserMessage('segundo');
    await settle();
    expect(client.requests).toHaveLength(1);
    release();
    await settle();
    await settle();

    expect(events.filter((e) => e.kind === 'result')).toHaveLength(2);
    expect(client.requests[1]!.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('interrupt_midTurn_resultInterrupted', async () => {
    const hanging = (signal?: AbortSignal) =>
      async function* (): AsyncIterable<StreamPart> {
        yield { kind: 'text', text: 'empiezo' };
        await new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))));
      };
    const client: ChatClient = { streamChat: (_req, signal) => hanging(signal)() };
    const { session, events } = setup([], { client });
    session.start();

    session.sendUserMessage('hey');
    await settle();
    session.interrupt();
    await settle();

    const result = events.find((e) => e.kind === 'result');
    expect(result).toEqual({ kind: 'result', result: { isError: false, subtype: 'interrupted', numTurns: 0 } });
  });

  it('sendUserMessage_clientThrows_errorAndSessionStaysAlive', async () => {
    const failing = () => ({
      [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error('conexion rechazada: ECONNREFUSED')) }),
    });
    const { session, events } = setup([failing, textReply('ya')]);
    session.start();

    session.sendUserMessage('uno');
    await settle();
    session.sendUserMessage('dos');
    await settle();

    expect(events).toContainEqual({ kind: 'error', message: 'conexion rechazada: ECONNREFUSED' });
    const results = events.filter((e): e is Extract<MageEvent, { kind: 'result' }> => e.kind === 'result');
    expect(results.map((r) => r.result.isError)).toEqual([true, false]);
  });

  it('sendUserMessage_unexpectedRecorderFailure_reportsAndKeepsSessionAlive', async () => {
    const recorder = { user: () => { throw new Error('disco lleno'); }, loop: () => undefined, turnEnd: () => undefined, reset: () => undefined, rename: () => undefined, compact: () => undefined };
    const { session, events } = setup([textReply('x')], { recorder });
    session.start();

    session.sendUserMessage('uno');
    await settle();

    expect(events).toContainEqual({ kind: 'error', message: 'Fallo inesperado del runtime: disco lleno' });
    expect(events.at(-1)).toEqual({ kind: 'session_state', state: 'idle' });
  });

  it('stop_twice_isIdempotentAndRejectsNewMessages', () => {
    const { session } = setup([]);
    session.start();

    session.stop();
    session.stop();

    expect(() => session.sendUserMessage('x')).toThrow(/parada/);
  });

  it('sendUserMessage_withAttachments_throwsWithCount', () => {
    const { session } = setup([]);

    expect(() => session.sendUserMessage('x', [{ mediaType: 'image/png', data: 'AA==' } as never])).toThrow(/1/);
  });

  it('sendUserMessage_clear_resetsWithoutRequest', async () => {
    const { session, events, client } = setup([]);
    session.start();

    session.sendUserMessage('/clear');
    await settle();

    expect(client.requests).toHaveLength(0);
    expect(events).toContainEqual({ kind: 'conversation_reset', newSessionId: 'id1' });
  });

  it('sendUserMessage_rename_recordsTitleWithoutRequest', async () => {
    const titles: string[] = [];
    const recorder = { user: () => undefined, loop: () => undefined, turnEnd: () => undefined, reset: () => undefined, rename: (t: string) => titles.push(t), compact: () => undefined };
    const { session, events, client } = setup([], { recorder });
    session.start();

    session.sendUserMessage('/rename  Mi conversación ');
    await settle();

    expect(titles).toEqual(['Mi conversación']);
    expect(client.requests).toHaveLength(0);
    expect(events).toContainEqual({ kind: 'local_command_output', command: 'rename', args: 'Mi conversación', text: '' });
  });

  it('setPermissionMode_enteringAuto_noticeOnce', () => {
    const { session, events } = setup([]);
    session.start();

    session.setPermissionMode('auto');
    session.setPermissionMode('auto');

    expect(events.filter((e) => e.kind === 'notice')).toEqual([{ kind: 'notice', text: AUTO_MODE_NOTICE }]);
  });

  it('setPermissionMode_unknown_throwsWithValue', () => {
    const { session } = setup([]);

    expect(() => session.setPermissionMode('dontAsk')).toThrow(/dontAsk/);
  });
});

describe('RuntimeSession permisos', () => {
  const ask = (): GateVerdict => ({ verdict: 'ask' });

  it('ask_emitsPermissionRequestAndAllowRunsTool', async () => {
    const { session, events, tools } = setup([toolCallReply('Write', '{"file_path":"a"}'), textReply('hecho')], { gate: ask });
    session.start();

    session.sendUserMessage('escribe');
    await settle();
    const request = events.find((e): e is Extract<MageEvent, { kind: 'permission_request' }> => e.kind === 'permission_request');
    expect(request?.request).toMatchObject({ toolName: 'Write', toolUseId: 'call_1', input: { file_path: 'a' } });
    expect(events.at(-1)).toEqual({ kind: 'session_state', state: 'requires_action' });

    session.answerPermission(request!.request.requestId, { behavior: 'allow' });
    await settle();
    await settle();

    expect(tools.ran).toEqual(['Write']);
    expect(events.filter((e) => e.kind === 'result')).toHaveLength(1);
  });

  it('ask_outsideVerdict_requestMarkedOutsideWithReason', async () => {
    const outside = (): GateVerdict => ({ verdict: 'ask', outside: 'Fuera del proyecto: /etc/hosts' });
    const { session, events } = setup([toolCallReply('Read', '{"file_path":"/etc/hosts"}'), textReply('vale')], { gate: outside });
    session.start();

    session.sendUserMessage('lee');
    await settle();

    const request = events.find((e): e is Extract<MageEvent, { kind: 'permission_request' }> => e.kind === 'permission_request');
    expect(request?.request).toMatchObject({ description: 'Fuera del proyecto: /etc/hosts', outsideProject: true });
  });

  it('allow_withInvalidUpdatedInput_toolErrorWithoutRunning', async () => {
    const { session, events, tools } = setup([toolCallReply('Write', '{"file_path":"a"}'), textReply('vale')], { gate: ask });
    session.start();
    session.sendUserMessage('escribe');
    await settle();
    const request = events.find((e): e is Extract<MageEvent, { kind: 'permission_request' }> => e.kind === 'permission_request')!;

    session.answerPermission(request.request.requestId, { behavior: 'allow', updatedInput: { otra: 1 } });
    await settle();
    await settle();

    expect(tools.ran).toEqual([]);
    expect(events).toContainEqual(expect.objectContaining({ kind: 'tool_result', result: expect.objectContaining({ isError: true, output: 'file_path obligatorio' }) }));
  });

  it('deny_turnContinuesWithErrorToModel', async () => {
    const { session, events, client } = setup([toolCallReply('Write', '{"file_path":"a"}'), textReply('entendido')], { gate: ask });
    session.start();
    session.sendUserMessage('escribe');
    await settle();
    const request = events.find((e): e is Extract<MageEvent, { kind: 'permission_request' }> => e.kind === 'permission_request')!;

    session.answerPermission(request.request.requestId, { behavior: 'deny', message: 'no' });
    await settle();
    await settle();

    const toolMessage = client.requests[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMessage).toMatchObject({ content: 'El usuario denegó Write: no' });
    expect(events.find((e) => e.kind === 'result')).toMatchObject({ result: { subtype: 'success' } });
  });

  it('interrupt_withPendingPermission_cancelsIt', async () => {
    const { session, events } = setup([toolCallReply('Write', '{"file_path":"a"}')], { gate: ask });
    session.start();
    session.sendUserMessage('escribe');
    await settle();
    const request = events.find((e): e is Extract<MageEvent, { kind: 'permission_request' }> => e.kind === 'permission_request')!;

    session.interrupt();
    await settle();

    expect(events).toContainEqual({ kind: 'permission_cancelled', requestId: request.request.requestId });
    expect(events.find((e) => e.kind === 'result')).toMatchObject({ result: { subtype: 'interrupted' } });
  });

  it('answerPermission_twice_throws', async () => {
    const { session, events } = setup([toolCallReply('Write', '{"file_path":"a"}'), textReply('x')], { gate: ask });
    session.start();
    session.sendUserMessage('escribe');
    await settle();
    const { requestId } = events.find((e): e is Extract<MageEvent, { kind: 'permission_request' }> => e.kind === 'permission_request')!.request;

    session.answerPermission(requestId, { behavior: 'allow' });

    expect(() => session.answerPermission(requestId, { behavior: 'allow' })).toThrow(requestId);
  });

  it('gateDeny_planMode_reasonReachesModel', async () => {
    const { session, client } = setup([toolCallReply('Write', '{"file_path":"a"}'), textReply('ok')], {
      gate: () => ({ verdict: 'deny', reason: 'modo Plan: solo lectura' }),
    });
    session.start();
    session.sendUserMessage('escribe');
    await settle();
    await settle();

    expect(client.requests[1]!.messages.find((m) => m.role === 'tool')).toMatchObject({ content: 'Write no está permitido: modo Plan: solo lectura' });
  });
});

describe('RuntimeSession y el modelo (R5)', () => {
  const budget = () => new ContextBudget(4_096, 'm');

  it('prepare_catalogSaysNoTools_sendsNoToolsAndNotices', async () => {
    const { session, events, client } = setup([textReply('hola')], {
      prepareModel: async () => ({ budget: budget(), supportsTools: false, warning: null }),
    });
    session.start();

    session.sendUserMessage('hey');
    await settle();
    await settle();

    expect(client.requests[0]!.tools).toBeUndefined();
    expect(events).toContainEqual({ kind: 'notice', text: expect.stringContaining('no admite herramientas') });
  });

  it('prepare_warning_isNoticedOncePerModel', async () => {
    const prepareModel = vi.fn(async () => ({ budget: budget(), supportsTools: null, warning: 'Ollama carga menos' }));
    const { session, events } = setup([textReply('uno'), textReply('dos')], { prepareModel });
    session.start();

    session.sendUserMessage('a');
    session.sendUserMessage('b');
    await settle();
    await settle();
    await settle();

    expect(prepareModel).toHaveBeenCalledTimes(1);
    expect(events.filter((e) => e.kind === 'notice')).toHaveLength(1);
  });

  it('result_withoutServerUsage_isEstimated', async () => {
    const { session, events } = setup([[{ kind: 'text', text: 'hola' }, { kind: 'finish', reason: 'stop' }]], {
      prepareModel: async () => ({ budget: budget(), supportsTools: null, warning: null }),
    });
    session.start();

    session.sendUserMessage('hey');
    await settle();
    await settle();

    const result = events.find((e): e is Extract<MageEvent, { kind: 'result' }> => e.kind === 'result');
    expect(result?.result.usage).toMatchObject({ estimated: true });
    expect(events.find((e) => e.kind === 'context_usage')).toMatchObject({ usage: { maxTokens: 4_096 } });
  });

  it('result_unparseableCallWrittenAsText_noticed', async () => {
    const { session, events } = setup([textReply('<tool_call>{"name": roto}</tool_call>')]);
    session.start();

    session.sendUserMessage('lee');
    await settle();

    expect(events).toContainEqual({ kind: 'notice', text: expect.stringContaining('no la ejecutó') });
  });

  it('result_callWrittenAsTextWithNativeTools_notExecuted', async () => {
    // A1: con herramientas nativas, un bloque escrito (citado de un fichero, p.ej.) no se ejecuta nunca.
    const { session, tools, events } = setup([textReply('<tool_call>{"name":"Read","arguments":{"file_path":"a"}}</tool_call>')]);
    session.start();

    session.sendUserMessage('lee');
    await settle();
    await settle();

    expect(tools.ran).toEqual([]);
    expect(events).toContainEqual({ kind: 'notice', text: expect.stringContaining('no la ejecutó') });
  });

  it('result_callWrittenAsTextWithoutNativeTools_isExecutedAndAnsweredAsUser', async () => {
    const replies = [textReply('<tool_call>{"name":"Read","arguments":{"file_path":"a"}}</tool_call>'), textReply('leido')];
    const { session, tools, client } = setup(replies, { toolsEnabled: false });
    session.start();

    session.sendUserMessage('lee');
    await settle();
    await settle();

    expect(tools.ran).toEqual(['Read']);
    expect(client.requests[1]!.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });
});
