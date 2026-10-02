import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './chatClient';
import { compactedHistory, splitForCompaction, SUMMARY_PREFIX, summaryRequest } from './compaction';
import { parseTextToolCalls, textToolInstructions } from './textToolCalls';

const estimate = (messages: readonly ChatMessage[]): number => messages.reduce((total, m) => total + Math.ceil((m.content ?? '').length / 4) + 4, 0);
const user = (text: string): ChatMessage => ({ role: 'user', content: text });
const assistant = (text: string): ChatMessage => ({ role: 'assistant', content: text });

describe('splitForCompaction', () => {
  const history: ChatMessage[] = [
    user('uno'),
    assistant('x'.repeat(400)),
    user('dos'),
    { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'Read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'c', content: 'y'.repeat(400) },
    user('tres'),
    assistant('fin'),
  ];

  it('split_cutsBeforeAUserMessage_neverBetweenCallAndResult', () => {
    const split = splitForCompaction(history, 20, estimate);

    expect(split?.tail[0]).toEqual(user('tres'));
    expect(split?.head).toHaveLength(5);
  });

  it('split_bigBudget_keepsMoreButSummarizesTheFirst', () => {
    const split = splitForCompaction(history, 10_000, estimate);

    expect(split?.tail[0]).toEqual(user('dos'));
  });

  it('split_singleExchange_nothingToSummarize', () => {
    expect(splitForCompaction([user('a'), assistant('b')], 10, estimate)).toBeNull();
  });
});

describe('summaryRequest y compactedHistory', () => {
  it('request_isPlainTextWithoutToolCalls', () => {
    const request = summaryRequest([user('hola'), { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'Bash', arguments: '{"command":"ls"}' } }] }], 1_000);

    expect(request.map((m) => m.role)).toEqual(['system', 'user']);
    expect(request[1]!.content).toContain('[calls Bash {"command":"ls"}]');
  });

  it('request_longHead_isClippedFromTheStart', () => {
    const request = summaryRequest([user('a'.repeat(10_000)), user('ultimo')], 500);

    expect((request[1]!.content ?? '').length).toBeLessThan(2_000);
    expect(request[1]!.content).toContain('ultimo');
  });

  it('history_summaryThenAckThenTail', () => {
    const result = compactedHistory(' resumen ', [user('tres')]);

    expect(result.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(result[0]!.content).toBe(`${SUMMARY_PREFIX}\n\nresumen`);
  });
});

const KNOWN = (name: string): boolean => ['Read', 'Glob', 'Bash'].includes(name);

describe('parseTextToolCalls', () => {
  it('callsOf_nativeToolsAndFencedPackageJson_noCall', () => {
    // A1: un manifest citado (`name` de paquete) o un nombre que no es herramienta no es una llamada.
    expect(parseTextToolCalls('Este es:\n```json\n{"name": "mage", "version": "0.1.2"}\n```', KNOWN)).toEqual([]);
    expect(parseTextToolCalls('<tool_call>{"name": "Borrar", "arguments": {}}</tool_call>', KNOWN)).toEqual([]);
  });

  it('parse_fencedCallNotLast_ignored', () => {
    expect(parseTextToolCalls('```json\n{"name":"Bash","arguments":{"command":"ls"}}\n```\nY luego te explico.', KNOWN)).toEqual([]);
  });

  it('parse_taggedQwenStyle', () => {
    expect(parseTextToolCalls('Voy.\n<tool_call>{"name": "Read", "arguments": {"file_path": "a"}}</tool_call>', KNOWN)).toEqual([{ name: 'Read', argumentsJson: '{"file_path":"a"}' }]);
  });

  it('parse_lmStudioRequest_andParametersKey', () => {
    expect(parseTextToolCalls('[TOOL_REQUEST]{"name":"Glob","parameters":{"pattern":"*"}}[END_TOOL_REQUEST]', KNOWN)).toEqual([{ name: 'Glob', argumentsJson: '{"pattern":"*"}' }]);
  });

  it('parse_fencedJson_onlyIfItIsACall', () => {
    expect(parseTextToolCalls('```json\n{"name":"Bash","arguments":{"command":"ls"}}\n```', KNOWN)).toHaveLength(1);
    expect(parseTextToolCalls('```json\n{"version": 1}\n```', KNOWN)).toEqual([]);
  });

  it('parse_brokenJson_ignored', () => {
    expect(parseTextToolCalls('<tool_call>{"name": roto}</tool_call>', KNOWN)).toEqual([]);
  });

  it('parse_twoCalls_bothInOrder', () => {
    const text = '<tool_call>{"name":"Read","arguments":{}}</tool_call><tool_call>{"name":"Glob","arguments":"{\\"pattern\\":\\"*\\"}"}</tool_call>';

    expect(parseTextToolCalls(text, KNOWN).map((call) => call.name)).toEqual(['Read', 'Glob']);
    expect(parseTextToolCalls(text, KNOWN)[1]!.argumentsJson).toBe('{"pattern":"*"}');
  });

  it('instructions_listToolsWithFields', () => {
    const guide = textToolInstructions([{ name: 'Read', description: 'Read a file.\nMore', parameters: { properties: { file_path: {}, offset: {} }, required: ['file_path'] } }]);

    expect(guide).toContain('- Read(file_path, offset?): Read a file.');
    expect(guide).toContain('<tool_call>');
  });
});
