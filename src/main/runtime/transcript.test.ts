import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deriveConversationMeta } from '../conversations/conversationMeta';
import { TranscriptAssistantLineSchema, TranscriptLineEnvelopeSchema, TranscriptUserLineSchema } from '../transcripts/schemas';
import type { LoopEvent, TurnOutcome } from './agentLoop';
import type { ChatMessage } from './chatClient';
import { transcriptToMessages } from './transcriptToMessages';
import { TranscriptWriter } from './transcriptWriter';

// Escritor contra un "disco" en memoria: ruta -> lineas.
function memoryWriter(sessionId = 's1') {
  const files = new Map<string, string[]>();
  let id = 0;
  const writer = new TranscriptWriter(sessionId, {
    root: '/datos/runtime',
    cwd: '/proj',
    model: () => 'qwen',
    mkdir: () => undefined,
    appendLine: (path, line) => files.set(path, [...(files.get(path) ?? []), line.trimEnd()]),
    now: () => Date.UTC(2026, 9, 1),
    newId: () => `u${++id}`,
  });
  return { writer, files, lines: () => [...files.values()].flat() };
}

const OUTCOME: TurnOutcome = { status: 'success', rounds: 2, usage: null, error: null, toolsEnabled: true };

// Un turno tipico: Read con su resultado y el texto final, en el orden en que los emite el bucle.
function recordTurn(writer: TranscriptWriter): void {
  const events: LoopEvent[] = [
    { kind: 'request_started' },
    { kind: 'text_delta', text: 'Voy a ' },
    { kind: 'text_delta', text: 'leerlo.' },
    { kind: 'tool_use', id: 'call_1', name: 'Read', input: { file_path: 'hola.txt' } },
    { kind: 'round_done', usage: { inputTokens: 40, outputTokens: 8 }, requestMessages: 2 },
    { kind: 'tool_result', id: 'call_1', isError: false, output: '     1\thola', durationMs: 3 },
    { kind: 'request_started' },
    { kind: 'text_delta', text: 'Dice hola.' },
    { kind: 'round_done', usage: null, requestMessages: 4 },
  ];
  writer.user('lee hola.txt');
  for (const event of events) writer.loop(event);
  writer.turnEnd([], OUTCOME);
}

const EXPECTED: ChatMessage[] = [
  { role: 'user', content: 'lee hola.txt' },
  { role: 'assistant', content: 'Voy a leerlo.', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'Read', arguments: '{"file_path":"hola.txt"}' } }] },
  { role: 'tool', tool_call_id: 'call_1', content: '     1\thola' },
  { role: 'assistant', content: 'Dice hola.' },
];

describe('TranscriptWriter + transcriptToMessages', () => {
  it('roundTrip_turn_rebuildsTheSameMessages', () => {
    const { writer, lines } = memoryWriter();

    recordTurn(writer);

    expect(transcriptToMessages(lines()).messages).toEqual(EXPECTED);
  });

  it('write_path_isUnderRuntimeProjectsWithEncodedCwd', () => {
    const { writer, files } = memoryWriter();

    recordTurn(writer);

    expect([...files.keys()]).toEqual([join('/datos/runtime', 'projects', '-proj', 's1.jsonl')]);
  });

  it('write_lines_passCliSchemasAndChainParents', () => {
    const { writer, lines } = memoryWriter();

    recordTurn(writer);
    const parsed = lines().map((line) => JSON.parse(line) as Record<string, unknown>);

    for (const line of parsed) expect(TranscriptLineEnvelopeSchema.safeParse(line).success).toBe(true);
    expect(parsed.filter((l) => l.type === 'user').every((l) => TranscriptUserLineSchema.safeParse(l).success)).toBe(true);
    expect(parsed.filter((l) => l.type === 'assistant').every((l) => TranscriptAssistantLineSchema.safeParse(l).success)).toBe(true);
    expect(parsed.map((l) => l.parentUuid)).toEqual([null, 'u1', 'u2', 'u3']);
  });

  it('write_meta_derivesTitleAndCwd', () => {
    const { writer, lines } = memoryWriter();

    recordTurn(writer);
    writer.rename('Leer el saludo');

    expect(deriveConversationMeta(lines())).toMatchObject({ title: 'Leer el saludo', cwd: '/proj' });
  });

  it('write_toolResultWithFile_carriesToolUseResultForTheDiff', () => {
    const { writer, lines } = memoryWriter();
    const patch = [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }];

    writer.loop({ kind: 'tool_result', id: 'c', isError: false, output: 'ok', durationMs: 1, file: { path: '/proj/a', content: null, structuredPatch: patch } });

    expect(JSON.parse(lines()[0]!)).toMatchObject({ toolUseResult: { filePath: '/proj/a', structuredPatch: patch } });
  });

  it('reset_newSessionId_writesToANewFile', () => {
    const { writer, files } = memoryWriter();
    writer.user('uno');

    writer.reset('s2');
    writer.user('dos');

    expect([...files.keys()].map((path) => path.endsWith('s1.jsonl') || path.endsWith('s2.jsonl'))).toEqual([true, true]);
    expect(files.size).toBe(2);
  });

  it('write_diskFails_logsOnceAndKeepsGoing', () => {
    const logs: string[] = [];
    const writer = new TranscriptWriter('s', {
      root: '/r',
      cwd: '/p',
      model: () => 'm',
      mkdir: () => undefined,
      appendLine: () => {
        throw new Error('ENOSPC');
      },
      now: () => 0,
      newId: () => 'u',
      log: (_level, message) => logs.push(message),
    });

    writer.user('a');
    writer.user('b');

    expect(logs).toHaveLength(1);
  });
});

describe('transcriptToMessages', () => {
  it('resume_cliGatewayFixture_mergesSplitAssistantLines', () => {
    const lines = readFileSync(join(__dirname, '__fixtures__', 'gateway-session.jsonl'), 'utf8').split(/\r?\n/);

    const { messages, lastUuid } = transcriptToMessages(lines);

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(messages[1]).toMatchObject({ content: 'Voy a leerlo.', tool_calls: [{ id: 'toolu_1' }] });
    expect(lastUuid).toBe('a3');
  });

  it('resume_corruptLastLine_ignoredWithWarning', () => {
    const { messages, warnings } = transcriptToMessages([JSON.stringify({ type: 'user', message: { role: 'user', content: 'hola' } }), '{"type":"assis']);

    expect(messages).toEqual([{ role: 'user', content: 'hola' }]);
    expect(warnings).toEqual(['Línea 2 de la transcripción no es JSON válido: se ignora']);
  });

  it('resume_callWithoutResult_getsSyntheticResult', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'ls' } }] } }),
    ];

    expect(transcriptToMessages(lines).messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
  });

  it('resume_empty_noMessages', () => {
    expect(transcriptToMessages([]).messages).toEqual([]);
  });

  it('resume_sidechainAndMetaLines_skipped', () => {
    const lines = [
      JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: '<aviso>' } }),
      JSON.stringify({ type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'sub' }] } }),
    ];

    expect(transcriptToMessages(lines).messages).toEqual([]);
  });
});
