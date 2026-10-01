import { describe, expect, it } from 'vitest';
import {
  ChatStreamParser,
  parseChatChunk,
  parseFinishReason,
  SseDecoder,
  sseData,
  ThinkTagSplitter,
  ToolCallAccumulator,
  type StreamPart,
} from './openAiStream';

// Formas del spike (`spike/runtime-spike.mjs`, 2026-09-30) como texto SSE.
function sse(...chunks: unknown[]): string {
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
}

function toolDelta(index: number | undefined, extra: Record<string, unknown>): unknown {
  return { choices: [{ delta: { tool_calls: [{ ...(index === undefined ? {} : { index }), ...extra }] } }] };
}

function parseAll(text: string, splitAt: readonly number[] = []): StreamPart[] {
  const decoder = new SseDecoder();
  const parser = new ChatStreamParser();
  const bytes = new TextEncoder().encode(text);
  const cuts = [0, ...splitAt, bytes.length];
  const parts: StreamPart[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    for (const data of decoder.push(bytes.slice(cuts[i], cuts[i + 1]))) parts.push(...parser.push(parseChatChunk(data)));
  }
  for (const data of decoder.end()) parts.push(...parser.push(parseChatChunk(data)));
  return [...parts, ...parser.end()];
}

const OPENAI_TROCEADO = sse(
  toolDelta(0, { id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '' } }),
  toolDelta(1, { id: 'call_b', type: 'function', function: { name: 'glob', arguments: '' } }),
  toolDelta(0, { function: { arguments: '{"path": ' } }),
  toolDelta(1, { function: { arguments: '{"pattern": ' } }),
  toolDelta(0, { function: { arguments: '"hola.txt"}' } }),
  toolDelta(1, { function: { arguments: '"**/*.txt"}' } }),
  { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  { choices: [], usage: { prompt_tokens: 120, completion_tokens: 30 } },
);

describe('ChatStreamParser', () => {
  it('accumulate_argumentsSplitAcrossChunks_reassemblesJson', () => {
    const parts = parseAll(OPENAI_TROCEADO);

    const calls = parts.filter((p) => p.kind === 'tool_call').map((p) => (p.kind === 'tool_call' ? p.call : null));
    expect(calls).toEqual([
      { id: 'call_a', name: 'read_file', argumentsJson: '{"path": "hola.txt"}' },
      { id: 'call_b', name: 'glob', argumentsJson: '{"pattern": "**/*.txt"}' },
    ]);
    expect(parts.at(-1)).toEqual({ kind: 'finish', reason: 'tool_calls' });
  });

  it('parse_usageChunkWithEmptyChoices_emitsUsage', () => {
    const parts = parseAll(OPENAI_TROCEADO);

    expect(parts).toContainEqual({ kind: 'usage', inputTokens: 120, outputTokens: 30 });
  });

  it('parse_wholeCallInOneChunkWithoutUsage_sameAccumulatorNoUsage', () => {
    const text = sse(
      toolDelta(0, { id: 'call_x', function: { name: 'read_file', arguments: '{"path":"hola.txt"}' } }),
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    );

    const parts = parseAll(text);

    expect(parts.filter((p) => p.kind === 'tool_call')).toHaveLength(1);
    expect(parts.some((p) => p.kind === 'usage')).toBe(false);
  });

  it('parse_callsWithoutIndex_reassemblesById', () => {
    const text = sse(
      toolDelta(undefined, { id: 'c1', function: { name: 'Read', arguments: '{"a":' } }),
      toolDelta(undefined, { id: 'c2', function: { name: 'Glob', arguments: '{}' } }),
      toolDelta(undefined, { id: 'c1', function: { arguments: '1}' } }),
    );

    const calls = parseAll(text).flatMap((p) => (p.kind === 'tool_call' ? [p.call] : []));

    expect(calls.map((c) => c.argumentsJson)).toEqual(['{"a":1}', '{}']);
  });

  it('parse_doneSplitAcrossReads_stillEndsCleanly', () => {
    const text = sse({ choices: [{ delta: { content: 'hola' }, finish_reason: 'stop' }] });
    const doneAt = new TextEncoder().encode(text).length - 5; // parte el "[DONE]"

    const parts = parseAll(text, [doneAt]);

    expect(parts).toEqual([{ kind: 'text', text: 'hola' }, { kind: 'finish', reason: 'stop' }]);
  });

  it('parse_multibyteUtf8SplitAcrossReads_decodesIntact', () => {
    const text = sse({ choices: [{ delta: { content: 'añ€😀' } }] });
    const bytes = new TextEncoder().encode(text);
    const euro = bytes.indexOf(0xe2); // primer byte del "€": se corta en mitad del caracter

    const parts = parseAll(text, [euro + 1, euro + 2]);

    expect(parts[0]).toEqual({ kind: 'text', text: 'añ€😀' });
  });

  it('parse_reasoningFields_emitThinking', () => {
    const text = sse({ choices: [{ delta: { reasoning_content: 'pienso' } }] }, { choices: [{ delta: { reasoning: ' más' } }] });

    const thinking = parseAll(text).filter((p) => p.kind === 'thinking');

    expect(thinking).toEqual([{ kind: 'thinking', text: 'pienso' }, { kind: 'thinking', text: ' más' }]);
  });

  it('end_callsButFinishStop_reportsToolCalls', () => {
    const text = sse(toolDelta(0, { id: 'c', function: { name: 'Read', arguments: '{}' } }), { choices: [{ delta: {}, finish_reason: 'stop' }] });

    expect(parseAll(text).at(-1)).toEqual({ kind: 'finish', reason: 'tool_calls' });
  });

  it('end_emptyStream_finishStop', () => {
    expect(parseAll('')).toEqual([{ kind: 'finish', reason: 'stop' }]);
  });

  it('parse_thousandTextChunks_keepsOrder', () => {
    const chunks = Array.from({ length: 1000 }, (_, i) => ({ choices: [{ delta: { content: String(i % 10) } }] }));

    const text = parseAll(sse(...chunks))
      .flatMap((p) => (p.kind === 'text' ? [p.text] : []))
      .join('');

    expect(text).toHaveLength(1000);
    expect(text.startsWith('0123456789')).toBe(true);
  });
});

