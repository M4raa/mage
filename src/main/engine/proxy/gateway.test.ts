import { describe, expect, it } from 'vitest';
import { convertAnthropicToOpenAi, isMessagesRequest } from './gateway';

describe('gateway isMessagesRequest', () => {
  it('isMessagesRequest_pathRealDelCli_loAcepta', () => {
    // Ruta LITERAL observada con el CLI 2.1.220: base URL con /v1 + '/v1/messages' + query string.
    expect(isMessagesRequest('POST', '/v1/v1/messages?beta=true')).toBe(true);
  });

  it('isMessagesRequest_pathCanonico_loAcepta', () => {
    expect(isMessagesRequest('POST', '/v1/messages')).toBe(true);
  });

  it('isMessagesRequest_conQueryString_loAcepta', () => {
    expect(isMessagesRequest('POST', '/v1/messages?beta=true')).toBe(true);
  });

  it('isMessagesRequest_otraRuta_laRechaza', () => {
    expect(isMessagesRequest('POST', '/v1/api/hello')).toBe(false);
    expect(isMessagesRequest('POST', '/v1/messages/count_tokens')).toBe(false);
  });

  it('isMessagesRequest_metodoDistintoDePost_laRechaza', () => {
    expect(isMessagesRequest('HEAD', '/v1/messages')).toBe(false);
    expect(isMessagesRequest('GET', '/v1/v1/messages')).toBe(false);
  });

  it('isMessagesRequest_sinMetodoNiUrl_laRechaza', () => {
    expect(isMessagesRequest(undefined, undefined)).toBe(false);
    expect(isMessagesRequest('POST', undefined)).toBe(false);
  });
});

describe('gateway convertAnthropicToOpenAi', () => {
  it('convertAnthropicToOpenAi_simpleMessage_returnsOpenAiPayload', () => {
    const payload = {
      model: 'sonnet',
      messages: [
        { role: 'user', content: 'hello' }
      ]
    };

    const result = convertAnthropicToOpenAi(payload, 'gpt-4o');

    expect(result).toEqual({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'hello' }
      ],
      stream: false
    });
  });

  // Sin `stream_options.include_usage` el proveedor no manda contadores en ningun chunk del stream y el
  // turno se reportaria con 0 tokens, que es exactamente lo que hacia el gateway antes.
  it('convertAnthropicToOpenAi_streaming_pideLosContadoresDeUso', () => {
    const result = convertAnthropicToOpenAi({ messages: [{ role: 'user', content: 'hi' }], stream: true }, 'gpt-4o');

    expect(result.stream).toBe(true);
    expect(result.stream_options).toEqual({ include_usage: true });
  });

  it('convertAnthropicToOpenAi_sinStreaming_noPideStreamOptions', () => {
    const result = convertAnthropicToOpenAi({ messages: [{ role: 'user', content: 'hi' }] }, 'gpt-4o');

    expect(result.stream_options).toBeUndefined();
  });

  it('convertAnthropicToOpenAi_withSystemPrompt_prependsSystemMessage', () => {
    const payload = {
      model: 'sonnet',
      system: 'You are a helpful assistant',
      messages: [
        { role: 'user', content: 'hello' }
      ]
    };

    const result = convertAnthropicToOpenAi(payload, 'gpt-4o');

    expect(result.messages).toEqual([
      { role: 'system', content: 'You are a helpful assistant' },
      { role: 'user', content: 'hello' }
    ]);
  });

  it('convertAnthropicToOpenAi_withToolUse_returnsToolCalls', () => {
    const payload = {
      model: 'sonnet',
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me run a command.' },
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Bash',
              input: { command: 'echo hello' }
            }
          ]
        }
      ]
    };

    const result = convertAnthropicToOpenAi(payload, 'gpt-4o');

    expect(result.messages).toEqual([
      {
        role: 'assistant',
        content: 'Let me run a command.',
        tool_calls: [
          {
            id: 'toolu_1',
            type: 'function',
            function: {
              name: 'Bash',
              arguments: JSON.stringify({ command: 'echo hello' })
            }
          }
        ]
      }
    ]);
  });

  it('convertAnthropicToOpenAi_withToolResult_returnsToolMessage', () => {
    const payload = {
      model: 'sonnet',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_1',
              content: 'hello output',
              is_error: false
            }
          ]
        }
      ]
    };

    const result = convertAnthropicToOpenAi(payload, 'gpt-4o');

    expect(result.messages).toEqual([
      {
        role: 'tool',
        tool_call_id: 'toolu_1',
        content: 'hello output'
      }
    ]);
  });
});
