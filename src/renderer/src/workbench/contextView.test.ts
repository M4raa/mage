import { describe, expect, it } from 'vitest';
import {
  aggregateTokenUsage,
  buildContextSizeSeries,
  contextInfoFromUsage,
  contextUsageAdvice,
  contextWindowForModel,
  currentContextTokens,
  formatContextShort,
  formatTokensShort,
  markCompactions,
  occupiedCategories,
  toContextInfo,
  toTokenCategoryShares,
  type ContextSizePoint,
} from './contextView';
import type { ContextUsage } from '@shared/events';
import type { TranscriptEntry, TranscriptTokenUsage } from '@shared/transcripts';
import { makeEntry } from '@testing/transcriptEntry';

// Fabrica una entrada assistant con usage (los demas campos son irrelevantes para estos calculos).
function assistantEntry(index: number, usage: Partial<TranscriptTokenUsage>): TranscriptEntry {
  return makeEntry({
    index,
    kind: 'assistant',
    summary: 'assistant',
    timestampMs: index * 1000,
    tokenUsage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
      cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
      model: usage.model ?? null,
    },
  });
}

// Entrada sin uso (user/system/metadata): tokenUsage null.
function nonUsageEntry(index: number, kind = 'user'): TranscriptEntry {
  return {
    index,
    uuid: `u${index}`,
    parentUuid: null,
    isSidechain: false,
    isMeta: false,
    timestampMs: index * 1000,
    category: 'turn',
    kind,
    summary: kind,
    tokenUsage: null,
    raw: {},
  };
}

describe('aggregateTokenUsage', () => {
  it('sinEntradasAssistant_devuelveTodo0', () => {
    const totals = aggregateTokenUsage([nonUsageEntry(0), nonUsageEntry(1, 'system')]);
    expect(totals).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
    });
  });

  it('variasEntradas_sumaExacta', () => {
    const totals = aggregateTokenUsage([
      assistantEntry(0, { inputTokens: 2, outputTokens: 100, cacheCreationInputTokens: 10, cacheReadInputTokens: 500 }),
      assistantEntry(1, { inputTokens: 3, outputTokens: 50, cacheCreationInputTokens: 5, cacheReadInputTokens: 700 }),
    ]);
    expect(totals).toEqual({
      inputTokens: 5,
      outputTokens: 150,
      cacheCreationInputTokens: 15,
      cacheReadInputTokens: 1200,
      totalTokens: 1370,
    });
  });

  it('mezclaConYSinTokenUsage_ignoraNullsSinLanzar', () => {
    const totals = aggregateTokenUsage([
      nonUsageEntry(0),
      assistantEntry(1, { inputTokens: 4, outputTokens: 8 }),
      nonUsageEntry(2, 'mode'),
    ]);
    expect(totals.inputTokens).toBe(4);
    expect(totals.outputTokens).toBe(8);
    expect(totals.totalTokens).toBe(12);
  });
});

describe('toTokenCategoryShares', () => {
  it('total0_todosLosPctEn0', () => {
    const shares = toTokenCategoryShares({
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
    });
    expect(shares).toHaveLength(4);
    expect(shares.every((s) => s.pct === 0)).toBe(true);
  });

  it('totalPositivo_pctsRazonablesYOrdenFijo', () => {
    const shares = toTokenCategoryShares({
      inputTokens: 25,
      outputTokens: 25,
      cacheCreationInputTokens: 25,
      cacheReadInputTokens: 25,
      totalTokens: 100,
    });
    expect(shares.map((s) => s.key)).toEqual(['input', 'output', 'cacheCreation', 'cacheRead']);
    expect(shares.every((s) => s.pct === 25)).toBe(true);
  });
});

