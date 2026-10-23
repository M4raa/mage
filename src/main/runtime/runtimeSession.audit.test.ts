import { expect, it } from 'vitest';
import { RuntimeSession } from './runtimeSession';
import type { LoopTools } from './agentLoop';
import type { ChatClient, ChatRequest } from './chatClient';

const tools: LoopTools & { names(): readonly string[] } = {
  names: () => ['Read'],
  specs: () => [{ type: 'function', function: { name: 'Read', description: 'lee', parameters: {} } }],
  prepare: () => ({ ok: true, kind: 'read', input: {} }),
  prepareInput: () => ({ ok: true, kind: 'read', input: {} }),
  run: async () => ({ isError: false, output: 'contenido' }),
};

it('A06_cambiarAModeloConHerramientas_vuelveAEnviarToolsNativas', async () => {
    const requests: ChatRequest[] = [];
    let idle: () => void = () => undefined;
    const nextIdle = () => new Promise<void>((resolve) => { idle = resolve; });
    const client: ChatClient = {
      async *streamChat(request) {
        requests.push(request);
        yield { kind: 'text', text: 'ok' };
        yield { kind: 'finish', reason: 'stop' };
      },
    };
    const session = new RuntimeSession({
      sessionId: 'audit', model: 'chat-only', permissionMode: 'default', client, tools,
      gate: () => ({ verdict: 'allow' }), systemPrompt: () => 'sys',
      emit: (event) => { if (event.kind === 'session_state' && event.state === 'idle') idle(); },
      now: () => 0, newId: () => 'id', toolsEnabled: true,
      prepareModel: async (model) => ({ budget: null, supportsTools: model === 'with-tools', warning: null }),
    });
    session.start();
    const firstIdle = nextIdle(); session.sendUserMessage('uno'); await firstIdle;
    const secondIdle = nextIdle(); session.setModel('with-tools'); session.sendUserMessage('dos'); await secondIdle;
    session.stop();
    expect(requests.map((request) => [request.model, request.tools?.length ?? 0])).toEqual([['chat-only', 0], ['with-tools', 1]]);
  });
