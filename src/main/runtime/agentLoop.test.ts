import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MAX_TOOL_ROUNDS, runTurn, type LoopDeps, type LoopEvent } from './agentLoop';
import { ChatHttpError, type ChatClient, type ChatMessage, type ChatRequest } from './chatClient';
import type { StreamPart } from './openAiStream';
import { ToolRegistry } from './tools/registry';
import type { RuntimeTool } from './tools/types';

function client(reply: (request: ChatRequest, n: number) => StreamPart[] | Error): ChatClient & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    requests,
    streamChat(request) {
      requests.push(request);
      const out = reply(request, requests.length);
      return (async function* () {
        if (out instanceof Error) throw out;
        yield* out;
      })();
    },
  };
}

const call = (id: string, name: string, args: string): StreamPart => ({ kind: 'tool_call', call: { id, name, argumentsJson: args } });
const finish = (reason: 'stop' | 'tool_calls' | 'length'): StreamPart => ({ kind: 'finish', reason });
const text = (value: string): StreamPart => ({ kind: 'text', text: value });

function readTool(log: string[], delayMs = 0): RuntimeTool {
  return {
    name: 'Read',
    kind: 'read',
    description: 'lee',
    fields: { file_path: { type: 'string', description: 'ruta', required: true } },
    input: z.object({ file_path: z.string() }),
    run: async (input) => {
      log.push(`start:${input.file_path as string}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      log.push(`end:${input.file_path as string}`);
      return { isError: false, output: `contenido de ${input.file_path as string}` };
    },
  };
}

function deps(chat: ChatClient, tools: RuntimeTool[], events: LoopEvent[] = []): LoopDeps {
  let id = 0;
  return {
    client: chat,
    tools: new ToolRegistry(tools, (signal) => ({ cwd: '/p', extraDirs: [], signal })),
    authorize: async () => ({ behavior: 'allow' }),
    fit: (messages) => messages,
    emit: (event) => events.push(event),
    now: () => 0,
    newId: () => `n${++id}`,
  };
}

const input = (history: ChatMessage[] = [{ role: 'user', content: 'lee hola.txt' }]) => ({
  model: 'm',
  system: 'sys',
  history,
  signal: new AbortController().signal,
  toolsEnabled: true,
});

describe('runTurn con herramientas', () => {
  it('run_brokenArgsThenUnknownToolThenGood_recoversWithoutBreaking', async () => {
    const chat = client((_r, n) => {
      if (n === 1) return [call('c1', 'Read', '{"file_path": "hola.txt"'), finish('tool_calls')];
      if (n === 2) return [call('c2', 'leer', '{}'), finish('tool_calls')];
      if (n === 3) return [call('c3', 'Read', '{"file_path":"hola.txt"}'), finish('tool_calls')];
      return [text('Por fin: hola.'), finish('stop')];
    });
    const turn = input();

    const outcome = await runTurn(turn, deps(chat, [readTool([])]));

    expect(outcome).toMatchObject({ status: 'success', rounds: 4 });
    const tools = turn.history.filter((m) => m.role === 'tool').map((m) => (m.role === 'tool' ? m.content : ''));
    expect(tools[0]).toMatch(/no son JSON válido/);
    expect(tools[1]).toMatch(/no existe\. Disponibles: Read/);
    expect(tools[2]).toBe('contenido de hola.txt');
  });

  it('run_twoParallelReads_runConcurrentlyAndAnswerInOrder', async () => {
    const log: string[] = [];
    const chat = client((_r, n) =>
      n === 1 ? [call('a', 'Read', '{"file_path":"1"}'), call('b', 'Read', '{"file_path":"2"}'), finish('tool_calls')] : [text('ok'), finish('stop')],
    );

    await runTurn(input(), deps(chat, [readTool(log, 5)]));

    expect(log.slice(0, 2)).toEqual(['start:1', 'start:2']);
    const second = chat.requests[1]!.messages;
    const assistant = second.find((m) => m.role === 'assistant');
    expect(assistant).toMatchObject({ tool_calls: [{ id: 'a' }, { id: 'b' }] });
    expect(second.filter((m) => m.role === 'tool').map((m) => (m.role === 'tool' ? m.tool_call_id : ''))).toEqual(['a', 'b']);
  });

  it('run_callWithoutId_getsRtId', async () => {
    const events: LoopEvent[] = [];
    const chat = client((_r, n) =>
      n === 1 ? [{ kind: 'tool_call', call: { id: null, name: 'Read', argumentsJson: '{"file_path":"x"}' } }, finish('tool_calls')] : [finish('stop')],
    );

    await runTurn(input(), deps(chat, [readTool([])], events));

    expect(events.find((e) => e.kind === 'tool_use')).toMatchObject({ id: 'rt-n1' });
  });

  it('run_maxToolRounds_stopsWithError', async () => {
    const chat = client(() => [call('c', 'Read', '{"file_path":"x"}'), finish('tool_calls')]);

    const outcome = await runTurn(input(), deps(chat, [readTool([])]));

    expect(outcome.status).toBe('error');
    expect(outcome.rounds).toBe(MAX_TOOL_ROUNDS);
    expect(outcome.error).toMatch(String(MAX_TOOL_ROUNDS));
  });

  it('run_noToolsError_retriesWithoutToolsAndNotices', async () => {
    const events: LoopEvent[] = [];
    const chat = client((request) =>
      request.tools !== undefined ? new ChatHttpError('400 does not support tools', 'no_tools', 400) : [text('solo chat'), finish('stop')],
    );

    const outcome = await runTurn(input(), deps(chat, [readTool([])], events));

    expect(outcome).toMatchObject({ status: 'success', toolsEnabled: false, rounds: 1 });
    expect(chat.requests.map((r) => r.tools === undefined)).toEqual([false, true]);
    expect(events.some((e) => e.kind === 'notice')).toBe(true);
  });

  it('run_finishLength_errorExplained', async () => {
    const outcome = await runTurn(input(), deps(client(() => [text('a medias'), finish('length')]), []));

    expect(outcome).toMatchObject({ status: 'error', error: expect.stringContaining('longitud') });
  });

  it('run_usage_summedAcrossRounds', async () => {
    const chat = client((_r, n) => [
      ...(n === 1 ? [call('c', 'Read', '{"file_path":"x"}')] : [text('fin')]),
      { kind: 'usage', inputTokens: 100, outputTokens: 10 },
      finish(n === 1 ? 'tool_calls' : 'stop'),
    ]);

    const outcome = await runTurn(input(), deps(chat, [readTool([])]));

    expect(outcome.usage).toEqual({ inputTokens: 200, outputTokens: 20 });
  });

  it('run_noUsageReported_usageNull', async () => {
    const outcome = await runTurn(input(), deps(client(() => [text('x'), finish('stop')]), []));

    expect(outcome.usage).toBeNull();
  });

  it('run_abortDuringTool_closesPendingCallsWithResults', async () => {
    const controller = new AbortController();
    const slow: RuntimeTool = {
      ...readTool([]),
      run: async () => {
        controller.abort();
        return { isError: false, output: 'leido' };
      },
      kind: 'edit',
    };
    const chat = client(() => [call('a', 'Read', '{"file_path":"1"}'), call('b', 'Read', '{"file_path":"2"}'), finish('tool_calls')]);
    const turn = { ...input(), signal: controller.signal };

    const outcome = await runTurn(turn, deps(chat, [slow]));

    expect(outcome.status).toBe('interrupted');
    const tools = turn.history.filter((m) => m.role === 'tool');
    expect(tools.map((m) => (m.role === 'tool' ? m.tool_call_id : ''))).toEqual(['a', 'b']);
  });
});