describe('buildContextSizeSeries / markCompactions', () => {
  it('serieVacia_devuelveVacio', () => {
    expect(buildContextSizeSeries([])).toEqual([]);
    expect(markCompactions([])).toEqual([]);
  });

  it('unPunto_noEsCompactacion', () => {
    const series = buildContextSizeSeries([assistantEntry(0, { cacheReadInputTokens: 1000 })]);
    expect(series).toHaveLength(1);
    expect(series[0]!.isCompaction).toBe(false);
  });

  it('serieSinCaidas_nadaMarcado', () => {
    const series = buildContextSizeSeries([
      assistantEntry(0, { cacheReadInputTokens: 100 }),
      assistantEntry(1, { cacheReadInputTokens: 200 }),
      assistantEntry(2, { cacheReadInputTokens: 300 }),
    ]);
    expect(series.some((p) => p.isCompaction)).toBe(false);
  });

  it('caidaBruscaDeCacheReadConTotalCasiIgual_seMarcaIgualmente', () => {
    // Numeros reales de una compactacion real: el TOTAL apenas cambia (incluso sube), solo cae
    // cache_read. Antes: input 2 + cacheRead 221478 + cacheCreation 3809 = 225289.
    // Compactacion: input 2 + cacheRead 33547 + cacheCreation 192888 = 226437 (total SUBE).
    const series = buildContextSizeSeries([
      assistantEntry(0, { inputTokens: 2, cacheReadInputTokens: 221478, cacheCreationInputTokens: 3809 }),
      assistantEntry(1, { inputTokens: 2, cacheReadInputTokens: 33547, cacheCreationInputTokens: 192888 }),
    ]);
    expect(series[0]!.contextTokens).toBe(225289);
    expect(series[1]!.contextTokens).toBe(226437);
    expect(series[1]!.contextTokens).toBeGreaterThan(series[0]!.contextTokens); // el total SUBE
    expect(series[1]!.isCompaction).toBe(true); // aun asi se detecta por la caida de cache_read
  });

  it('caidaDentroDelUmbral_noSeMarca', () => {
    // cacheRead cae de 1000 a 700 (30% < 40% umbral) -> NO es compactacion.
    const series = buildContextSizeSeries([
      assistantEntry(0, { cacheReadInputTokens: 1000 }),
      assistantEntry(1, { cacheReadInputTokens: 700 }),
    ]);
    expect(series[1]!.isCompaction).toBe(false);
  });

  it('cacheReadPrevioCero_noRompeYNoMarca', () => {
    const series = buildContextSizeSeries([
      assistantEntry(0, { cacheReadInputTokens: 0, inputTokens: 5 }),
      assistantEntry(1, { cacheReadInputTokens: 0, inputTokens: 5 }),
    ]);
    expect(series[1]!.isCompaction).toBe(false);
  });

  it('dropRatioPersonalizado_seRespeta', () => {
    // caida de 1000 -> 750 (25%); con dropRatio 0.2 el umbral es 800 -> 750<800 = compactacion.
    const points: readonly Omit<ContextSizePoint, 'isCompaction'>[] = [
      { entryIndex: 0, timestampMs: 0, contextTokens: 1000, cacheReadInputTokens: 1000 },
      { entryIndex: 1, timestampMs: 1, contextTokens: 750, cacheReadInputTokens: 750 },
    ];
    expect(markCompactions(points, 0.2)[1]!.isCompaction).toBe(true);
    expect(markCompactions(points, 0.4)[1]!.isCompaction).toBe(false);
  });

  it('ignoraEntradasSinTokenUsage', () => {
    const series = buildContextSizeSeries([
      nonUsageEntry(0),
      assistantEntry(1, { cacheReadInputTokens: 500 }),
      nonUsageEntry(2, 'system'),
      assistantEntry(3, { cacheReadInputTokens: 600 }),
    ]);
    expect(series).toHaveLength(2);
    expect(series.map((p) => p.entryIndex)).toEqual([1, 3]);
  });
});

describe('contextUsageAdvice', () => {
  it('bajaOcupacion_nivelOk', () => {
    expect(contextUsageAdvice(100_000, 200_000)).toEqual({ pct: 50, level: 'ok' });
  });

  it('cruzaUmbralDeAviso_nivelWarn', () => {
    expect(contextUsageAdvice(140_000, 200_000)).toEqual({ pct: 70, level: 'warn' });
  });

  it('cruzaUmbralAlto_nivelHigh', () => {
    expect(contextUsageAdvice(190_000, 200_000)).toEqual({ pct: 95, level: 'high' });
  });

  it('excedeLaVentana_pctAcotadoA100', () => {
    expect(contextUsageAdvice(250_000, 200_000)).toEqual({ pct: 100, level: 'high' });
  });

  it('ventanaCeroOInvalida_devuelveOk', () => {
    expect(contextUsageAdvice(50_000, 0)).toEqual({ pct: 0, level: 'ok' });
  });
});

describe('contextWindowForModel', () => {
  it('modelo1m_devuelve1Millon', () => {
    expect(contextWindowForModel('opus[1m]')).toBe(1_000_000);
    expect(contextWindowForModel('sonnet[1m]')).toBe(1_000_000);
  });

  it('modeloNormal_devuelve200k', () => {
    expect(contextWindowForModel('sonnet')).toBe(200_000);
    expect(contextWindowForModel('')).toBe(200_000);
  });
});

describe('formatTokensShort', () => {
  it('formateaRangos', () => {
    expect(formatTokensShort(0)).toBe('0');
    expect(formatTokensShort(950)).toBe('950');
    expect(formatTokensShort(12_340)).toBe('12,3k');
    expect(formatTokensShort(1_200_000)).toBe('1,2M');
  });

  it('negativoOInvalido_seSaneaA0', () => {
    expect(formatTokensShort(-5)).toBe('0');
  });
});

