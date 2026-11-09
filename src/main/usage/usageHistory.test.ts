import { describe, expect, it } from 'vitest';
import { aggregateHistory, INITIAL_PARSE_STATE, localDayKey, mergeDayMaps, parseUsageLines, pruneWindowPeaks, recordWindowPeak } from './usageHistory';

const UTC = (ms: number): string => localDayKey(ms, 0);

function assistantLine(id: string, at: string, usage: Record<string, number>, block = 'text'): string {
  return JSON.stringify({ type: 'assistant', timestamp: at, message: { id, role: 'assistant', content: [{ type: block }], usage } });
}

const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40 };

describe('localDayKey', () => {
  it('localDayKey_desfaseAlEste_cambiaDeDiaALaMedianocheLocal', () => {
    const ms = Date.parse('2026-11-08T23:30:00.000Z');

    expect(localDayKey(ms, 0)).toBe('2026-11-08');
    expect(localDayKey(ms, 60)).toBe('2026-11-09');
  });

  it('localDayKey_noFinito_lanza', () => {
    expect(() => localDayKey(Number.NaN, 0)).toThrow(/NaN/);
  });
});

describe('parseUsageLines', () => {
  it('parseUsageLines_variasLineasDelMismoMensaje_cuentaUnaVez', () => {
    const lines = [
      assistantLine('msg_1', '2026-11-09T10:00:00.000Z', USAGE, 'thinking'),
      assistantLine('msg_1', '2026-11-09T10:00:01.000Z', USAGE, 'text'),
      assistantLine('msg_1', '2026-11-09T10:00:02.000Z', USAGE, 'tool_use'),
    ];

    const parsed = parseUsageLines(lines, INITIAL_PARSE_STATE, UTC);

    expect(parsed.days['2026-11-09']).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 300, cacheCreationTokens: 40, turns: 1 });
  });

  it('parseUsageLines_mensajeQueSigueEnElTrozoSiguiente_noSeCuentaDosVeces', () => {
    const first = parseUsageLines([assistantLine('msg_1', '2026-11-09T10:00:00.000Z', USAGE)], INITIAL_PARSE_STATE, UTC);

    const second = parseUsageLines([assistantLine('msg_1', '2026-11-09T10:00:01.000Z', USAGE), assistantLine('msg_2', '2026-11-09T11:00:00.000Z', USAGE)], first.state, UTC);

    expect(second.days['2026-11-09']?.turns).toBe(1);
  });

  it('parseUsageLines_otrasLineasYRotas_seIgnoranYLasRotasSeCuentan', () => {
    const lines = [
      JSON.stringify({ type: 'user', timestamp: '2026-11-09T10:00:00.000Z', message: { content: 'hola' } }),
      '{"type":"assistant","message":{"usage":{"input_tokens":1',
      assistantLine('msg_9', 'no-es-fecha', USAGE),
      '',
    ];

    const parsed = parseUsageLines(lines, INITIAL_PARSE_STATE, UTC);

    expect(parsed.days).toEqual({});
    expect(parsed.invalidLines).toBe(1);
  });

  it('parseUsageLines_valoresNegativosODecimales_cuentanCero', () => {
    const parsed = parseUsageLines([assistantLine('m', '2026-11-09T10:00:00.000Z', { input_tokens: -5, output_tokens: 2.5 })], INITIAL_PARSE_STATE, UTC);

    expect(parsed.days['2026-11-09']).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns: 1 });
  });
});

describe('aggregateHistory', () => {
  const day = (turns: number) => ({ inputTokens: turns, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns });

  it('aggregateHistory_porIndiceDuenaFijaYSinCuenta_reparteYRecorta', () => {
    const history = aggregateHistory({
      files: [
        { sessionId: 's1', days: { '2026-11-01': day(1), '2026-10-01': day(9) } },
        { sessionId: 's2', days: { '2026-11-02': day(2) } },
        { sessionId: 's3', ownerAccountId: 'b', days: { '2026-11-03': day(3) } },
        { sessionId: 's4', days: { '2026-11-04': day(4) } },
      ],
      accountIds: ['a', 'b'],
      accountOf: (id) => ({ s1: 'a', s2: 'a', s4: 'borrada' })[id],
      windows: { a: { '2026-11-02': { fiveHourMax: 40, sevenDayMax: 10 }, '2026-10-01': { fiveHourMax: 1, sevenDayMax: 1 } } },
      fromDay: '2026-10-15',
      generatedAt: 1,
    });

    expect(history.accounts[0]).toEqual({ accountId: 'a', days: [{ day: '2026-11-01', ...day(1) }, { day: '2026-11-02', ...day(2) }], windows: [{ day: '2026-11-02', fiveHourMax: 40, sevenDayMax: 10 }] });
    expect(history.accounts[1]?.days).toEqual([{ day: '2026-11-03', ...day(3) }]);
    expect(history.unattributed).toEqual([{ day: '2026-11-04', ...day(4) }]);
  });

  it('mergeDayMaps_mismoDia_suma', () => {
    expect(mergeDayMaps({ d: day(1) }, { d: day(2), e: day(1) })).toEqual({ d: day(3), e: day(1) });
  });
});

describe('recordWindowPeak', () => {
  it('recordWindowPeak_guardaElMaximoYNoBorraConNull', () => {
    let peaks = recordWindowPeak(undefined, 'd', { fiveHourMax: 30, sevenDayMax: 5 });
    peaks = recordWindowPeak(peaks, 'd', { fiveHourMax: 20, sevenDayMax: null });
    peaks = recordWindowPeak(peaks, 'd', { fiveHourMax: 45, sevenDayMax: 6 });

    expect(peaks.d).toEqual({ fiveHourMax: 45, sevenDayMax: 6 });
  });

  it('recordWindowPeak_fueraDeRango_seIgnora', () => {
    expect(recordWindowPeak(undefined, 'd', { fiveHourMax: 140, sevenDayMax: -1 }).d).toEqual({ fiveHourMax: null, sevenDayMax: null });
  });

  it('pruneWindowPeaks_quitaLoAnterior', () => {
    expect(pruneWindowPeaks({ '2026-01-01': { fiveHourMax: 1, sevenDayMax: 1 }, '2026-11-01': { fiveHourMax: 2, sevenDayMax: 2 } }, '2026-10-01')).toEqual({ '2026-11-01': { fiveHourMax: 2, sevenDayMax: 2 } });
  });
});
