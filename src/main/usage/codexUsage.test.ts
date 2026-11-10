import { describe, expect, it } from 'vitest';
import { parseCodexLines } from './codexUsage';
import { localTimeOf } from './usageHistory';

const UTC = (ms: number) => localTimeOf(ms, 0);
const AT = '2026-11-09T10:00:00.000Z';
const line = (type: string, payload: Record<string, unknown>, at = AT): string => JSON.stringify({ timestamp: at, type, payload });

// Formas MEDIDAS en los registros del usuario (codex-cli 0.16x).
const usageRecord = (responseId: string, input: number, cached: number, output: number): string =>
  line('token_usage_record', { response_id: responseId, usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output } });
const tokenCount = (fiveHour: number, weekly: number, reached: string | null, at = AT): string =>
  line('event_msg', { type: 'token_count', info: null, rate_limits: { primary: { used_percent: fiveHour, window_minutes: 300 }, secondary: { used_percent: weekly, window_minutes: 10080 }, rate_limit_reached_type: reached } }, at);

const START = { recentIds: [] };

describe('parseCodexLines', () => {
  it('parseCodexLines_respuesta_usoSinLaCacheEnLaEntradaConSuModelo', () => {
    const lines = [line('session_meta', { cwd: 'C:/p' }), line('turn_context', { model: 'gpt-6.1-sol' }), usageRecord('r1', 1000, 600, 50)];

    const parsed = parseCodexLines(lines, START, UTC);

    expect(parsed.days['2026-11-09']?.byModel).toEqual({ 'gpt-6.1-sol': { inputTokens: 400, outputTokens: 50, cacheReadTokens: 600, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, turns: 1 } });
    expect(parsed.state.cwd).toBe('C:/p');
  });

  it('parseCodexLines_mismaRespuestaDosVeces_cuentaUna', () => {
    const lines = [line('turn_context', { model: 'gpt-6-luna' }), usageRecord('r1', 10, 0, 1), usageRecord('r1', 10, 0, 1)];

    expect(parseCodexLines(lines, START, UTC).days['2026-11-09']?.byModel['gpt-6-luna']?.turns).toBe(1);
  });

  it('parseCodexLines_promptLargo_tramoLargo', () => {
    const lines = [line('turn_context', { model: 'gpt-6.1-sol' }), usageRecord('r1', 300_000, 0, 1)];

    expect(Object.keys(parseCodexLines(lines, START, UTC).days['2026-11-09']?.byModel ?? {})).toEqual(['gpt-6.1-sol#long']);
  });

  it('parseCodexLines_tokenCount_picosPorDuracionDeVentana', () => {
    const lines = [tokenCount(10, 40, null), tokenCount(25, 38, null)];

    expect(parseCodexLines(lines, START, UTC).days['2026-11-09']?.peaks).toEqual({ fiveHourMax: 25, sevenDayMax: 40 });
  });

  it('parseCodexLines_enElTopeVariasVeces_cuentaUnTopeHastaQueSale', () => {
    const lines = [tokenCount(100, 50, 'primary'), tokenCount(100, 50, 'primary'), tokenCount(20, 50, null), tokenCount(100, 100, 'secondary')];

    expect(parseCodexLines(lines, START, UTC).days['2026-11-09']?.limits).toEqual({ fiveHour: 1, weekly: 1, other: 0 });
  });

  it('parseCodexLines_herramientas_lasCuenta', () => {
    const lines = [line('response_item', { type: 'function_call', name: 'shell' }), line('response_item', { type: 'custom_tool_call', name: 'apply_patch' }), line('response_item', { type: 'function_call', name: 'shell' })];

    expect(parseCodexLines(lines, START, UTC).days['2026-11-09']?.tools).toEqual({ shell: 2, apply_patch: 1 });
  });

  it('parseCodexLines_sinModeloTodavia_claveSinPrecio', () => {
    expect(Object.keys(parseCodexLines([usageRecord('r1', 1, 0, 1)], START, UTC).days['2026-11-09']?.byModel ?? {})).toEqual(['codex']);
  });

  it('parseCodexLines_lineasRotasOSinFecha_seCuentanOIgnoran', () => {
    const parsed = parseCodexLines(['{rota', JSON.stringify({ type: 'turn_context', payload: { model: 'x' } }), ''], START, UTC);

    expect(parsed.invalidLines).toBe(1);
    expect(parsed.days).toEqual({});
  });
});
