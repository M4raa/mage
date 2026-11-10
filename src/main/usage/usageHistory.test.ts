import { describe, expect, it } from 'vitest';
import { EMPTY_DETAIL, type DayDetail } from '@shared/usageHistory';
import { aggregateHistory, INITIAL_PARSE_STATE, localDayKey, localTimeOf, mergeDayMaps, parseUsageLines, pruneWindowPeaks, recordWindowPeak } from './usageHistory';

const UTC = (ms: number) => localTimeOf(ms, 0);

interface LineOptions {
  readonly block?: string;
  readonly model?: string;
  readonly toolName?: string;
  readonly cwd?: string;
  readonly speed?: string;
}

function assistantLine(id: string, at: string, usage: Record<string, unknown>, options: LineOptions = {}): string {
  const block = options.block ?? 'text';
  const content = [{ type: block, ...(block === 'tool_use' ? { id: `toolu_${id}`, name: options.toolName ?? 'Bash' } : {}) }];
  return JSON.stringify({
    type: 'assistant',
    timestamp: at,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    message: { id, role: 'assistant', model: options.model ?? 'claude-opus-5-5', content, usage: { ...usage, ...(options.speed === undefined ? {} : { speed: options.speed }) } },
  });
}

function limitLine(uuid: string, at: string, text: string): string {
  return JSON.stringify({ type: 'assistant', uuid, timestamp: at, isApiErrorMessage: true, error: 'rate_limit', message: { id: `err-${uuid}`, model: '<synthetic>', content: [{ type: 'text', text }], usage: { input_tokens: 0, output_tokens: 0 } } });
}

// Uso de una respuesta con la escritura de caché desglosada (forma MEDIDA en 2.1.319).
const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 40, cache_creation: { ephemeral_5m_input_tokens: 15, ephemeral_1h_input_tokens: 25 } };
const OPUS = { inputTokens: 10, outputTokens: 20, cacheReadTokens: 300, cacheWrite5mTokens: 15, cacheWrite1hTokens: 25, turns: 1 };

function onlyModels(byModel: Record<string, unknown>): DayDetail {
  const hours = new Array<number>(24).fill(0);
  return { ...EMPTY_DETAIL, hours, byModel: byModel as DayDetail['byModel'] };
}

describe('localTimeOf', () => {
  it('localTimeOf_desfaseAlEste_cambiaDeDiaYHoraALaMedianocheLocal', () => {
    const ms = Date.parse('2026-11-08T23:30:00.000Z');

    expect(localTimeOf(ms, 0)).toEqual({ day: '2026-11-08', hour: 23 });
    expect(localTimeOf(ms, 60)).toEqual({ day: '2026-11-09', hour: 0 });
    expect(localDayKey(ms, 60)).toBe('2026-11-09');
  });

  it('localTimeOf_noFinito_lanza', () => {
    expect(() => localTimeOf(Number.NaN, 0)).toThrow(/NaN/);
  });
});

