import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adaptCodexLine, codexTurnsToLines, isCodexInjectedContext, readCodexRolloutHead } from './codexTranscript';

// Rollout sintético con la forma medida en codex-cli 0.160.0 (sin contenido real).
const lines = readFileSync(join(__dirname, 'fixtures', 'codex-rollout.jsonl'), 'utf8').split('\n').filter((l) => l.length > 0);

describe('adaptCodexLine', () => {
  it('adaptCodexLine_mensajeDeUsuarioReal_esUnUserNoMeta', () => {
    const out = adaptCodexLine(JSON.parse(lines[3]!));

    expect(out).toMatchObject({ type: 'user', isMeta: false, message: { content: 'Lista los ficheros\ny luego resume' } });
  });

  it('adaptCodexLine_contextoInyectadoYDeveloper_sonMeta', () => {
    expect(adaptCodexLine(JSON.parse(lines[1]!))).toMatchObject({ type: 'user', isMeta: true });
    expect(adaptCodexLine(JSON.parse(lines[2]!))).toMatchObject({ type: 'user', isMeta: true });
  });

  it('adaptCodexLine_llamadaYSalida_emparejanPorCallId', () => {
    expect(adaptCodexLine(JSON.parse(lines[5]!))).toMatchObject({ message: { content: [{ type: 'tool_use', id: 'call_1', name: 'shell', input: { command: ['ls'] } }] } });
    expect(adaptCodexLine(JSON.parse(lines[8]!))).toMatchObject({ message: { content: [{ type: 'tool_result', tool_use_id: 'call_2', content: 'Script completed1' }] } });
  });

  it('adaptCodexLine_noConversacion_salePorTipoCodex', () => {
    expect(adaptCodexLine(JSON.parse(lines[4]!)).type).toBe('codex-reasoning');
    expect(adaptCodexLine(JSON.parse(lines[9]!)).type).toBe('codex-event_msg');
    expect(adaptCodexLine('basura').type).toBe('codex-unknown');
  });

  it('adaptCodexLine_argumentosNoJson_seConservanComoTexto', () => {
    const out = adaptCodexLine({ type: 'response_item', payload: { type: 'function_call', call_id: 'c', name: 'x', arguments: '{roto' } });

    expect(out).toMatchObject({ message: { content: [{ input: { arguments: '{roto' } }] } });
  });
});

describe('isCodexInjectedContext', () => {
  it.each([
    ['<environment_context>x', true],
    ['  # AGENTS.md instructions', true],
    ['hola', false],
    ['', false],
  ])('isCodexInjectedContext_%s_%s', (text, expected) => {
    expect(isCodexInjectedContext(text)).toBe(expected);
  });
});

describe('readCodexRolloutHead', () => {
  it('readCodexRolloutHead_rolloutNormal_idCwdYTituloDelPrimerPrompt', () => {
    expect(readCodexRolloutHead(lines)).toEqual({
      sessionId: '11111111-2222-3333-4444-555555555555',
      cwd: 'C:\\proyecto',
      startedAtMs: Date.parse('2026-10-05T08:00:00.000Z'),
      title: 'Lista los ficheros',
    });
  });

  it('readCodexRolloutHead_primeroUnToolResultYLuegoTexto_noUsaElResultadoComoTitulo', () => {
    const toolResult = JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'c', output: 'x' } });

    expect(readCodexRolloutHead([lines[0]!, toolResult, lines[3]!])?.title).toBe('Lista los ficheros');
  });

  it('readCodexRolloutHead_sinSessionMeta_null', () => {
    expect(readCodexRolloutHead([lines[3]!])).toBeNull();
    expect(readCodexRolloutHead([])).toBeNull();
  });
});

describe('codexTurnsToLines', () => {
  const COMMAND = { type: 'commandExecution', id: 'c1', command: 'ls', cwd: 'C:\\p', status: 'completed', aggregatedOutput: 'a.txt', exitCode: 0 };
  const turn = (...items: unknown[]) => [{ id: 't1', items }];

  it('codexTurnsToLines_mensajesYComando_lineasDeClaude', () => {
    const out = codexTurnsToLines(turn(
      { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Hola', text_elements: [] }] },
      COMMAND,
      { type: 'agentMessage', id: 'a1', text: 'Hecho' },
    ));

    expect(out).toEqual([
      { uuid: 'codex-u1', isSidechain: false, type: 'user', isMeta: false, message: { role: 'user', content: 'Hola' } },
      { uuid: 'codex-c1', isSidechain: false, type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input: { command: 'ls', cwd: 'C:\\p' } }] } },
      { uuid: 'codex-c1-result', isSidechain: false, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'a.txt', is_error: false }] } },
      { uuid: 'codex-a1', isSidechain: false, type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Hecho' }] } },
    ]);
  });

  it('codexTurnsToLines_comandoConSalidaDistintaDeCero_esError', () => {
    const out = codexTurnsToLines(turn({ ...COMMAND, exitCode: 1 }));

    expect(out[1]).toMatchObject({ message: { content: [{ type: 'tool_result', is_error: true }] } });
  });

  it('codexTurnsToLines_cambioDeclinado_esErrorConSuDiff', () => {
    const changes = [{ path: 'a', diff: '+x' }];

    const out = codexTurnsToLines(turn({ type: 'fileChange', id: 'f1', status: 'declined', changes }));

    expect(out[0]).toMatchObject({ message: { content: [{ type: 'tool_use', name: 'apply_patch', input: { changes } }] } });
    expect(out[1]).toMatchObject({ message: { content: [{ type: 'tool_result', content: '+x', is_error: true }] } });
  });

  it('codexTurnsToLines_mcp_nombreYTexto', () => {
    const out = codexTurnsToLines(turn({
      type: 'mcpToolCall', id: 'm1', server: 'fs', tool: 'read', arguments: { p: 1 }, status: 'completed',
      result: { content: [{ type: 'text', text: 'uno' }, { type: 'image' }, { type: 'text', text: 'dos' }] },
    }));

    expect(out[0]).toMatchObject({ message: { content: [{ type: 'tool_use', name: 'mcp__fs__read', input: { p: 1 } }] } });
    expect(out[1]).toMatchObject({ message: { content: [{ type: 'tool_result', content: 'uno\ndos', is_error: false }] } });
  });

  it('codexTurnsToLines_razonamiento_esMetadato', () => {
    const out = codexTurnsToLines(turn({ type: 'reasoning', id: 'r1', summary: [], content: [] }));

    expect(out).toEqual([{ uuid: 'codex-r1', isSidechain: false, type: 'codex-reasoning' }]);
  });

  it('codexTurnsToLines_itemSinIdONulo_codexUnknown', () => {
    expect(codexTurnsToLines(turn({ type: 'agentMessage' }, null))).toEqual([{ type: 'codex-unknown' }, { type: 'codex-unknown' }]);
  });

  it('codexTurnsToLines_contextoInyectado_esMeta', () => {
    const out = codexTurnsToLines(turn({ type: 'userMessage', id: 'u1', content: [{ type: 'text', text: '<environment_context>x' }] }));

    expect(out[0]).toMatchObject({ isMeta: true });
  });

  it('codexTurnsToLines_sinTurnos_vacio', () => {
    expect(codexTurnsToLines([])).toEqual([]);
  });
});
