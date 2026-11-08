import { describe, expect, it } from 'vitest';
import { normalizeNotification } from './codexProtocol';

describe('normalizeNotification', () => {
  it('normalizeNotification_mcpItemCompletedWithError_outputIsFailureText', () => {
    const item = { id: 'm', type: 'mcpToolCall', server: 's', tool: 't', status: 'failed', error: { message: 'detalle' }, result: { content: [{ type: 'text', text: 'hola' }] } };

    const events = normalizeNotification('item/completed', { item }, null);

    expect(events).toMatchObject([{ kind: 'tool_result', result: { isError: true, output: 'La llamada MCP de Codex falló.' } }]);
  });
});
