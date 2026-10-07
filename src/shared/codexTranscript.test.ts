import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { adaptCodexLine, isCodexInjectedContext, readCodexRolloutHead } from './codexTranscript';

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
