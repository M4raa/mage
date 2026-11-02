import { describe, expect, it } from 'vitest';
import { median, summarize } from '../../spike/bench/summarize.mjs';

describe('resumen del baseline F0-B', () => {
  it('median_imparYPar_valorCentralOMedia', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('median_sinNumeros_null', () => {
    expect(median([null, undefined])).toBeNull();
  });

  it('summarize_filas_agrupaYSeparaPendientesYErrores', () => {
    const base = { provider: 'claude', route: 'R2', task: 'T1', tokens: { input: 1, output: 2, cacheRead: 3, cacheCreate: 4 }, realTurns: 1 };
    const rows = [
      { ...base, ok: true, ttfeMs: 100, totalMs: 1000, costUsd: 0.01 },
      { ...base, ok: false, ttfeMs: 300, totalMs: 3000, costUsd: 0.02 },
      { ...base, pending: 'uso-sobre-70' },
      { ...base, error: 'spawn' },
    ];

    const [group] = summarize(rows);

    expect(group).toMatchObject({ runs: 4, pending: 1, errors: 1, ok: 1, realTurns: 2, outputTokens: 2, inputTokens: 8 });
    expect(group.ttfeMs).toEqual({ median: 200, range: [100, 300] });
    expect(group.costUsd).toBeCloseTo(0.03);
  });
});
