import { describe, expect, it } from 'vitest';
import { buildSubagentList } from './subagentView';
import type { TranscriptEntry } from '@shared/transcripts';
import { makeEntry } from '@testing/transcriptEntry';

function entry(kind: string, raw: unknown, index: number): TranscriptEntry {
  return makeEntry({ kind, raw, index, category: 'turn', summary: kind });
}

// Linea assistant que invoca un subagente (tool `Agent`/`Task`).
function agentInvocation(index: number, toolUseId: string, name: string, subagentType: string, description: string): TranscriptEntry {
  return entry(
    'assistant',
    {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name, input: { subagent_type: subagentType, description } }] },
    },
    index,
  );
}

// Linea user que trae el resultado async del subagente (toolUseResult con agentId/status).
function agentResult(index: number, toolUseId: string, agentId: string, status: string): TranscriptEntry {
  return entry(
    'user',
    {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text: 'Async agent launched' }] }] },
      toolUseResult: { isAsync: true, status, agentId, description: 'x' },
    },
    index,
  );
}

describe('buildSubagentList', () => {
  it('emparejaAgentConSuResultadoPorToolUseId', () => {
    const entries = [
      agentInvocation(0, 'toolu_014', 'Agent', 'Explore', 'Mapear datos'),
      agentResult(1, 'toolu_014', 'a5b64d67d89b1b5b2', 'async_launched'),
    ];

    const list = buildSubagentList(entries);

    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({
      toolUseId: 'toolu_014',
      entryIndex: 0,
      agentType: 'Explore',
      description: 'Mapear datos',
      agentId: 'a5b64d67d89b1b5b2',
      status: 'async_launched',
    });
  });

  it('soportaElNombreTaskAdemasDeAgent', () => {
    const entries = [
      agentInvocation(0, 'toolu_t', 'Task', 'general-purpose', 'tarea'),
      agentResult(1, 'toolu_t', 'agentXYZ', 'completed'),
    ];
    expect(buildSubagentList(entries)[0]?.agentType).toBe('general-purpose');
    expect(buildSubagentList(entries)[0]?.agentId).toBe('agentXYZ');
  });

  it('sinSubagentes_devuelveVacio', () => {
    const entries = [
      entry('assistant', { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'ls' } }] } }, 0),
      entry('user', { type: 'user', message: { role: 'user', content: 'hola' } }, 1),
    ];
    expect(buildSubagentList(entries)).toEqual([]);
  });

  it('invocacionSinResultadoTodavia_agentIdYStatusNull', () => {
    const list = buildSubagentList([agentInvocation(0, 'toolu_pending', 'Agent', 'Explore', 'pendiente')]);
    expect(list).toHaveLength(1);
    expect(list[0]?.agentId).toBeNull();
    expect(list[0]?.status).toBeNull();
  });

  it('variosSubagentes_enOrdenDeInvocacion', () => {
    const entries = [
      agentInvocation(0, 'toolu_1', 'Agent', 'Explore', 'uno'),
      agentInvocation(1, 'toolu_2', 'Agent', 'claude-code-guide', 'dos'),
      agentResult(2, 'toolu_2', 'agent2', 'async_launched'),
      agentResult(3, 'toolu_1', 'agent1', 'async_launched'),
    ];
    const list = buildSubagentList(entries);
    expect(list.map((s) => s.toolUseId)).toEqual(['toolu_1', 'toolu_2']);
    expect(list.map((s) => s.agentId)).toEqual(['agent1', 'agent2']);
  });
});