describe('contextInfoFromUsage / occupiedCategories (D3)', () => {
  // Desglose LITERAL capturado del CLI 2.1.220 (recortado a lo que Mage usa).
  const REAL_USAGE: ContextUsage = {
    totalTokens: 39_365,
    maxTokens: 967_000,
    percentage: 4,
    categories: [
      { name: 'System prompt', tokens: 9_882, isDeferred: false },
      { name: 'System tools', tokens: 22_471, isDeferred: false },
      { name: 'MCP tools (deferred)', tokens: 3_954, isDeferred: true },
      { name: 'System tools (deferred)', tokens: 17_517, isDeferred: true },
      { name: 'Memory files', tokens: 2_178, isDeferred: false },
      { name: 'Skills', tokens: 4_826, isDeferred: false },
      { name: 'Messages', tokens: 8, isDeferred: false },
      { name: 'Autocompact buffer', tokens: 33_000, isDeferred: false },
      { name: 'Free space', tokens: 894_635, isDeferred: false },
    ],
  };

  it('contextInfoFromUsage_desgloseReal_usaLaVentanaEfectivaYNoLaAdivinada', () => {
    const info = contextInfoFromUsage(REAL_USAGE, 1_234);

    // 967k -> "967k" (ni "200k" ni "1M", que es lo que daria adivinar por el nombre del modelo).
    expect(info.maxTokens).toBe('967k');
    expect(info.usedTokens).toBe('39,4k');
    expect(info.usedPct).toBe(4);
    expect(info.tokensOut).toBe('1,2k');
  });

  it('contextInfoFromUsage_porcentajeFueraDeRango_seAcota', () => {
    expect(contextInfoFromUsage({ ...REAL_USAGE, percentage: 130 }, 0).usedPct).toBe(100);
    expect(contextInfoFromUsage({ ...REAL_USAGE, percentage: -5 }, 0).usedPct).toBe(0);
  });

  it('contextInfoFromUsage_ventanaInvalida_lanza', () => {
    expect(() => contextInfoFromUsage({ ...REAL_USAGE, maxTokens: 0 }, 0)).toThrow(/ventana de contexto invalida.*: 0$/i);
  });

  it('occupiedCategories_conFreeSpaceYDeferred_lasExcluye', () => {
    // El popover del indicador de contexto (2.8) pinta ESTA lista entera, no el resumen recortado.
    const names = occupiedCategories(REAL_USAGE).map((category) => category.name);

    expect(names).toEqual(['Autocompact buffer', 'System tools', 'System prompt', 'Skills', 'Memory files', 'Messages']);
  });

  it('occupiedCategories_todasLasCategoriasACero_devuelveVacio', () => {
    // Con la lista vacia el popover dice "Sin desglose todavia", no pinta una lista en blanco.
    const usage: ContextUsage = {
      ...REAL_USAGE,
      categories: [
        { name: 'Messages', tokens: 0, isDeferred: false },
        { name: 'Free space', tokens: 900_000, isDeferred: false },
      ],
    };

    expect(occupiedCategories(usage)).toEqual([]);
  });

});

describe('formatContextShort (2.8, indicador de la barra de estado)', () => {
  it('formatContextShort_45porciento_devuelveCtx45', () => {
    expect(formatContextShort(45)).toBe('ctx 45 %');
  });

  it('formatContextShort_cero_devuelveCtx0', () => {
    expect(formatContextShort(0)).toBe('ctx 0 %');
  });

  it('formatContextShort_masDe100_seClampeaA100', () => {
    // El CLI puede reportar por encima de 100 con la autocompactacion pendiente.
    expect(formatContextShort(137)).toBe('ctx 100 %');
    expect(formatContextShort(-3)).toBe('ctx 0 %');
  });

  it('formatContextShort_noFinito_devuelveNull', () => {
    // El llamador NO monta el indicador: un `ctx NaN %` es peor que no tener indicador.
    expect(formatContextShort(Number.NaN)).toBeNull();
    expect(formatContextShort(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('formatContextShort_decimal_redondea', () => {
    expect(formatContextShort(44.6)).toBe('ctx 45 %');
  });
});

describe('toContextInfo', () => {
  it('modelo1m_usaVentana1MyCalculaPct', () => {
    const info = toContextInfo(500_000, 42_000, 'opus[1m]');

    expect(info.maxTokens).toBe('1M');
    expect(info.usedTokens).toBe('500,0k');
    expect(info.usedPct).toBe(50);
    expect(info.tokensOut).toBe('42,0k');
  });

  it('modeloNormal_usaVentana200k', () => {
    const info = toContextInfo(100_000, 0, 'sonnet');

    expect(info.maxTokens).toBe('200k');
    expect(info.usedPct).toBe(50);
  });

  it('contextoMayorQueVentana_pctAcotadoA100', () => {
    expect(toContextInfo(300_000, 0, 'sonnet').usedPct).toBe(100);
  });
});

describe('currentContextTokens', () => {
  it('sinPuntos_devuelve0', () => {
    expect(currentContextTokens([])).toBe(0);
  });

  it('conPuntos_devuelveElContextTokensDelUltimo', () => {
    const series = buildContextSizeSeries([
      assistantEntry(0, { inputTokens: 10 }),
      assistantEntry(1, { inputTokens: 42 }),
    ]);
    expect(currentContextTokens(series)).toBe(42);
  });
});
