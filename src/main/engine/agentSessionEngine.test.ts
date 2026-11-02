import { describe, expect, it, vi } from 'vitest';
import { fakeAdapter, harness, written } from './agentSession.harness';

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