describe('parseChatChunk', () => {
  it('parse_invalidJson_throwsWithChunk', () => {
    expect(() => parseChatChunk('{"choices": [')).toThrow(/\{\\"choices\\": \[/);
  });

  it('parse_notAnObject_throwsWithChunk', () => {
    expect(() => parseChatChunk('42')).toThrow(/42/);
  });

  it('parse_unexpectedFieldShapes_toleratesThem', () => {
    const chunk = parseChatChunk(JSON.stringify({ model: 7, choices: 'x', extra: true }));

    expect(chunk.choices).toEqual([]);
    expect(chunk.model).toBeUndefined();
  });
});

describe('sseData', () => {
  it('sseData_controlLines_returnNull', () => {
    expect(['', ': keep-alive', 'event: ping', 'data: [DONE]', 'data:'].map(sseData)).toEqual([null, null, null, null, null]);
  });

  it('sseData_dataLineWithCrlf_returnsPayload', () => {
    expect(sseData('data: {"a":1}\r')).toBe('{"a":1}');
  });
});

describe('ToolCallAccumulator', () => {
  it('add_fragmentWithoutIndexOrId_continuesLastCall', () => {
    const acc = new ToolCallAccumulator();
    acc.add({ index: 0, id: 'c', function: { name: 'Read', arguments: '{"x"' } });

    const fragment = acc.add({ function: { arguments: ':1}' } });

    expect(fragment).toMatchObject({ slot: 0, opened: false });
    expect(acc.calls()[0]!.argumentsJson).toBe('{"x":1}');
  });

  it('calls_slotWithoutName_isDropped', () => {
    const acc = new ToolCallAccumulator();
    acc.add({ index: 3, function: { arguments: '{}' } });

    expect(acc.calls()).toEqual([]);
    expect(acc.size).toBe(1);
  });
});

describe('parseFinishReason', () => {
  it('parse_knownAndUnknown_mapsToNeutral', () => {
    expect(['stop', 'tool_calls', 'function_call', 'length', 'content_filter', '', null].map(parseFinishReason)).toEqual([
      'stop',
      'tool_calls',
      'tool_calls',
      'length',
      'other',
      null,
      null,
    ]);
  });
});

describe('ThinkTagSplitter', () => {
  const run = (...chunks: string[]): StreamPart[] => {
    const splitter = new ThinkTagSplitter();
    return [...chunks.flatMap((chunk) => splitter.push(chunk)), ...splitter.end()];
  };
  const joined = (parts: StreamPart[], kind: 'text' | 'thinking') => parts.flatMap((p) => (p.kind === kind ? [p.text] : [])).join('');

  it('split_thinkTagsAcrossChunks_routesToThinking', () => {
    const parts = run('<thi', 'nk>pienso ', 'mucho</th', 'ink>\n\nRespuesta');

    expect(joined(parts, 'thinking')).toBe('pienso mucho');
    expect(joined(parts, 'text')).toBe('Respuesta');
  });

  it('split_thinkInTheMiddle_isLeftAsText', () => {
    const parts = run('Hola <think>esto no</think> fin');

    expect(joined(parts, 'text')).toBe('Hola <think>esto no</think> fin');
    expect(joined(parts, 'thinking')).toBe('');
  });

  it('split_unclosedThink_isThinkingAtEnd', () => {
    expect(joined(run('<think>sin cerrar'), 'thinking')).toBe('sin cerrar');
  });

  it('split_shortTextNotATag_flushesAtEnd', () => {
    expect(run('<th')).toEqual([{ kind: 'text', text: '<th' }]);
  });
});
