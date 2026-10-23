import { expect, it } from 'vitest';
import { runTurn, type LoopTools } from './agentLoop';
import type { ChatClient, ChatMessage } from './chatClient';
import { createRuntimeGate } from './permissionGate';
import type { LoopEvent, ToolOutcome } from './agentLoop';

const tools: LoopTools & { names(): readonly string[] } = {
  names: () => ['Read'],
  specs: () => [{ type: 'function', function: { name: 'Read', description: 'lee', parameters: {} } }],
  prepare: () => ({ ok: true, kind: 'read', input: {} }),
  prepareInput: () => ({ ok: true, kind: 'read', input: {} }),
  run: async () => ({ isError: false, output: 'contenido' }),
};

it('A07_errorEnLote_esperaLaLecturaHermanaYCierraLaEdicionNoEjecutada', async () => {
  const history: ChatMessage[] = [{ role: 'user', content: 'lee' }];
  const events: LoopEvent[] = [];
  let entered: () => void = () => undefined;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  let release: (result: ToolOutcome) => void = () => undefined;
  const pending = new Promise<ToolOutcome>(resolve => { release = resolve; });
  const client: ChatClient = { async *streamChat() {
    for (const [id, name] of [['bad', 'Read'], ['slow', 'Read'], ['unstarted', 'Write']]) {
      yield { kind: 'tool_call', call: { id: id!, name: name!, argumentsJson: '{}' } };
    }
    yield { kind: 'finish', reason: 'tool_calls' };
  } };
  const actualTools: LoopTools = { ...tools,
    prepare: name => ({ ok: true, kind: name === 'Write' ? 'edit' : 'read', input: {} }),
    run: async () => { entered(); return pending; } };
  let finished = false;
  const turn = runTurn({ model: 'm', system: 'sys', history, signal: new AbortController().signal, toolsEnabled: true }, {
    client, tools: actualTools, authorize: async call => { if (call.id === 'bad') throw new Error('gate failed'); return { behavior: 'allow' }; },
    fit: messages => messages, emit: event => events.push(event), now: () => 0, newId: () => 'id',
  }).then(outcome => { finished = true; return outcome; });
  await reading;
  await Promise.resolve();
  expect(finished).toBe(false);
  release({ isError: false, output: 'read completed' });
  expect((await turn).status).toBe('error');
  expect(history.filter(m => m.role === 'tool').map(m => m.tool_call_id)).toEqual(['bad', 'slow', 'unstarted']);
  expect(events.filter(e => e.kind === 'tool_result').map(e => e.id)).toEqual(['bad', 'slow', 'unstarted']);
});

it('A07_errorEnPermiso_cierraLasToolCallsAntesDelSiguienteTurno', async () => {
    const history: ChatMessage[] = [{ role: 'user', content: 'lee' }];
    let n = 0;
    const client: ChatClient = {
      async *streamChat(request) {
        if (++n === 1) {
          yield { kind: 'tool_call', call: { id: 'c1', name: 'Read', argumentsJson: '{}' } };
          yield { kind: 'finish', reason: 'tool_calls' };
          return;
        }
        const answered = new Set(request.messages.filter((m) => m.role === 'tool').map((m) => m.role === 'tool' ? m.tool_call_id : ''));
        for (const message of request.messages) {
          if (message.role === 'assistant' && message.tool_calls?.some((call) => !answered.has(call.id))) {
            throw new Error('Historial inválido: tool_call sin resultado');
          }
        }
        yield { kind: 'finish', reason: 'stop' };
      },
    };
    const gate = createRuntimeGate({ cwd: process.cwd(), extraDirs: [], platform: process.platform,
      realpath: () => { throw Object.assign(new Error('EACCES al resolver la ruta'), { code: 'EACCES' }); } });
    const actualTools = { ...tools, prepare: () => ({ ok: true as const, kind: 'read' as const, input: { file_path: 'bad.txt' } }) };
    const deps = { client, tools: actualTools, authorize: async (call: Parameters<typeof gate>[0]): Promise<{ behavior: 'allow' }> => { gate(call, 'default'); return { behavior: 'allow' }; },
      fit: (messages: readonly ChatMessage[]) => messages, emit: () => undefined, now: () => 0, newId: () => 'id' };
    const input = { model: 'm', system: 'sys', history, signal: new AbortController().signal, toolsEnabled: true };
    expect((await runTurn(input, deps)).status).toBe('error');
    history.push({ role: 'user', content: 'continuar' });
    expect((await runTurn(input, deps)).status).toBe('success');
  });
