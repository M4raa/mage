import { describe, expect, it } from 'vitest';
import { initSummary, requestsOf } from '../../spike/bench/transcript.mjs';

const assistant = (id, usage, text = 'x') => JSON.stringify({ type: 'assistant', message: { id, usage, content: [{ type: 'text', text }] } });

describe('peticiones de una transcripción de Claude (H3)', () => {
  it('requestsOf_variasEntradasDelMismoId_unaPeticionPorId', () => {
    const usage = { input_tokens: 4, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 7 };
    const jsonl = [
      JSON.stringify({ type: 'user', message: { content: 'hola' } }),
      assistant('msg_1', usage, 'a'),
      assistant('msg_1', usage, 'b'),
      assistant('msg_2', { input_tokens: 1, output_tokens: 2 }),
      '',
    ].join('\n');

    const requests = requestsOf(jsonl);

    expect(requests).toEqual([
      { id: 'msg_1', input: 4, cacheRead: 100, cacheCreate: 20, output: 7 },
      { id: 'msg_2', input: 1, cacheRead: 0, cacheCreate: 0, output: 2 },
    ]);
  });

  it('requestsOf_sinAsistente_vacio', () => {
    expect(requestsOf(JSON.stringify({ type: 'user', message: { content: 'hola' } }))).toEqual([]);
  });

  it('initSummary_initCrudoYNormalizado_mismosNombres', () => {
    const raw = JSON.stringify({ tools: ['Read', 'Bash'], mcp_servers: [{ name: 'bench', status: 'connected' }], skills: ['s'], plugins: [], slash_commands: ['a', 'b'] });
    const normalized = JSON.stringify({ tools: ['Bash', 'Read'], mcpServers: [{ name: 'bench', status: 'connected' }], skills: ['s'], plugins: [], slashCommands: ['a', 'b'] });

    expect(initSummary(raw)).toEqual(initSummary(normalized));
    expect(initSummary(raw)).toEqual({ tools: ['Bash', 'Read'], mcpServers: ['bench'], skills: ['s'], plugins: [], slashCommands: 2 });
  });

  it('initSummary_vacio_null', () => {
    expect(initSummary('')).toBeNull();
  });
});