describe('parseUsageLines', () => {
  it('parseUsageLines_variasLineasDelMismoMensaje_usoUnaVezYCadaHerramienta', () => {
    const lines = [
      assistantLine('msg_1', '2026-11-09T10:00:00.000Z', USAGE, { block: 'thinking' }),
      assistantLine('msg_1', '2026-11-09T10:00:01.000Z', USAGE, { block: 'tool_use', toolName: 'Read' }),
      assistantLine('msg_1', '2026-11-09T10:00:02.000Z', USAGE, { block: 'tool_use', toolName: 'Bash' }),
    ];

    const day = parseUsageLines(lines, INITIAL_PARSE_STATE, UTC).days['2026-11-09'];

    expect(day?.byModel).toEqual({ 'claude-opus-5-5': OPUS });
    expect(day?.tools).toEqual({ Read: 1, Bash: 1 });
    expect(day?.hours[10]).toBe(1);
  });

  it('parseUsageLines_sinDesgloseDeCache_todaLaEscrituraA5Minutos', () => {
    const { cache_creation: _breakdown, ...legacy } = USAGE;

    const day = parseUsageLines([assistantLine('m', '2026-11-09T10:00:00.000Z', legacy)], INITIAL_PARSE_STATE, UTC).days['2026-11-09'];

    expect(day?.byModel['claude-opus-5-5']).toMatchObject({ cacheWrite5mTokens: 40, cacheWrite1hTokens: 0 });
  });

  it('parseUsageLines_haikuConPromptLargoYOpusRapido_clavesDeTramo', () => {
    const long = { input_tokens: 100_001, output_tokens: 1 };
    const lines = [
      assistantLine('a', '2026-11-09T10:00:00.000Z', long, { model: 'claude-haiku-5-5' }),
      assistantLine('b', '2026-11-09T10:00:00.000Z', USAGE, { speed: 'fast' }),
    ];

    const day = parseUsageLines(lines, INITIAL_PARSE_STATE, UTC).days['2026-11-09'];

    expect(Object.keys(day?.byModel ?? {}).sort()).toEqual(['claude-haiku-5-5#long', 'claude-opus-5-5#fast']);
  });

  it('parseUsageLines_topes_cuentaPorTipoYNoComoTurno', () => {
    const lines = [
      limitLine('u1', '2026-11-09T10:00:00.000Z', "You've hit your session limit · resets 5pm (Europe/Madrid)"),
      limitLine('u2', '2026-11-09T11:00:00.000Z', "You've hit your 5-hour limit · resets 9:30pm (Europe/Madrid)"),
      limitLine('u3', '2026-11-09T12:00:00.000Z', "You've hit your weekly limit · resets 10pm (Europe/Madrid)"),
      limitLine('u4', '2026-11-09T13:00:00.000Z', 'Algo distinto'),
    ];

    const day = parseUsageLines(lines, INITIAL_PARSE_STATE, UTC).days['2026-11-09'];

    expect(day?.limits).toEqual({ fiveHour: 2, weekly: 1, other: 1 });
    expect(day?.byModel).toEqual({});
    expect(day?.hours.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('parseUsageLines_carpeta_laPrimeraYSeArrastraEntreTrozos', () => {
    const first = parseUsageLines([assistantLine('m1', '2026-11-09T10:00:00.000Z', USAGE, { cwd: 'C:/a' })], INITIAL_PARSE_STATE, UTC);

    const second = parseUsageLines([assistantLine('m2', '2026-11-09T10:00:00.000Z', USAGE, { cwd: 'C:/b' })], first.state, UTC);

    expect(second.state.cwd).toBe('C:/a');
  });

  it('parseUsageLines_mensajeQueSigueEnElTrozoSiguiente_noSeCuentaDosVeces', () => {
    const first = parseUsageLines([assistantLine('msg_1', '2026-11-09T10:00:00.000Z', USAGE)], INITIAL_PARSE_STATE, UTC);

    const second = parseUsageLines([assistantLine('msg_1', '2026-11-09T10:00:01.000Z', USAGE), assistantLine('msg_2', '2026-11-09T11:00:00.000Z', USAGE)], first.state, UTC);

    expect(second.days['2026-11-09']?.byModel['claude-opus-5-5']?.turns).toBe(1);
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

    expect(parsed.days['2026-11-09']?.byModel['claude-opus-5-5']).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, turns: 1 });
  });
});

describe('aggregateHistory', () => {
  const day = (turns: number): DayDetail => onlyModels({ 'claude-opus-5-5': { inputTokens: turns, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, turns } });
  const totals = (turns: number) => ({ inputTokens: turns, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, turns });

  it('aggregateHistory_porIndiceDuenaFijaYSinCuenta_reparteYRecorta', () => {
    const history = aggregateHistory({
      files: [
        { sessionId: 's1', cwd: 'C:/p', days: { '2026-11-01': day(1), '2026-10-01': day(9) } },
        { sessionId: 's2', cwd: 'C:/p', days: { '2026-11-01': day(2) } },
        { sessionId: 's3', ownerAccountId: 'b', days: { '2026-11-03': day(3) } },
        { sessionId: 's4', days: { '2026-11-04': day(4) } },
      ],
      accountIds: ['a', 'b'],
      accountOf: (id) => ({ s1: 'a', s2: 'a', s4: 'borrada' })[id],
      windows: { a: { '2026-11-02': { fiveHourMax: 40, sevenDayMax: 10 }, '2026-10-01': { fiveHourMax: 1, sevenDayMax: 1 } } },
      fromDay: '2026-10-15',
      generatedAt: 1,
    });

    const a = history.accounts[0];
    expect(a?.days).toEqual([{ day: '2026-11-01', ...totals(3) }]);
    expect(a?.detail[0]).toMatchObject({ day: '2026-11-01', sessions: ['s1', 's2'], projects: { 'C:/p': 3 } });
    expect(a?.windows).toEqual([{ day: '2026-11-02', fiveHourMax: 40, sevenDayMax: 10 }]);
    expect(history.accounts[1]?.days).toEqual([{ day: '2026-11-03', ...totals(3) }]);
    expect(history.unattributed).toEqual([{ day: '2026-11-04', ...totals(4) }]);
  });

  it('aggregateHistory_diaSoloConTopes_cuentaElTopeSinConversacion', () => {
    const limited: DayDetail = { ...onlyModels({}), limits: { fiveHour: 1, weekly: 0, other: 0 } };

    const history = aggregateHistory({ files: [{ sessionId: 's1', days: { '2026-11-01': limited } }], accountIds: ['a'], accountOf: () => 'a', windows: {}, fromDay: '2026-10-01', generatedAt: 1 });

    expect(history.accounts[0]?.detail[0]).toMatchObject({ limits: { fiveHour: 1 }, sessions: [] });
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
